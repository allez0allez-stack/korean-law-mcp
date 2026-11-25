/** Bounded current-law delegation graph using official lsDelegated only. */
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, type LawInfo } from "../lib/law-search.js"
import { sameLawName, todayKst } from "../lib/law-lineage.js"
import { parseDelegatedAdminLinks, parseDelegatedLawLinks } from "../lib/admin-delegation-links.js"
import { buildJO } from "../lib/law-parser.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { throwIfRequestCancelled } from "../lib/session-state.js"
import { truncateResponse } from "../lib/schemas.js"
import type { ToolResponse } from "../lib/types.js"
import { extractNamedStatuteReferences, readExactArticle } from "./statute-reference-trace.js"
import { traceAdminRuleDelegations } from "./admin-delegation-trace.js"

const MAX_ROOTS=3, MAX_TARGETS=5, MAX_DEPTH=2, MAX_RULES=3
export const wantsRecursiveAdminTrace = (query: string) => /다단계\s*(?:고시|행정규칙|위임)\s*(?:관계\s*)?(?:추적|조회|발굴)|재위임\s*(?:관계\s*)?(?:추적|조회|발굴)/.test(query)
interface LocalCandidate { law: LawInfo; article: string; wording: string }
interface Node { law: LawInfo; article: string; depth: number; path: string; localCandidate?: LocalCandidate }
/** A bracket-leading bare reference may point to the source law. Only a candidate,
 * never a replacement for a listed edge or proof of delegation. */
