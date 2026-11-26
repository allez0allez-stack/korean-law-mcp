/** Bounded traversal of explicitly named statutory references, not legal applicability. */
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, type LawInfo } from "../lib/law-search.js"
import { sameLawName, todayKst } from "../lib/law-lineage.js"
import { buildJO } from "../lib/law-parser.js"
import { resolveLawAlias } from "../lib/search-normalizer.js"
import { formatArticleUnit } from "../lib/article-parser.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { throwIfRequestCancelled } from "../lib/session-state.js"
import { truncateResponse } from "../lib/schemas.js"
import { classifyReferenceTail } from "../lib/relation-wording.js"
import type { ToolResponse } from "../lib/types.js"

export interface NamedStatuteReference {
  lawName: string
  article: string
  wording: string
  relation: "CITATION" | "JUNYONG_WORDING"
  relationEvidence?: {kind:string;wording:string}
}
const MAX_ROOTS = 3
const MAX_TARGETS = 6
const MAX_DEPTH = 2
const MAX_BODY = 100_000
const MAX_CANDIDATES = 100
const MAX_LAW_SEARCHES = 6

/** Do not infer law ownership for unquoted references, ranges or anaphora. */
export function extractNamedStatuteReferences(body: string, includeRelationEvidence = false): NamedStatuteReference[] {
  const refs: NamedStatuteReference[] = []
  const pattern = /「([^」\n]{2,150})」\s*제\s*(\d{1,4})\s*조(?:\s*의\s*(\d{1,2}))?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?(?!\s*의\s*\d|\d|례)/g
  for (const m of body.slice(0, MAX_BODY).matchAll(pattern)) {
    const lawName = m[1].trim()
    if (!/(?:법률|법|시행령|시행규칙|규칙|규정|조례)$/.test(lawName)) continue
    const article = `제${Number(m[2])}조${m[3] ? `의${Number(m[3])}` : ""}`
    if (!Number(m[2]) || (m[3] && !Number(m[3]))) continue
    const tail = body.slice(m.index! + m[0].length, m.index! + m[0].length + 48)
    const relation = /^\s*(?:의\s*규정\s*)?(?:을|를)\s*준용(?:한다|하며|할\s*수\s*있다|하되|하고)(?=\s|[.,;ㆍ)]|$)/.test(tail) ? "JUNYONG_WORDING" : "CITATION"
    const relationEvidence = includeRelationEvidence ? classifyReferenceTail(tail) : undefined
    refs.push({ lawName, article, relation, ...(relationEvidence ? {relationEvidence} : {}), wording: m[0] + (relation === "JUNYONG_WORDING" ? tail.slice(0, tail.indexOf("준용") + 2) : "") })
    if (refs.length >= MAX_CANDIDATES) break
  }
  return refs
}

export function wantsStatuteReferenceTrace(query: string): boolean {
  return /(?:인용|준용|참조|법령\s*간\s*연결)\s*(?:관계\s*)?(?:추적|확인|조회|분석)|(?:인용|준용|참조)\s*조문/.test(query)
    && !/\d{4}\s*년|\d{4}[-.]\d{1,2}[-.]\d{1,2}|경과조치|과거\s*법령|개정\s*이력/.test(query)
}

/** A trace may not promote a semantic or partial-name root match to verified evidence. */
export function matchesExplicitTraceRoot(query: string, officialName: string): boolean {
  const prefix = query.trim().match(/^(.+?)(?=\s*제?\s*\d{1,4}\s*조|\s+(?:인용|준용|참조|법령\s*간\s*연결)\s*(?:관계\s*)?(?:추적|확인|조회|분석|조문))/)?.[1]
  const name = prefix?.trim().replace(/^「|」$/g, "").trim()
  if (!name || !/(?:법률|법|시행령|시행규칙|규칙|규정|조례)$/.test(name)) return false
  const suffix = name.match(/\s*(시행령|시행규칙)$/)?.[1]
  const base = suffix ? name.replace(/\s*(시행령|시행규칙)$/, "") : name
  const canonical = resolveLawAlias(base).canonical + (suffix ? " " + suffix : "")
  return sameLawName(name, officialName) || sameLawName(canonical, officialName)
}

interface ArticleRecord { header: string; body: string; effectiveDate?: string }
interface Node { law: LawInfo; article: string; depth: number }
const keyFor = (law: LawInfo, article: string) => `${law.mst}:${buildJO(article)}`

