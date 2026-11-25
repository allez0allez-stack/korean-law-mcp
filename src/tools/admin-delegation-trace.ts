/** Opt-in current-law administrative rule discovery from official lsDelegated links. */
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, type LawInfo } from "../lib/law-search.js"
import type { ToolResponse } from "../lib/types.js"
import { sameLawName, todayKst } from "../lib/law-lineage.js"
import { fetchAdminRuleHistory, adminVersionAt, parseAdminRuleRows } from "../lib/admin-rule-history.js"
import { loadAdminRuleDoc, adminRuleParsed, type AdminRuleDoc } from "../lib/admin-rule-doc.js"
import { adminRuleSourceUrl, INLINE_IMAGE_MARK, markInlineImages } from "../lib/image-only-body.js"
import { parseDelegatedAdminLinks, type AdminDelegationLink } from "../lib/admin-delegation-links.js"
import { extractNamedStatuteReferences, readExactArticle } from "./statute-reference-trace.js"
import { extractTag } from "../lib/xml-parser.js"
import { truncateResponse } from "../lib/schemas.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { throwIfRequestCancelled } from "../lib/session-state.js"

const MAX_SOURCE_ARTICLES = 3
const MAX_RULES = 3
const MAX_SCAN_CHARS = 2_000_000
const MAX_SCAN_UNITS = 3000
const MAX_BACKLINKS = 5
const DATE = /^\d{8}$/
export function wantsAdminDelegationTrace(query: string): boolean {
  return /(?:고시|행정규칙|재위임|다단계\s*위임)\s*(?:관계\s*)?(?:추적|조회|발굴)/.test(query)
}
export function isHistoricalAdminTrace(query: string): boolean {
  return /\d{4}\s*년|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\b\d{8}\b|경과조치|과거\s*법령|개정\s*이력/.test(query)
}

/** Only early general definitions and explicitly chained relative names are supported. */
function declaredAlias(text: string, units: readonly {label:string;lines:string[]}[], lawName: string): { alias: string; definition: string } | undefined {
  const candidates: {name:string;alias:string;definition:string}[]=[]
  for(const [i,unit] of units.slice(0,3).entries()) {
    if(i>0 && !/\([^)\n]*(?:정의|용어)[^)\n]*\)/.test(unit.label))continue
    const body=unit.lines.join("\n")
    for(const m of body.matchAll(/「([^」\n]{2,150})」\s*\(\s*이하\s*["“](법|영|규칙)["”]\s*(?:이라|라)\s*한다\s*\)/g)) {
      candidates.push({name:m[1],alias:m[2],definition:m[0]})
      if(m[2]!=="법" || !/(?:법|법률)$/.test(m[1].trim()))continue
      // Resolve only adjacent items in the same explicit definition list. Never cross prose or another named law.
      let rest=body.slice(m.index!+m[0].length), chain=m[0]
      for(let j=0;j<2;j++) {
        const rel=/^(?:\s*[,ㆍ·]\s*|\s+(?:및|또는)\s+)같은\s*법\s*(시행령|시행규칙)\s*\(\s*이하\s*["“](영|규칙)["”]\s*(?:이라|라)\s*한다\s*\)/.exec(rest)
        if(!rel || (rel[1]==="시행령"?"영":"규칙")!==rel[2])break
        chain+=rel[0]
        candidates.push({name:m[1]+" "+rel[1],alias:rel[2],definition:chain})
        rest=rest.slice(rel[0].length)
      }
    }
  }
  const matches=candidates.filter(m=>sameLawName(m.name,lawName))
  if(matches.length!==1)return undefined
  const m=matches[0]
  // Scoped redefinitions elsewhere invalidate a global inference, even across line breaks.
  const declarations=[...text.matchAll(/이하[^()]{0,80}?["“](법|영|규칙)["”]\s*(?:이라|라)\s*한다/g)].filter(d=>d[1]===m.alias)
  return declarations.length===1 ? {alias:m.alias,definition:m.definition} : undefined
}

