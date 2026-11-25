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
const MAX_SCAN_CHARS = 300_000
const MAX_BACKLINKS = 5
const DATE = /^\d{8}$/
export function wantsAdminDelegationTrace(query: string): boolean {
  return /(?:고시|행정규칙|재위임|다단계\s*위임)\s*(?:관계\s*)?(?:추적|조회|발굴)/.test(query)
}
export function isHistoricalAdminTrace(query: string): boolean {
  return /\d{4}\s*년|\d{4}[-./]\d{1,2}[-./]\d{1,2}|\b\d{8}\b|경과조치|과거\s*법령|개정\s*이력/.test(query)
}

export async function traceAdminRuleDelegations(api: LawApiClient, input: {
  law: LawInfo; articles: readonly string[]; apiKey?: string; officialPayload?: unknown; maxRules?: number; inspectCurrentCandidate?: boolean
}): Promise<ToolResponse> {
  const {law,apiKey} = input
  const today = todayKst()
  const lines = [
    "[OFFICIAL_ADMIN_DELEGATION_TRACE] 공식 위임행정규칙 연결 조회",
    "※ 시작 조문에 직접 등재된 공식 연결 목록만 조회합니다. 법률→시행령→고시의 다단계 재위임, 본문 검색 보완, 자율규정의 포괄 검색은 별도 범위입니다. 등재·직접 인용 문언은 위임의 적법성이나 실제 사안 적용을 확정하지 않습니다.",
  ]
  const result = (isError = false): ToolResponse => ({content:[{type:"text",text:truncateResponse(lines.join("\n\n"),12000)}], ...(isError ? {isError:true} : {})})
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
      if(stale) {
        lines.push("[LINKED_SERIAL_NOT_CURRENT] "+linkLabel+" — 현재 시행 후보 "+current.name+" ("+current.serial+", 시행 "+current.efYd+"). 다른 버전의 연결을 현행 연결로 승계하지 않습니다.")
        if (!input.inspectCurrentCandidate) continue
        lines.push("[PARTIAL] 등재 연결은 구버전입니다. 같은 연혁의 현행 후보 원문만 독립적으로 확인합니다.")
        const candidateKey = JSON.stringify([current.serial, current.efYd, [...new Set(edges.map(e=>e.sourceArticle))].sort()])
        if (scannedCandidates.has(candidateKey)) {lines.push("[CURRENT_CANDIDATE_ALREADY_SCANNED] 동일 현행 후보 및 시작 조문 재조회 생략");continue}
        scannedCandidates.add(candidateKey)
      }
      const doc = await loadAdminRuleDoc(api,current.serial,apiKey)
      const identityMatches = doc.ruleSerial === current.serial && !!doc.ruleId && /^\d+$/.test(doc.ruleId) && /^\d+$/.test(current.ruleId) && doc.ruleId.replace(/^0+(?=\d)/, "") === current.ruleId.replace(/^0+(?=\d)/, "")
      if (!identityMatches||!sameLawName(doc.ruleName,current.name)||doc.efDate!==current.efYd||!doc.issuedDate||doc.issuedDate!==current.issuedYd||!doc.hasContent||doc.imgInfo.imageOnly) {
        lines.push("[NOT_VERIFIED] "+linkLabel+" — 원문 일련번호·행정규칙ID·명칭·시행일·발령일 또는 텍스트 검증 실패");continue
      }
      lines.push((stale ? "[CURRENT_CANDIDATE_VERSION_VERIFIED] " : "[ADMIN_VERSION_VERIFIED] ")+current.name+" | 일련번호 "+current.serial+" | 시행 "+current.efYd+" | 소관 "+(current.org||doc.orgName||"미확인")+"\n"+adminRuleSourceUrl(current.serial))
      if(doc.articlesText.length>MAX_SCAN_CHARS){lines.push("[PARTIAL] 행정규칙 원문은 확인했으나 본문 크기 상한으로 역인용 검색 생략");continue}
      const parsed=adminRuleParsed(doc)
      const hits:string[]=[]
      let truncated=false
      for(const unit of parsed.articles) {
        throwIfRequestCancelled()
        const body=unit.lines.join("\n")
        const refs=extractNamedStatuteReferences(body)
        if(body.length>100000||refs.length>=100) truncated=true
        const exact=refs.filter(r=>sameLawName(r.lawName,law.lawName)&&edges.some(e=>e.sourceArticle.replace(/\s+/g,"")===r.article))
        if(exact.length) {
          if(hits.length===MAX_BACKLINKS){truncated=true;break}
          hits.push(unit.label+" | "+exact.map(r=>r.wording).join(" / ").slice(0,400)+"\n"+truncateResponse(body,1200))
        }
      }
      if(hits.length)lines.push((stale ? "[CURRENT_CANDIDATE_CITATION_WORDING] 현행 후보의 명시적 인용 문언(현행 공식 위임 연결 확인 아님)" : "[DIRECT_CITATION_WORDING] 행정규칙 본문의 명시적 상위 조문 인용")+"\n"+hits.join("\n\n"))
      else lines.push((stale ? "[CURRENT_CANDIDATE_NO_EXPLICIT_BACKLINK] " : "[NO_EXPLICIT_BACKLINK] ")+"지원 인용 표기에서 정확한 상위 조문 역인용 미확인. 약칭·생략형·별표·부칙 또는 비조문형 본문은 별도 검토 필요.")
      if(truncated)lines.push("[PARTIAL] 역인용 검색·표시 범위 제한")
    } catch(e) {
      rethrowIfFatal(e)
      lines.push("[NOT_VERIFIED] "+linkLabel+" — 연혁 또는 원문 조회 실패")
    }
  }
  return result()
}