/** Read the exact article from structured official JSON; never scan a formatted tool summary. */
export async function readExactArticle(api: LawApiClient, law: LawInfo, article: string, apiKey?: string, requireIdentity = false): Promise<ArticleRecord> {
  const jo = buildJO(article)
  // A single proclamation MST can have several effective-date slices.
  // The current search row, not an MST-only response, identifies the slice.
  const efYd = law.effectiveDate
  if (requireIdentity && (!law.lawId || !efYd)) throw Error("법령 ID 또는 시행일 미확인")
  if (efYd && (!/^\d{8}$/.test(efYd) || efYd > todayKst())) throw Error("현행 검색 시행일 미확인 또는 시행 예정")
  const raw = JSON.parse(await api.getLawText({ mst: law.mst, jo, ...(efYd ? { efYd } : {}), apiKey }))?.법령
  const info = raw?.기본정보
  const name = info?.법령명_한글 || info?.법령명한글 || info?.법령명
  if (typeof name !== "string" || !sameLawName(name, law.lawName)) throw Error("법령 원문 명칭 불일치")
  if (requireIdentity && (!/^\d+$/.test(String(info?.법령ID || "")) || !/^\d+$/.test(law.lawId) || Number(info.법령ID) !== Number(law.lawId))) throw Error("법령 ID 불일치 또는 미확인")
  if (!requireIdentity && info?.법령ID && law.lawId && String(info.법령ID) !== law.lawId) throw Error("법령 ID 불일치")
  const date = String(info?.시행일자 || "")
  if ((efYd && date !== efYd) || (/^\d{8}$/.test(date) && date > todayKst())) throw Error("법령 시행 버전 불일치")
  const units = raw?.조문?.조문단위
  const matches = (Array.isArray(units) ? units : units ? [units] : []).filter(u =>
    u?.조문여부 === "조문" && String(u.조문번호 ?? "").padStart(4, "0") + String(u.조문가지번호 || "0").padStart(2, "0") === jo)
  if (matches.length !== 1) throw Error("정확한 조문을 원문에서 유일하게 식별하지 못함")
  const unit = matches[0]
  const formatted = formatArticleUnit({ ...unit, 조문번호: String(Number(unit.조문번호)), 조문가지번호: String(Number(unit.조문가지번호 || 0)) })
  if (!formatted?.body?.trim() || /^(?:제\d+조(?:의\d+)?\s*)?(?:\([^)]*\)\s*)?삭제\s*(?:<[^>]*>)?$/.test(formatted.body.trim())) throw Error("조문 본문 없음 또는 삭제")
  return { ...formatted, effectiveDate: /^\d{8}$/.test(date) ? date : undefined }
}