// Literal location comparison only; it is not a finding of delegated authority.
const LOCATION = /^(제[1-9]\d{0,3}조(?:의[1-9]\d?)?)(제[1-9]\d{0,3}항)?(제[1-9]\d{0,3}호(?:의[1-9]\d?)?)?([가-힣]목)?$/
function locationParts(value:string):string[]|undefined {
  const m=LOCATION.exec(value.replace(/\s+/g,""))
  return m ? m.slice(1).map(v=>v??"") : undefined
}
function locationRelation(official:string, citation:string):string {
  const a=locationParts(official), b=locationParts(citation)
  if(!a||!b)return "UNRESOLVED"
  if(a[0]!==b[0])return "OTHER_ARTICLE"
  if(a.every((v,i)=>v===b[i]))return "EXACT"
  // Missing hierarchy components never imply an omitted paragraph or item number.
  const aa=a.filter(Boolean), bb=b.filter(Boolean)
  if(aa.length<bb.length&&aa.every((v,i)=>v===bb[i]))return "NARROWER"
  if(bb.length<aa.length&&bb.every((v,i)=>v===aa[i]))return "BROADER"
  return "SAME_ARTICLE_OTHER_LOCATION"
}
// Recover only an immediately adjacent, same-level omitted prefix. Range endpoints
// are textual evidence, not a claim that every intervening provision exists.
function contextualLocations(loc:string, tail:string): {kind:string;location:string;wording:string}[] {
  const parts=locationParts(loc)
  if(!parts)return []
  let index=parts.length-1
  while(index>0&&!parts[index])index--
  if(index<1)return []
  const suffixes=["",String.raw`제\s*\d{1,4}\s*항`,String.raw`제\s*\d{1,4}\s*호(?:\s*의\s*\d{1,2})?`,String.raw`[가-힣]\s*목`]
  const token=suffixes[index]
  const end=String.raw`(?!\s*(?:의\s*\d|제\s*\d+\s*(?:조|항|호)|[가-힣]\s*목|\d|례|본문|단서|각\s*호\s*외))`
  const range=new RegExp(String.raw`^\s*부터\s*(${token})`+end+String.raw`\s*까지`).exec(tail)
  const make=(value:string)=>parts.slice(0,index).join("")+value.replace(/\s+/g,"")
  if(range&&locationParts(make(range[1])))return [
    {kind:"RANGE_ENDPOINT",location:loc,wording:loc+range[0]},
    {kind:"RANGE_ENDPOINT",location:make(range[1]),wording:loc+range[0]},
  ]
  const list=new RegExp(String.raw`^\s*(?:및|또는|,|ㆍ|·)\s*(${token})`+end).exec(tail)
  if(!list || /^\s*(?:부터|내지|~|～|까지)/.test(tail.slice(list[0].length)))return []
  const next=make(list[1])
  return locationParts(next)?[{kind:"CONTEXT_LIST",location:next,wording:loc+list[0]}]:[]
}

function preciseCitations(body:string, lawName:string, alias?:string):{refs:string[];contextual:{kind:string;location:string;wording:string}[]} {
  const refs:string[]=[]
  const contextual:{kind:string;location:string;wording:string}[]=[]
  const prefix=alias ? "(?:「([^」\\n]{2,150})」|(?<![가-힣A-Za-z0-9])("+alias+"))" : "(?:「([^」\\n]{2,150})」)"
  const pattern=new RegExp(prefix+"\\s*(제\\s*\\d{1,4}\\s*조(?:\\s*의\\s*\\d{1,2})?(?:\\s*제\\s*\\d+\\s*항)?(?:\\s*제\\s*\\d+\\s*호(?:\\s*의\\s*\\d+)?)?(?:\\s*[가-힣]\\s*목)?)","g")
  for(const m of body.slice(0,100000).matchAll(pattern)) {
    if(refs.length+contextual.length>=100)break
    if(m[1]&&!sameLawName(m[1],lawName))continue
    const loc=m[m.length-1], tail=body.slice(m.index!+m[0].length,m.index!+m[0].length+80)
    contextual.push(...contextualLocations(loc.replace(/\s+/g,""),tail))
    // Do not silently reduce a range or an incompletely parsed suffix to its first token.
    if(/^\s*(?:부터|까지|내지|~|～|의\s*\d|제\s*\d+\s*(?:조|항|호)|[가-힣]\s*목|\d|례|본문|단서|각\s*호\s*외)/.test(tail))continue
    if(locationParts(loc))refs.push(loc.replace(/\s+/g,""))
  }
  return {refs,contextual}
}

/** Supplementary evidence is independent of the operative article comparison.
 * Do not carry a current body alias into an older addendum or annex. */
