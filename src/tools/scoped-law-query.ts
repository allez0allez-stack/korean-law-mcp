/** Conservative explicit statute/article grouping, independent of legal domain. */
import type { LawInfo } from "../lib/law-search.js"
import type { ToolResponse } from "../lib/types.js"
import { truncateResponse } from "../lib/schemas.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"

export interface ScopedLawGroup { lawName: string; articles: string[] }
export interface ScopedLawPlan { groups: ScopedLawGroup[]; unresolved: string[] }
const MAX_LAWS = 3
const MAX_ARTICLES = 5
const LAW_NAME = /^[가-힣A-Za-z0-9·ㆍ‧•・(),\s-]{1,120}(?:법률|법|시행령|시행규칙|조례|규칙|규정)$/
const SUFFIX_ONLY = /^(?:법률|법|시행령|시행규칙|조례|규칙|규정)$/
const JOIN = /^(?:[·ㆍ‧•・,;\/&]+\s*|(?:및|또는|그리고|와|과|하고|이랑|랑|vs\.?)(?:\s+|$))/i
const SAME = /^(?:같은\s*법(?:률)?|동법)(?:\s*(시행령|시행규칙))?$/
const normalize = (s: string) => s.normalize("NFC").replace(/\s+/g, "")
const canonicalArticle = (n: string, b?: string) => `제${Number(n)}조${b ? `의${Number(b)}` : ""}`

export function planScopedLawQuery(query: string): ScopedLawPlan | null {
  if (query.length > 2000) return null
  const groups = new Map<string, ScopedLawGroup>()
  const unresolved: string[] = []
  let active: ScopedLawGroup | undefined
  let end = 0
  let suspiciousBoundary = false
  for (const m of query.matchAll(/(?<!\d)(?:제\s*)?(\d{1,4})\s*조(?:\s*의\s*(\d{1,2}))?(?:\s*제?\s*\d+\s*항)?(?:\s*제?\s*\d+\s*호)?(?!\d|례)/g)) {
    const i = m.index!
    let context = query.slice(end, i).trim()
    const afterFirst = end > 0
    end = i + m[0].length
    if (afterFirst) {
      while (JOIN.test(context)) context = context.replace(JOIN, "").trim()
    }
    context = context.replace(/^[「『“"(]|[」』”")]$/g, "").trim()
    const article = canonicalArticle(m[1], m[2])
    const same = context.match(SAME)
    if (same && active) {
      context = active.lawName.replace(/\s*(?:시행령|시행규칙)$/, "") + (same[1] ? ` ${same[1]}` : "")
    }
    if (!context && active) {
      if (!active.articles.includes(article)) active.articles.push(article)
      continue
    }
    if (!LAW_NAME.test(context) || SUFFIX_ONLY.test(context) || SAME.test(context)) {
      // Do not silently fall back to the first law when an apparent second
      // legal name is malformed or its ownership cannot be resolved.
      if (/(?:법률|법|시행령|시행규칙|조례|규칙|규정)[」』”")\s]*$/.test(context)) suspiciousBoundary = true
      unresolved.push(`${context.slice(0, 100)} ${article}`.trim())
      active = undefined
      continue
    }
    const key = normalize(context)
    active = groups.get(key) ?? { lawName: context, articles: [] }
    groups.set(key, active)
    if (!active.articles.includes(article)) active.articles.push(article)
  }
  // A single-law request retains its existing behavior. This is an explicit
  // multi-law list parser, not an inference engine for unstructured questions.
  if (groups.size < 2 && !(groups.size === 1 && suspiciousBoundary)) return null
  return { groups: [...groups.values()], unresolved }
}

export function shouldRouteScopedResearch(query: string): boolean {
  return !/판례|판결|소송|분쟁|심판|개정\s*이력|시점\s*비교|과거\s*법령|경과조치/.test(query)
    && !/\d{4}\s*년|\d{4}[-.]\d{1,2}[-.]\d{1,2}/.test(query)
    && planScopedLawQuery(query) !== null
}

export async function runScopedLawQuery(
  plan: ScopedLawPlan,
  options: { articles?: readonly string[] },
  resolve: (name: string) => Promise<LawInfo | undefined>,
  read: (law: LawInfo, articles: string[]) => Promise<ToolResponse>,
): Promise<ToolResponse> {
  const out = ["═══ 복수 법령별 근거 조회 ═══", "※ 법령별로 조 단위의 현행 근거를 분리합니다(항·호·목 별도 검증). 법령 간 우선순위·충돌·적용관계에 대한 법률 판단은 별도 검토가 필요합니다."]
  if (options.articles?.length) {
    const inline = new Set(plan.groups.flatMap(g => g.articles))
    const explicit = new Set(options.articles.map(normalize))
    if (inline.size !== explicit.size || [...explicit].some(a => !inline.has(a))) {
      return { content: [{ type: "text", text: "[AMBIGUOUS] 복수 법령 질의와 articles의 조문번호가 일치하지 않습니다. 각 법령명 뒤에 조문번호를 명시하고 articles는 생략하거나 법령별로 따로 조회하십시오." }], isError: true }
    }
  }
  if (plan.unresolved.length) out.push(`[PARTIAL] 귀속 미확인으로 미조회: ${plan.unresolved.join(", ")}`)
  if (plan.groups.length > MAX_LAWS) out.push(`[PARTIAL] 법령 조회 한도 초과: ${plan.groups.slice(MAX_LAWS).map(g => g.lawName).join(", ")}`)
  const selected = plan.groups.slice(0, MAX_LAWS)
  // Each callback must establish exact official identity before fetching any article.
  const results = await Promise.all(selected.map(async group => {
    const articles = group.articles.slice(0, MAX_ARTICLES)
    const lines = [`▶ 요청 법령: ${group.lawName} | ${articles.join(", ")}`]
    if (group.articles.length > MAX_ARTICLES) lines.push(`[PARTIAL] 미조회 조문: ${group.articles.slice(MAX_ARTICLES).join(", ")}`)
    try {
      const law = await resolve(group.lawName)
      if (!law) return { ok: false, text: [...lines, "[NOT_VERIFIED] 정확한 공식 법령명/버전을 식별하지 못했습니다. 다른 법령으로 대체하지 않습니다."].join("\n") }
      const result = await read(law, articles)
      if (result.isError) lines.push("[PARTIAL] 해당 법령의 조회가 실패했습니다.")
      lines.push(truncateResponse(result.content.map(c => c.text).join("\n"), 12000))
      return { ok: !result.isError, text: lines.join("\n") }
    } catch (error) {
      rethrowIfFatal(error)
      return { ok: false, text: [...lines, "[NOT_VERIFIED] 해당 법령의 검색 또는 원문 조회 중 오류가 발생했습니다."].join("\n") }
    }
  }))
  out.push(...results.map(r => r.text))
  return { content: [{ type: "text", text: truncateResponse(out.join("\n\n")) }], ...(results.some(r => r.ok) ? {} : { isError: true }) }
}