function localCitationCandidate(body:string, source:LawInfo, link:{name:string;article:string;wording:string}):LocalCandidate|undefined {
  if(sameLawName(source.lawName,link.name)||body.length>100000)return undefined
  const bare=/^(제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,2})?)(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?(?:\s*[가-힣]\s*목)?$/.exec(link.wording.trim())
  if(!bare||buildJO(bare[1])!==buildJO(link.article))return undefined
  // A named reference to the target elsewhere is ambiguous: do not suggest reassignment.
  if(extractNamedStatuteReferences(body).some(r=>sameLawName(r.lawName,link.name)&&r.article===link.article))return undefined
  const normalized=body.replace(/\s+/g,"")
  const wording=link.wording.replace(/\s+/g,"")
  if(!["[","("].some(open=>{
    const pos=normalized.indexOf(open+wording)
    return pos>=0&&!/^(?:의\d|제\d+(?:조|항|호)|[가-힣]목|\d|례)/.test(normalized.slice(pos+1+wording.length))
  }))return undefined
  return {law:source,article:link.article,wording:link.wording}
}
const key=(law:LawInfo, article:string)=>JSON.stringify([law.mst,law.effectiveDate,buildJO(article)])
const valid=(law:LawInfo)=>Boolean(/^\d+$/.test(law.mst)&&/^\d+$/.test(law.lawId)&&law.effectiveDate&&/^\d{8}$/.test(law.effectiveDate)&&law.effectiveDate<=todayKst()&&law.status!=="연혁")
export async function traceRecursiveAdminDelegations(api: LawApiClient, input:{law:LawInfo;articles:readonly string[];apiKey?:string}):Promise<ToolResponse>{
  const lines=["[RECURSIVE_ADMIN_DELEGATION_TRACE] 공식 위임 연결 다단계 조회", "※ 공식 등재된 연결만 따라갑니다. 하위법령의 정확한 현행 MST·ID·시행일 및 조문 본문을 대조합니다. 연결 등재와 법적 위임의 적법성·범위·실제 적용은 구분합니다. 과거 적용관계·본문검색·기관규정은 별도 검토 대상입니다."]
  const queue:Node[]=[], seen=new Set<string>(), payloads=new Map<string,unknown>(), resolved=new Map<string,LawInfo|undefined>()
  let roots=0, targets=0, verified=0, deferred=0, failed=0, adminIncomplete=0, localVerified=0, localAttempts=0, ruleSlots=MAX_RULES
  const omitted:string[]=[]
  const defer=(label:string)=>{deferred++;if(omitted.length<10)omitted.push(label)}
  const articles=[...new Set(input.articles)]
  if(valid(input.law))for(const article of articles.slice(0,MAX_ROOTS)){
    try{if(!/^제\s*\d{1,4}\s*조(?:\s*의\s*\d{1,2})?$/.test(article.trim()))throw Error();const k=key(input.law,article);if(!seen.has(k)){seen.add(k);queue.push({law:input.law,article,depth:0,path:input.law.lawName+" "+article})}}catch{failed++;lines.push("[NOT_VERIFIED] 시작 조문번호 오류: "+article)}
  }
  for(const a of articles.slice(MAX_ROOTS))defer("시작 조문 "+a)
  if(!queue.length)return {content:[{type:"text",text:"[NOT_VERIFIED] 정확한 현행 시작 법령ID·MST·시행일과 조문이 필요합니다."}],isError:true}
  while(queue.length){
    throwIfRequestCancelled()
    const node=queue.shift()!, label=node.law.lawName+" "+node.article
    let body:string
    try{
      body=(await readExactArticle(api,node.law,node.article,input.apiKey,true)).body
      if(node.depth)verified++;else roots++
      lines.push("["+(node.depth?"DELEGATED_ARTICLE_VERIFIED":"DELEGATION_ROOT_VERIFIED")+"] 깊이 "+node.depth+" | "+node.path+" | MST "+node.law.mst+" | 시행 "+node.law.effectiveDate)
    }catch(e){rethrowIfFatal(e);failed++;lines.push("[NOT_VERIFIED] "+label+" — 조문 원문 검증 실패")
      if(node.localCandidate&&localAttempts<1){
        const candidate=node.localCandidate;localAttempts++
        try{
          const result=await readExactArticle(api,candidate.law,candidate.article,input.apiKey,true)
          localVerified++
          lines.push("[SOURCE_LAW_CANDIDATE_VERIFIED] "+candidate.law.lawName+" "+candidate.article+" | MST "+candidate.law.mst+" | 시행 "+candidate.law.effectiveDate+" | 시작 원문 문언: "+candidate.wording+"\n"+truncateResponse(result.header+"\n"+result.body,600)+"\n독립 원문 후보이며 공식 연결 수정·위임관계 확정 아님.")
        }catch(error){rethrowIfFatal(error);lines.push("[SOURCE_LAW_CANDIDATE_NOT_VERIFIED] "+candidate.law.lawName+" "+candidate.article)}
      }else if(node.localCandidate)defer(label+" 동일 법령 후보 원문 조회 한도")
      continue
    }
    // Separate article verification from a failed official envelope fetch.
    try{
      if(!payloads.has(node.law.mst)){
        const raw=await api.fetchApi({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:{MST:node.law.mst},apiKey:input.apiKey})
        if(raw.length>5_000_000)throw Error("응답 크기 제한")
        payloads.set(node.law.mst,JSON.parse(raw))
      }
    }catch(e){rethrowIfFatal(e);failed++;lines.push("[NOT_VERIFIED] "+label+" — 공식 연결 응답 검증 실패");continue}
    const payload=payloads.get(node.law.mst), source={...node.law,effectiveDate:node.law.effectiveDate!}
    const admin=parseDelegatedAdminLinks(payload,source,node.article), laws=parseDelegatedLawLinks(payload,source,node.article)
    if(admin.status==="NOT_VERIFIED"||laws.status==="NOT_VERIFIED"){failed++;lines.push("[NOT_VERIFIED] "+label+" — 공식 연결 범위 미확인");continue}
    if(admin.status==="PARTIAL"||laws.status==="PARTIAL"){defer(label+" 일부 연결 행 미식별")}
    if(admin.links.length){
      const count=new Set(admin.links.map(x=>x.serial)).size
      if(ruleSlots>0){
        const limit=Math.min(ruleSlots,count);ruleSlots-=limit
        const result=await traceAdminRuleDelegations(api,{law:node.law,articles:[node.article],apiKey:input.apiKey,officialPayload:payload,maxRules:limit,inspectCurrentCandidate:true})
        lines.push("▶ 고시 연결 경로: "+node.path+"\n"+result.content[0].text)
        if(result.isError)failed++
        if(result.coverage!=="COMPLETE")adminIncomplete++
        if(count>limit)defer(label+" 추가 고시 "+(count-limit)+"종")
      }else defer(label+" 고시 "+count+"종 (원문 조회 한도)")
    }
    if(!admin.links.length&&!laws.links.length)lines.push("[NO_LINK_IN_RESPONSE] "+label+" — 해당 공식 응답 범위에 연결 미확인; 부존재 단정 금지")
    const localEdges=new Map<string,typeof laws.links>()
    for(const link of laws.links){
      const k=JSON.stringify([link.mst,link.article]);localEdges.set(k,[...(localEdges.get(k)??[]),link])
    }
    for(const edges of localEdges.values()){
      const link=edges[0]
      const edge=node.path+" → "+link.name+" "+link.article
      if(node.depth>=MAX_DEPTH||targets>=MAX_TARGETS){defer(edge);continue}
      targets++
      const lookup=link.name
      let law:LawInfo|undefined
      try{
        if(!resolved.has(lookup)){
          const matches=(await findLaws(api,lookup,input.apiKey,100)).filter(l=>sameLawName(l.lawName,lookup)&&valid(l))
          const unique=[...new Map(matches.map(l=>[JSON.stringify([l.lawId,l.mst,l.effectiveDate]),l])).values()]
          resolved.set(lookup,unique.length===1?unique[0]:undefined)
        }
        law=resolved.get(lookup)
      }catch(e){rethrowIfFatal(e)}
      if(!law){failed++;lines.push("[NOT_VERIFIED] "+edge+" — 대상 현행 식별 실패 (등재 MST "+link.mst+")");continue}
      if(law.mst!==link.mst){failed++;lines.push("[LINKED_LAW_MST_NOT_CURRENT] "+edge+" — 등재 MST "+link.mst+", 현행 후보 "+law.mst+"; 현행 연결로 승계하지 않음");continue}
      const k=key(law,link.article)
      lines.push("[OFFICIAL_LAW_LINK_LISTED] "+edge+" | 등재 MST "+link.mst+"\n"+edges.slice(0,5).map(e=>"시작 위치 "+(e.location||"미제공")+" | 목록 문언: "+(e.wording||"미제공")).join("\n"))
      if(edges.length>5)defer(edge+" 추가 위임 위치 "+(edges.length-5)+"개")
      if(seen.has(k)){lines.push("[ALREADY_SEEN] "+edge+" — 중복·순환 재조회 생략");continue}
      const localCandidate=edges.map(e=>localCitationCandidate(body,node.law,e)).find(c=>c!==undefined)
      seen.add(k);queue.push({law,article:link.article,depth:node.depth+1,path:edge,localCandidate})
    }
  }
  lines.splice(2,0,"시작 확인 "+roots+"건 / 하위 조문 확인 "+verified+"건 / 법령·응답 미검증 "+failed+"건 / 행정규칙 미완결 경로 "+adminIncomplete+"건 / 독립 동일 법령 후보 확인 "+localVerified+"건 / 제한 "+deferred+"건. 상한: 시작 "+MAX_ROOTS+", 대상 시도 "+MAX_TARGETS+", 깊이 "+MAX_DEPTH+", 행정규칙 원문 조회 시도 "+MAX_RULES+"건. 개별 고시의 현행성·미검증 여부는 하단 경로별로 표시합니다.")
  if(failed||deferred||adminIncomplete)lines.splice(2,0,"[PARTIAL] 일부 경로 미확인·미추적. 전체 위임관계가 아닙니다.")
  if(omitted.length)lines.push("미추적 후보(최대 10개):\n"+omitted.join("\n"))
  return {content:[{type:"text",text:truncateResponse(lines.join("\n\n"),18000)}],...(!roots?{isError:true}:{})}
}