function traceExtraCitations(doc:AdminRuleDoc, law:LawInfo, edges:readonly AdminDelegationLink[]):string[] {
  const blocks=[...(doc.addenda??[]).map((text,i)=>({kind:"ADDENDUM",label:"부칙 #"+(i+1),text:markInlineImages(text)})),
    ...(doc.annexes??[]).map((a,i)=>({kind:"ANNEX",label:"별표 #"+(i+1)+(a.title?" "+a.title.slice(0,100):""),text:a.content}))]
  const out:string[]=[]
  if(!blocks.length&&!doc.attachments.length)return out
  let scanned=0, remaining=300_000, limited=blocks.length>30||doc.attachments.length>0, hits=0
  const examples:string[]=[]
  const articleSet=new Set(edges.map(e=>e.sourceArticle.replace(/\s+/g,"")))
  for(const block of blocks.slice(0,30)) {
    throwIfRequestCancelled()
    if(!block.text.trim()){limited=true;continue}
    if(remaining<=0){limited=true;break}
    const cap=Math.min(100_000,remaining)
    if(block.text.length>cap){limited=true;continue}
    const body=block.text
    remaining-=body.length;scanned++
    if(body.includes(INLINE_IMAGE_MARK))limited=true
    const refs=preciseCitations(body,law.lawName)
    if(refs.refs.length+refs.contextual.length>=100)limited=true
    for(const ref of new Set(refs.refs)) {
      if(!articleSet.has(locationParts(ref)?.[0]??""))continue
      hits++
      if(examples.length>=5){limited=true;continue}
      const exact=edges.some(e=>locationRelation(e.location,ref)==="EXACT")
      examples.push(block.kind+" | "+block.label+" | "+ref+" | "+(exact?"EXACT_TEXT_LOCATION":"ARTICLE_TEXT_REFERENCE"))
    }
  }
  out.push("[ADMIN_EXTRA_CITATION_SCOPE] 일련번호 "+doc.ruleSerial+" | 별표·부칙의 명시적 정식 법령명 인용(본문 위치 집계와 별도) | 블록 "+scanned+"/"+blocks.length+" | 고유 블록·인용 "+hits+"건 | 첨부 "+doc.attachments.length+"건 미열람. 부칙의 적용시점·경과조치 효력 및 별표 수치·범위는 확정하지 않음. 약칭·복합 인용 미지원. 0건은 부존재 단정 아님.")
  if(examples.length)out.push("[ADMIN_EXTRA_CITATION_EVIDENCE] 일련번호 "+doc.ruleSerial+"\n"+examples.join("\n"))
  if(limited)out.push("[PARTIAL] 별표·부칙 텍스트/표시 한도, 이미지 또는 첨부파일 미검증 — 원문 별도 확인 필요")
  return out
}

/** Extract dated addendum wording, not an applicability determination. */
export function traceTransitionDates(doc:AdminRuleDoc, referenceDate?:string, keyword?:string):string[] {
  const addenda=doc.addenda??[]
  if(!addenda.length)return []
  const evidence:string[]=[]
  let scanned=0, remaining=300_000, candidates=0, limited=addenda.length>100
  for(const [i,raw] of addenda.slice(0,100).entries()) {
    throwIfRequestCancelled()
    const body=markInlineImages(raw)
    if(body.length>Math.min(100_000,remaining)||body.includes(INLINE_IMAGE_MARK)){limited=true;continue}
    remaining-=body.length;scanned++
    const headings=[...body.matchAll(/^\s*(제\d{1,4}조(?:의\d{1,2})?)\s*\(([^)\n]{1,100})\)/gm)]
    const header=body.split("\n",1)[0].trim().slice(0,100)
    for(const [j,h] of headings.entries()) {
      if(!/시행일|적용례|경과조치|특례|적용시기|적용시점/.test(h[2]))continue
      const clause=body.slice(h.index!,headings[j+1]?.index??body.length).trim()
      if(keyword&&!clause.replace(/\s+/g,"").includes(keyword.replace(/\s+/g,"")))continue
      candidates++
      const dates:string[]=[]
      for(const m of clause.matchAll(/(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(이후|이전|부터|까지|전|후|에)(?![\d])/g)) {
        const y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]), utc=new Date(Date.UTC(y,mo-1,d))
        if(y<1900||y>9999||utc.getUTCFullYear()!==y||utc.getUTCMonth()!==mo-1||utc.getUTCDate()!==d)continue
        const date=m[1]+m[2].padStart(2,"0")+m[3].padStart(2,"0")
        const relation=referenceDate ? " [DATE_RELATION="+(referenceDate<date?"BEFORE":referenceDate===date?"EQUAL":"AFTER")+"]" : ""
        const value=date+" "+m[4]+relation
        if(!dates.includes(value))dates.push(value)
      }
      if(evidence.length>=8){limited=true;continue}
      // The heading and exact clause text preserve the event/condition, including exceptions.
      const excerpt=clause.length>700?clause.slice(0,700)+" … [발췌 제한]":clause
      if(clause.length>700||dates.length>10)limited=true
      evidence.push("부칙 #"+(i+1)+" | "+header+" | "+h[1]+"("+h[2]+") | "+(dates.length?"명시 날짜: "+dates.slice(0,10).join(", "):"명시 날짜 미확인(상대일·조건 등 별도 검토)")+"\n"+excerpt)
    }
  }
  const out=["[ADMIN_TRANSITION_SCOPE] 일련번호 "+doc.ruleSerial+" | 부칙 블록 "+scanned+"/"+addenda.length+" | 시행일·적용례·경과조치 등 제목 후보 "+candidates+"건 | 발령·시행 메타데이터와 별도. 날짜는 원문 문언이며 사안별 적용법령·효력을 확정하지 않음. 제목 없는 조항 및 복합 상대일 미지원."+(referenceDate?" 비교 기준일 "+referenceDate+". DATE_RELATION은 기준일의 명시 날짜 대비 선후 관계만 표시(사건 유형·조건 충족·법적 적용 판정 아님)."+(keyword?" 문언 필터: "+keyword:""):"")]
  if(evidence.length)out.push("[ADMIN_TRANSITION_DATE_EVIDENCE] 일련번호 "+doc.ruleSerial+"\n"+evidence.join("\n\n"))
  if(limited)out.push("[PARTIAL] 부칙 날짜 증거 검색·표시 한도 또는 이미지 미검증")
  return out
}

