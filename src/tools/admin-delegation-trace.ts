/** Opt-in current-law administrative rule discovery from official lsDelegated links. */
import type { LawApiClient } from "../lib/api-client.js"
import type { LawInfo } from "../lib/law-search.js"
import type { ToolResponse } from "../lib/types.js"
import { sameLawName, todayKst } from "../lib/law-lineage.js"
import { fetchAdminRuleHistory, adminVersionAt } from "../lib/admin-rule-history.js"
import { loadAdminRuleDoc, adminRuleParsed } from "../lib/admin-rule-doc.js"
import { adminRuleSourceUrl } from "../lib/image-only-body.js"
import { parseDelegatedAdminLinks, type AdminDelegationLink } from "../lib/admin-delegation-links.js"
import { extractNamedStatuteReferences } from "./statute-reference-trace.js"
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
function preciseCitations(body:string, lawName:string, alias?:string):string[] {
  const refs:string[]=[]
  const prefix=alias ? "(?:「([^」\\n]{2,150})」|(?<![가-힣A-Za-z0-9])("+alias+"))" : "(?:「([^」\\n]{2,150})」)"
  const pattern=new RegExp(prefix+"\\s*(제\\s*\\d{1,4}\\s*조(?:\\s*의\\s*\\d{1,2})?(?:\\s*제\\s*\\d+\\s*항)?(?:\\s*제\\s*\\d+\\s*호(?:\\s*의\\s*\\d+)?)?(?:\\s*[가-힣]\\s*목)?)","g")
  for(const m of body.slice(0,100000).matchAll(pattern)) {
    if(m[1]&&!sameLawName(m[1],lawName))continue
    const loc=m[m.length-1], tail=body.slice(m.index!+m[0].length,m.index!+m[0].length+80)
    // Do not silently reduce a range or an incompletely parsed suffix to its first token.
    if(/^\s*(?:부터|까지|내지|~|～|의\s*\d|제\s*\d+\s*(?:조|항|호)|[가-힣]\s*목|\d|례)/.test(tail))continue
    if(locationParts(loc))refs.push(loc.replace(/\s+/g,""))
    if(refs.length>=100)break
  }
  return refs
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
        if(precise.length>=100)truncated=true
        for(const ref of precise)for(const [loc,counts] of scopeRows) {
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
        const ordered=["EXACT","NARROWER","BROADER","SAME_ARTICLE_OTHER_LOCATION"]
        return loc+" | "+ordered.map(kind=>kind+"="+(counts.get(kind)?.size??0)).join(" / ")+ordered.flatMap(kind=>[...(counts.get(kind)??[])].slice(0,1).map(example=>"\n  "+kind+": "+example.slice(0,160))).join("")
      })
      // Keep location summaries ahead of long excerpts and separate stale-source evidence.
      lines.splice(2,0,"[ADMIN_LOCATION_COMPARISON] "+linkLabel+" → 조회 본문 "+current.serial+" | "+(stale?"구버전 등재 위치와 현행 후보 비교(현행 공식 연결 아님)":"현행 등재 위치와 본문 비교")+"\n문자 그대로의 위치 비교만 수행. EXACT=동일, NARROWER=더 세분, BROADER=상위 범위, SAME_ARTICLE_OTHER_LOCATION=같은 조의 다른 위치. 지원 표기·검색 범위 내 고유 조문/인용 조합 수이며 0은 부존재 단정 아님. 범위·생략형 인용은 별도 검토.\n"+scopeSummary.join("\n"))
      if(hits.length)lines.push((stale ? "[CURRENT_CANDIDATE_CITATION_WORDING] 현행 후보의 명시적 인용 문언(현행 공식 위임 연결 확인 아님)" : "[DIRECT_CITATION_WORDING] 행정규칙 본문의 명시적 상위 조문 인용")+"\n"+hits.join("\n\n"))
      if(aliasHits.length)lines.push((stale?"[CURRENT_CANDIDATE_DECLARED_ALIAS_WORDING] 현행 후보의 정의된 약칭 인용(현행 공식 위임 연결 확인 아님)":"[DECLARED_ALIAS_CITATION_WORDING] 원문에서 정의된 약칭 인용")+"\n정의 문언: "+alias!.definition+"\n"+aliasHits.join("\n\n"))
      if(!hits.length&&!aliasHits.length)lines.push((stale ? "[CURRENT_CANDIDATE_NO_EXPLICIT_BACKLINK] " : "[NO_EXPLICIT_BACKLINK] ")+"지원 인용 표기에서 정확한 상위 조문 역인용 미확인. 약칭·생략형·별표·부칙 또는 비조문형 본문은 별도 검토 필요.")
      if(truncated)lines.push("[PARTIAL] 역인용 검색·표시 범위 제한")
      if(candidateKey) scannedCandidates.add(candidateKey)
    } catch(e) {
      rethrowIfFatal(e)
      lines.push("[NOT_VERIFIED] "+linkLabel+" — 연혁 또는 원문 조회 실패")
    }
  }
  return result()
}