export async function traceStatuteReferences(api: LawApiClient, input: { law: LawInfo; articles: readonly string[]; apiKey?: string }): Promise<ToolResponse> {
  const lines = ["[BOUNDED_STATUTE_REFERENCE_TRACE] 원문 명시 인용 추적", "※ 「법령명」 제N조 형태만 추적합니다. 인용 존재와 적용·준용 범위·법령 충돌 판단은 구별합니다. 현행 검색 버전(MST) 기준이며 과거 기준일은 미지원."]
  const roots = [...new Set(input.articles)].slice(0, MAX_ROOTS)
  const queue: Node[] = []
  const seen = new Set<string>()
  const resolved = new Map<string, LawInfo | undefined>([[input.law.lawName, input.law]])
  let targets = 0, verified = 0, rootVerified = 0, missing = 0, omitted = 0, searches = 0
  const deferred: string[] = []
  for (const article of roots) {
    try { const key = keyFor(input.law, article); if (!seen.has(key)) { seen.add(key); queue.push({ law: input.law, article, depth: 0 }) } }
    catch { lines.push(`[NOT_VERIFIED] 시작 조문번호 오류: ${article}`); missing++ }
  }
  if (input.articles.length > MAX_ROOTS) { omitted += input.articles.length - MAX_ROOTS; lines.push(`[PARTIAL] 시작 조문 한도 ${MAX_ROOTS}개: ${input.articles.slice(MAX_ROOTS).join(", ")}`) }
  while (queue.length) {
    throwIfRequestCancelled()
    const node = queue.shift()!
    let record: ArticleRecord
    try { record = await readExactArticle(api, node.law, node.article, input.apiKey) }
    catch (e) { rethrowIfFatal(e); missing++; lines.push(`[NOT_VERIFIED] ${node.law.lawName} ${node.article}: ${e instanceof Error ? e.message.slice(0, 120) : "조회 실패"}`); continue }
    const label = `${node.law.lawName} ${node.article}`
    if (node.depth) { verified++; lines.push(`[TARGET_VERIFIED] 깊이 ${node.depth} | ${label} | MST ${node.law.mst} | 시행일 ${record.effectiveDate || "미확인"}\n${record.header}\n${truncateResponse(record.body, 1300)}`) }
    if (!node.depth) { rootVerified++; lines.push(`[ROOT_VERIFIED] ${label} | MST ${node.law.mst} | 시행일 ${record.effectiveDate || "미확인"}`) }
    const refs = extractNamedStatuteReferences(record.body,true)
    if (record.body.length > MAX_BODY || refs.length >= MAX_CANDIDATES) { omitted++; lines.push(`[PARTIAL] ${label}: 원문 검색 범위 상한 도달`) }
    if (!refs.length && node.depth === 0) lines.push(`[NO_EXPLICIT_MATCH] ${label}: 지원 표기에서 인용을 찾지 못함. 다른 참조가 없다는 의미는 아님.`)
    const edgeKeys = new Set<string>()
    for (const ref of refs) {
      const edgeKey = `${ref.lawName}:${ref.article}:${ref.relation}:${ref.relationEvidence?.kind??"CITATION_WORDING"}`
      if (edgeKeys.has(edgeKey)) continue
      edgeKeys.add(edgeKey)
      if (node.depth >= MAX_DEPTH || targets >= MAX_TARGETS || (!resolved.has(ref.lawName) && searches >= MAX_LAW_SEARCHES)) {
        omitted++
        if (deferred.length < 10) deferred.push(`${label} → ${ref.lawName} ${ref.article}`)
        continue
      }
      const edge = `${label} → ${ref.lawName} ${ref.article} (${ref.relation === "JUNYONG_WORDING" ? "준용 문언" : "명시 인용"})`
      let law: LawInfo | undefined
      try {
        if (!resolved.has(ref.lawName)) {
          searches++
          const matches = (await findLaws(api, ref.lawName, input.apiKey, 100)).filter(l => l.mst && sameLawName(l.lawName, ref.lawName) && (!l.effectiveDate || l.effectiveDate <= todayKst()))
          const unique = [...new Map(matches.map(l => [l.mst, l])).values()]
          resolved.set(ref.lawName, unique.length === 1 ? unique[0] : undefined)
        }
        law = resolved.get(ref.lawName)
      } catch (e) { rethrowIfFatal(e); resolved.set(ref.lawName, undefined) }
      if (!law) { targets++; missing++; lines.push(`[NOT_VERIFIED] ${edge} | 공식 법령명/버전 식별 실패`); continue }
      const key = keyFor(law, ref.article)
      const relationNote = ref.relationEvidence ? " | 관계문언: "+ref.relationEvidence.kind+" ("+ref.relationEvidence.wording+"; 효력 미판정)" : " | 관계문언: CITATION_WORDING"
      if (seen.has(key)) { lines.push(`[ALREADY_SEEN] ${edge} | 중복·순환 재조회 방지 | 원문 표기: ${ref.wording}${relationNote}`); continue }
      targets++; seen.add(key)
      lines.push(`[REFERENCE_FOUND] ${edge} | 원문 표기: ${ref.wording}${relationNote}`)
      queue.push({ law, article: ref.article, depth: node.depth + 1 })
    }
  }
  lines.splice(2, 0, `범위: 시작 최대 ${MAX_ROOTS}조문 / 대상 최대 ${MAX_TARGETS}조문 / 깊이 ${MAX_DEPTH}. 시작 원문 확인 ${rootVerified}건, 대상 원문 확인 ${verified}건, 미확인 ${missing}건, 범위 제한 ${omitted}건.`)
  if (omitted) lines.push(`[PARTIAL] 범위 제한으로 추가 참조 ${omitted}건 이상 미추적. 전체 참조 목록이 아닙니다.`)
  if (deferred.length) lines.push("미추적 후보 (최대 10건):\n" + deferred.join("\n"))
  if (!rootVerified) {
    // A chain error section clips the returned text. Lead with the diagnostic.
    const cause = lines.find(line => line.startsWith("[NOT_VERIFIED]"))
    if (cause) lines.unshift(cause)
  }
  return { content: [{ type: "text", text: truncateResponse(lines.join("\n\n"), 16000) }], ...(rootVerified ? {} : { isError: true }) }
}