/** Explicit opt-in title search plus independently verified body citations. */
export async function discoverAdminCitations(api:LawApiClient,input:{query:string;lawName:string;article:string;knd?:string;apiKey?:string;expand?:boolean}):Promise<ToolResponse> {
  const fail=(message:string):ToolResponse=>({content:[{type:"text",text:"[NOT_VERIFIED] "+message}],isError:true})
  const article=input.article.replace(/\s+/g,"")
  if(!/^제[1-9]\d{0,3}조(?:의[1-9]\d?)?$/.test(article)||!input.query.trim()||input.query.length>100||!input.lawName.trim()||input.lawName.length>150)return fail("행정규칙 제목 검색어, 정확한 상위 법령명 및 조 번호 필요")
  const today=todayKst(), lines=["[INDEPENDENT_ADMIN_CITATION_SEARCH] 제목 검색 후보의 현행 원문 인용 확인", "검색어별 상위 10개 행, 전체 최대 3개 계보만 확인. 전 행정규칙 본문 검색이나 위임 효력 판정 아님. 공식 연결 미등재와 공식 목록 부존재는 다름."]
  let law:LawInfo, header:string
  try{
    const matches=(await findLaws(api,input.lawName,input.apiKey,100)).filter(l=>sameLawName(l.lawName,input.lawName)&&/^\d+$/.test(l.mst)&&/^\d+$/.test(l.lawId)&&l.effectiveDate&&DATE.test(l.effectiveDate)&&l.effectiveDate<=today&&l.status!=="연혁")
    const unique=[...new Map(matches.map(l=>[JSON.stringify([l.mst,l.lawId,l.effectiveDate]),l])).values()]
    if(unique.length!==1)return fail("상위 현행 법령 정확 식별 실패")
    law=unique[0]
    header=(await readExactArticle(api,law,article,input.apiKey,true)).header
  }catch(e){rethrowIfFatal(e);return fail("상위 조문 원문 검증 실패")}
  lines.push("[SOURCE_ARTICLE_VERIFIED] "+law.lawName+" "+article+" | MST "+law.mst+" | 시행 "+law.effectiveDate)
  let official:ReturnType<typeof parseDelegatedAdminLinks>|undefined
  try{
    const raw=await api.fetchApi({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:{MST:law.mst},apiKey:input.apiKey})
    if(raw.length<=5_000_000)official=parseDelegatedAdminLinks(JSON.parse(raw),{...law,effectiveDate:law.effectiveDate!},article)
  }catch(e){rethrowIfFatal(e)}
  lines.push("[OFFICIAL_COMPARISON_SCOPE] "+(official?.status??"NOT_VERIFIED"))
  const queries=[input.query.trim()]
  if(input.expand){
    const title=header.startsWith(article+" ")?header.slice(article.length).trim():""
    // Only derive literal wording from the identity-verified article title; no invented synonyms.
    const topic=title.split(/[,ㆍ·]|\s+(?:및|또는)\s+|의\s+/)[0].trim()
    for(const term of [topic,title])if(term.length>=3&&term.length<=100&&/^[가-힣0-9 ,ㆍ·()]+$/.test(term)&&!/^(?:목적|정의|기준|방법|절차|특례|적용범위|시행일|기타|준용)$/.test(term)&&!queries.some(q=>q.replace(/\s+/g,"")===term.replace(/\s+/g,"")))queries.push(term)
  }
  type Row=ReturnType<typeof parseAdminRuleRows>[number]
  const batches:{query:string;rows:Row[]}[]=[]
  let total=0, received=0, searchFailures=0, limited=false
  for(const query of queries){
    throwIfRequestCancelled()
    try{
      const raw=await api.searchAdminRule({query,knd:input.knd,nw:"1",display:10,apiKey:input.apiKey})
      const count=extractTag(raw,"totalCnt")
      if(raw.length>1_000_000||!/<AdmRulSearch[\s>]/.test(raw)||!/^\d+$/.test(count))throw Error("검색 응답 미검증")
      const rows=parseAdminRuleRows(raw), n=Number(count)
      if(!Number.isSafeInteger(n)||n<rows.length||(n>0&&!rows.length))throw Error("검색 행·건수 불일치")
      total+=n;received+=rows.length
      const valid=rows.slice(0,10).filter(r=>/^\d{13}$/.test(r.serial)&&/^\d+$/.test(r.ruleId)&&r.name&&r.name.length<=200)
      if(n>rows.length||rows.length>10||valid.length!==rows.length)limited=true
      batches.push({query,rows:valid})
      if(input.expand)lines.push("[TITLE_QUERY] "+query+" | 검색 "+n+"건 / 수신 "+rows.length+"건")
    }catch(e){rethrowIfFatal(e);searchFailures++;limited=true;lines.push("[TITLE_QUERY_NOT_VERIFIED] "+query)}
  }
  if(!batches.length)return fail("행정규칙 제목 검색 응답 또는 호출 미검증")
  const byId=new Map<string,Row>(), provenance=new Map<string,Set<string>>(), conflicts=new Set<string>()
  for(const batch of batches)for(const row of batch.rows){
    const prior=byId.get(row.ruleId)
    if(prior&&(prior.serial!==row.serial||!sameLawName(prior.name,row.name)))conflicts.add(row.ruleId)
    else if(!prior)byId.set(row.ruleId,row)
    const sources=provenance.get(row.ruleId)??new Set<string>();sources.add(batch.query);provenance.set(row.ruleId,sources)
  }
  for(const id of conflicts){byId.delete(id);limited=true;lines.push("[CANDIDATE_IDENTITY_CONFLICT] 행정규칙ID "+id+" — 검색 행 불일치, 원문 검증 제외")}
  const candidates:Row[]=[], queued=new Set<string>()
  const add=(row:Row)=>{if(byId.has(row.ruleId)&&!queued.has(row.ruleId)){queued.add(row.ruleId);candidates.push(row)}}
  // Preserve exact user title, then distribute the bounded slots across distinct query streams.
  if(input.expand)for(const row of batches.find(b=>b.query===queries[0])?.rows??[])if(sameLawName(row.name,queries[0]))add(row)
  for(let i=0;i<10;i++)for(const batch of batches){const row=batch.rows[i];if(row)add(row)}
  let verified=0, found=0, failed=0
  if(candidates.length>3)limited=true
  for(const row of candidates.slice(0,3)){
    throwIfRequestCancelled()
    try{
      const history=await fetchAdminRuleHistory(api,row.name,input.apiKey)
      const group=history.groups.get(row.ruleId)
      if(history.truncated||!group||!group.some(v=>v.serial===row.serial&&sameLawName(v.name,row.name))||group.some(v=>!DATE.test(v.efYd)||!DATE.test(v.issuedYd)))throw Error("연혁 미확인")
      const selected=adminVersionAt(group,today), current=selected.version
      if(!current||selected.note||current.serial!==row.serial||!sameLawName(current.name,row.name))throw Error("현행 검색·연혁 불일치")
      const doc=await loadAdminRuleDoc(api,current.serial,input.apiKey)
      if(doc.ruleSerial!==current.serial||!/^\d+$/.test(doc.ruleId??"")||Number(doc.ruleId)!==Number(current.ruleId)||!sameLawName(doc.ruleName,current.name)||doc.efDate!==current.efYd||doc.issuedDate!==current.issuedYd||!doc.hasContent||doc.imgInfo.imageOnly)throw Error("원문 식별 실패")
      verified++
      const listed=official?.links.some(e=>e.serial===current.serial&&sameLawName(e.name,current.name))?"LISTED_CURRENT_SERIAL":official?.links.some(e=>group.some(v=>v.serial===e.serial&&sameLawName(v.name,e.name)))?"LISTED_LINEAGE_OTHER_VERSION":official?.status==="LINKS_FOUND"||official?.status==="NO_LINK_IN_RESPONSE"?"NOT_LISTED_IN_RESPONSE":"OFFICIAL_STATUS_UNRESOLVED"
      const label=current.name+" | 일련번호 "+current.serial+" | 시행 "+current.efYd+" | "+listed+"\n"+adminRuleSourceUrl(current.serial)+(input.expand?"\n검색 경로: "+[...(provenance.get(row.ruleId)??[])].join(" / "):"")
      const hits:string[]=[]
      if(doc.articlesText.length>MAX_SCAN_CHARS){limited=true;lines.push("[CANDIDATE_SCAN_LIMIT] "+label);continue}
      const units=adminRuleParsed(doc).articles, alias=declaredAlias(doc.articlesText,units,law.lawName)
      if(!units.length||units.length>MAX_SCAN_UNITS||doc.attachments.length||doc.annexes?.length||doc.addenda?.length||doc.articlesText.includes(INLINE_IMAGE_MARK))limited=true
      for(const unit of units.slice(0,MAX_SCAN_UNITS)){
        throwIfRequestCancelled()
        const body=unit.lines.join("\n")
        if(body.length>100000){limited=true;continue}
        const refs=preciseCitations(body,law.lawName,alias?.alias)
        if(refs.refs.length+refs.contextual.length>=100)limited=true
        for(const loc of new Set(refs.refs)){
          if(locationParts(loc)?.[0]!==article)continue
          if(hits.length>=5){limited=true;continue}
          hits.push(unit.label.slice(0,150)+" | "+loc)
        }
      }
      if(hits.length){found++;lines.push("[INDEPENDENT_CITATION_VERIFIED] "+label+"\n"+(alias?"약칭 정의: "+alias.definition+"\n":"")+hits.join("\n"))}
      else lines.push("[CANDIDATE_NO_SUPPORTED_CITATION] "+label+" — 지원 본문 표기에서 인용 미확인(부존재 아님)")
    }catch(e){rethrowIfFatal(e);failed++;lines.push("[CANDIDATE_NOT_VERIFIED] "+row.name+" | "+row.serial+" — 연혁 또는 원문 검증 실패")}
  }
  lines.splice(2,0,"[PARTIAL] 제한 검색. 제목 검색 "+total+"건 / 수신 "+received+"건"+(input.expand?" (검색어별 합계, 중복 포함) / 검색어 "+queries.length+"개 / 검색 실패 "+searchFailures+"개":"")+" / 후보 계보 "+candidates.length+"건 / 원문 확인 "+verified+"건 / 인용 확인 "+found+"건 / 검증 실패 "+failed+"건"+(limited?" / 미검색·미열람 범위 있음":"")+". 공식 위임 누락 또는 법적 효력 확정 아님.")
  return {content:[{type:"text",text:truncateResponse(lines.join("\n\n"),12000)}]}
}

export async function traceAdminRuleDelegations(api: LawApiClient, input: {
  law: LawInfo; articles: readonly string[]; apiKey?: string; officialPayload?: unknown; maxRules?: number; inspectCurrentCandidate?: boolean
}): Promise<ToolResponse & { coverage: "COMPLETE" | "PARTIAL" | "NOT_VERIFIED" }> {
  const {law,apiKey} = input
  const today = todayKst()
  const lines = [
    "[OFFICIAL_ADMIN_DELEGATION_TRACE] 공식 위임행정규칙 연결 조회",
    "※ 시작 조문에 직접 등재된 공식 연결 목록만 조회합니다. 법률→시행령→고시의 다단계 재위임, 본문 검색 보완, 자율규정의 포괄 검색은 별도 범위입니다. 등재·직접 인용 문언은 위임의 적법성이나 실제 사안 적용을 확정하지 않습니다.",
  ]
  const result = (isError = false): ToolResponse & { coverage: "COMPLETE" | "PARTIAL" | "NOT_VERIFIED" } => {
    const text = lines.join("\n\n")
    const coverage = isError ? "NOT_VERIFIED" : text.length + 100 > 12000 || lines.some(line => /^\[(?:PARTIAL|NOT_VERIFIED|LINKED_SERIAL_NOT_CURRENT)\]/.test(line)) ? "PARTIAL" : "COMPLETE"
    return {content:[{type:"text",text:truncateResponse("[ADMIN_TRACE_COVERAGE] "+coverage+" (공식 연결·지원 본문 범위)\n\n"+text,12000)}], coverage, ...(isError ? {isError:true} : {})}
  }
  if (!law.mst || !law.effectiveDate || !DATE.test(law.effectiveDate) || law.effectiveDate > today || !input.articles.length) {
    lines.unshift("[NOT_VERIFIED] 현행 시작 법령의 정확한 MST·시행일·조문이 필요합니다.")
    return result(true)
  }
  const source = {...law,effectiveDate:law.effectiveDate}
  const articles = [...new Set(input.articles)]
  if (articles.length > MAX_SOURCE_ARTICLES) lines.push("[PARTIAL] 시작 조문 미조회: " + articles.slice(MAX_SOURCE_ARTICLES).join(", "))
  let payload: unknown
  try {
    throwIfRequestCancelled()
    payload = input.officialPayload ?? JSON.parse(await api.fetchApi({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:{MST:law.mst},apiKey}))
  } catch(e) {
    rethrowIfFatal(e)
    lines.unshift("[NOT_VERIFIED] 공식 위임법령 API 호출 또는 JSON 해석 실패. 연결 부존재로 간주하지 않습니다.")
    return result(true)
  }
  const links: AdminDelegationLink[] = []
  let knownSources = 0
  for (const article of articles.slice(0,MAX_SOURCE_ARTICLES)) {
    const parsed = parseDelegatedAdminLinks(payload,source,article)
    lines.push("["+parsed.status+"] "+law.lawName+" "+article+" | MST "+law.mst+" | 시행 "+law.effectiveDate+" | "+parsed.reason)
    if (parsed.status !== "NOT_VERIFIED") knownSources++
    links.push(...parsed.links)
  }
  if (!knownSources) return result(true)
  const grouped = new Map<string,AdminDelegationLink[]>()
  for(const link of links) grouped.set(link.serial,[...(grouped.get(link.serial)??[]),link])
  const rules = [...grouped.entries()]
  const maxRules = Math.max(0, Math.min(MAX_RULES, input.maxRules ?? MAX_RULES))
  if (rules.length > maxRules) lines.push("[PARTIAL] 원문 미조회 규칙: "+rules.slice(maxRules).map(([id,l])=>l[0].name+" ("+id+")").join(", "))
  const scannedCandidates = new Set<string>()
  for (const [serial,edges] of rules.slice(0,maxRules)) {
    throwIfRequestCancelled()
    const name = edges[0].name
    const linkLabel = name+" | 등재 일련번호 "+serial
    if (edges.some(e=>!sameLawName(e.name,name))) {lines.push("[NOT_VERIFIED] "+linkLabel+" — 제목 충돌");continue}
    lines.push("[OFFICIAL_LINK_LISTED] "+linkLabel+"\n"+edges.map(e=>e.sourceArticle+" "+e.location+" | 목록 문언: "+(e.wording||"미제공")).join("\n"))
    try {
      const history = await fetchAdminRuleHistory(api,name,apiKey)
      if (history.truncated) {lines.push("[NOT_VERIFIED] "+linkLabel+" — 연혁 페이지 한도 초과");continue}
      const groups = [...history.groups.values()].filter(g=>g.some(v=>v.serial===serial&&sameLawName(v.name,name)))
      if (groups.length!==1) {lines.push("[NOT_VERIFIED] "+linkLabel+" — 정확한 행정규칙 연혁 계보 미확인");continue}
      if (groups[0].some(v=>!DATE.test(v.efYd)||!DATE.test(v.issuedYd))) {lines.push("[NOT_VERIFIED] "+linkLabel+" — 연혁 시행일 또는 발령일 미확인");continue}
      const selected = adminVersionAt(groups[0],today)
      if (!selected.version||selected.note) {lines.push("[NOT_VERIFIED] "+linkLabel+" — 기준일 시행 버전 미확정 또는 분리시행 위험");continue}
      const current=selected.version
      const stale = current.serial !== serial
      let candidateKey: string | undefined
      if(stale) {
        lines.push("[LINKED_SERIAL_NOT_CURRENT] "+linkLabel+" — 현재 시행 후보 "+current.name+" ("+current.serial+", 시행 "+current.efYd+"). 다른 버전의 연결을 현행 연결로 승계하지 않습니다.")
        if (!input.inspectCurrentCandidate) continue
        lines.push("[PARTIAL] 등재 연결은 구버전입니다. 같은 연혁의 현행 후보 원문만 독립적으로 확인합니다.")
        candidateKey = JSON.stringify([current.serial, current.efYd, [...new Set(edges.map(e=>e.sourceArticle+"|"+e.location))].sort()])
        if (scannedCandidates.has(candidateKey)) {lines.push("[CURRENT_CANDIDATE_ALREADY_SCANNED] 동일 현행 후보 및 시작 조문 재조회 생략");continue}
      }
      const doc = await loadAdminRuleDoc(api,current.serial,apiKey)
      const identityMatches = doc.ruleSerial === current.serial && !!doc.ruleId && /^\d+$/.test(doc.ruleId) && /^\d+$/.test(current.ruleId) && doc.ruleId.replace(/^0+(?=\d)/, "") === current.ruleId.replace(/^0+(?=\d)/, "")
      if (!identityMatches||!sameLawName(doc.ruleName,current.name)||doc.efDate!==current.efYd||!doc.issuedDate||doc.issuedDate!==current.issuedYd||!doc.hasContent||doc.imgInfo.imageOnly) {
        lines.push("[NOT_VERIFIED] "+linkLabel+" — 원문 일련번호·행정규칙ID·명칭·시행일·발령일 또는 텍스트 검증 실패");continue
      }
      lines.push((stale ? "[CURRENT_CANDIDATE_VERSION_VERIFIED] " : "[ADMIN_VERSION_VERIFIED] ")+current.name+" | 일련번호 "+current.serial+" | 시행 "+current.efYd+" | 소관 "+(current.org||doc.orgName||"미확인")+"\n"+adminRuleSourceUrl(current.serial))
      const extraEvidence=traceExtraCitations(doc,law,edges)
      if(extraEvidence.length)lines.splice(2,0,...extraEvidence)
      const transitionEvidence=traceTransitionDates(doc)
      if(transitionEvidence.length)lines.splice(2,0,...transitionEvidence)
      if(doc.articlesText.length>MAX_SCAN_CHARS){lines.push("[PARTIAL] 행정규칙 원문은 확인했으나 본문 크기 상한으로 역인용 검색 생략");continue}
      const parsed=adminRuleParsed(doc)
      const alias=declaredAlias(doc.articlesText,parsed.articles,law.lawName)
      const locations=[...new Set(edges.map(e=>e.location))]
      const scopeRows = new Map(locations.slice(0,20).map(loc=>[loc,new Map<string,Set<string>>()]))
      const hits:string[]=[]
      const aliasHits:string[]=[]
      let truncated=parsed.articles.length>MAX_SCAN_UNITS || !parsed.articles.length || locations.length>20
      for(const unit of parsed.articles.slice(0,MAX_SCAN_UNITS)) {
        throwIfRequestCancelled()
        const body=unit.lines.join("\n")
        const precise=preciseCitations(body,law.lawName,alias?.alias)
        if(precise.refs.length+precise.contextual.length>=100)truncated=true
        for(const evidence of precise.contextual)for(const [loc,counts] of scopeRows) {
          if(locationRelation(loc,evidence.location)!=="EXACT")continue
          const key=unit.label.slice(0,100)+" | "+evidence.wording
          const set=counts.get(evidence.kind)??new Set<string>()
          if(set.size<100)set.add(key);else truncated=true
          counts.set(evidence.kind,set)
        }
        for(const ref of precise.refs)for(const [loc,counts] of scopeRows) {
          const relation=locationRelation(loc,ref)
          if(relation==="OTHER_ARTICLE"||relation==="UNRESOLVED")continue
          const key=unit.label.slice(0,100)+" | "+ref
          const set=counts.get(relation)??new Set<string>()
          if(set.size<100)set.add(key);else truncated=true
          counts.set(relation,set)
        }
        const refs=extractNamedStatuteReferences(body)
        if(body.length>100000||refs.length>=100) truncated=true
        const exact=refs.filter(r=>sameLawName(r.lawName,law.lawName)&&edges.some(e=>e.sourceArticle.replace(/\s+/g,"")===r.article))
        if(exact.length) {
          if(hits.length===MAX_BACKLINKS)truncated=true
          else hits.push(unit.label+" | "+exact.map(r=>r.wording).join(" / ").slice(0,400)+"\n"+truncateResponse(body,1200))
        }
        if(alias) {
          const pattern=new RegExp(`(?<![가-힣A-Za-z0-9])${alias.alias}\\s*제\\s*(\\d{1,4})\\s*조(?:\\s*의\\s*(\\d{1,2}))?(?!\\s*의\\s*\\d|\\d|례)(?:\\s*제\\s*\\d+\\s*항)?(?:\\s*제\\s*\\d+\\s*호)?`,"g")
          for(const m of body.slice(0,100000).matchAll(pattern)) {
            const article=`제${Number(m[1])}조${m[2]?`의${Number(m[2])}`:""}`
            if(!edges.some(e=>e.sourceArticle.replace(/\s+/g,"")===article))continue
            if(aliasHits.length===MAX_BACKLINKS){truncated=true;break}
            aliasHits.push(unit.label+" | "+m[0]+"\n"+body.slice(Math.max(0,m.index!-70),m.index!+m[0].length+200))
          }
        }
      }
      const scopeSummary=[...scopeRows].map(([loc,counts])=>{
        if(!locationParts(loc))return (loc||"위치 미제공")+" | UNRESOLVED: 공식 위치 형식 미지원"
        const ordered=["EXACT","NARROWER","BROADER","SAME_ARTICLE_OTHER_LOCATION","CONTEXT_LIST","RANGE_ENDPOINT"]
        return loc+" | "+ordered.map(kind=>kind+"="+(counts.get(kind)?.size??0)).join(" / ")+ordered.flatMap(kind=>[...(counts.get(kind)??[])].slice(0,1).map(example=>"\n  "+kind+": "+example.slice(0,160))).join("")
      })
      // Keep location summaries ahead of long excerpts and separate stale-source evidence.
      lines.splice(2,0,"[ADMIN_LOCATION_COMPARISON] "+linkLabel+" → 조회 본문 "+current.serial+" | "+(stale?"구버전 등재 위치와 현행 후보 비교(현행 공식 연결 아님)":"현행 등재 위치와 본문 비교")+"\n문자 그대로의 위치 비교만 수행. EXACT=동일, NARROWER=더 세분, BROADER=상위 범위, SAME_ARTICLE_OTHER_LOCATION=같은 조의 다른 위치. 지원 표기·검색 범위 내 고유 조문/인용 조합 수이며 0은 부존재 단정 아님. CONTEXT_LIST=인접 동일 계층 생략 인용, RANGE_ENDPOINT=명시된 범위 끝점(중간 조문 미추론). 직접 일치와 분리하며 복합 생략·본문·단서는 별도 검토.\n"+scopeSummary.join("\n"))
      if(hits.length)lines.push((stale ? "[CURRENT_CANDIDATE_CITATION_WORDING] 현행 후보의 명시적 인용 문언(현행 공식 위임 연결 확인 아님)" : "[DIRECT_CITATION_WORDING] 행정규칙 본문의 명시적 상위 조문 인용")+"\n"+hits.join("\n\n"))
      if(aliasHits.length)lines.push((stale?"[CURRENT_CANDIDATE_DECLARED_ALIAS_WORDING] 현행 후보의 정의된 약칭 인용(현행 공식 위임 연결 확인 아님)":"[DECLARED_ALIAS_CITATION_WORDING] 원문에서 정의된 약칭 인용")+"\n정의 문언: "+alias!.definition+"\n"+aliasHits.join("\n\n"))
      if(!hits.length&&!aliasHits.length)lines.push((stale ? "[CURRENT_CANDIDATE_NO_EXPLICIT_BACKLINK] " : "[NO_EXPLICIT_BACKLINK] ")+"지원 본문 인용 표기에서 정확한 상위 조문 역인용 미확인. 별표·부칙 증거는 별도 집계하며 복합 인용·비조문형 본문은 별도 검토 필요.")
      if(truncated)lines.push("[PARTIAL] 역인용 검색·표시 범위 제한")
      if(candidateKey) scannedCandidates.add(candidateKey)
    } catch(e) {
      rethrowIfFatal(e)
      lines.push("[NOT_VERIFIED] "+linkLabel+" — 연혁 또는 원문 조회 실패")
    }
  }
  return result()
}
