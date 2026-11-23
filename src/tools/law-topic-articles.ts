/**
 * Topic-to-article discovery for law_system.
 *
 * A broad aiSearch first hit is not authority for an article number: a
 * cornerstone query has returned unrelated REIT articles. Once a statute is
 * positively resolved, read the official statute's article headings and
 * return only strong, explainable heading matches. Never invent article IDs.
 */
import type { LawApiClient } from "../lib/api-client.js"
import { SimpleCache } from "../lib/cache.js"
import { rethrowIfFatal } from "../lib/fatal-errors.js"
import { throwIfRequestCancelled } from "../lib/session-state.js"

export interface TopicArticleMatch {
  article: string
  heading: string
  matchedTerm: string
}

export interface TopicArticleDiscovery {
  status: "MATCH" | "NO_MATCH" | "UNAVAILABLE" | "SKIPPED"
  matches: TopicArticleMatch[]
  reason?: string
}

// Synonyms from official FSC materials and the current Capital Markets Act.
// They translate terminology, not article numbers; actual articles must
// still be found in current official statutory text.
const TOPIC_EQUIVALENTS: Array<{ trigger: RegExp; equivalent: string }> = [
  { trigger: /코너스톤\s*투자자|cornerstone\s*investor/i, equivalent: "사전청약" },
  { trigger: /사전\s*수요\s*예측/, equivalent: "사전수요조사" },
]

/** Authoritative statute for a narrow, officially documented colloquial alias. */
export function namedStatuteForTopic(query: string): string | undefined {
  if (/코너스톤\s*투자자|cornerstone\s*investor|사전\s*청약\s*투자자/i.test(query)) {
    return "자본시장과 금융투자업에 관한 법률"
  }
  if (/IPO.*사전\s*수요\s*예측|사전\s*수요\s*조사/.test(query)) {
    return "자본시장과 금융투자업에 관한 법률"
  }
  return undefined
}

const SKIP_WORDS = new Set([
  "법령", "법률", "시행령", "시행규칙", "체계", "위임", "관련", "규정", "요건",
  "참여", "조건", "기준", "적용", "확인", "조회", "검색", "내용", "정리", "분석",
  "금융투자협회", "대한", "관한", "현행", "개정", "사항", "조문", "규칙",
])

const compact = (v: string) => v.normalize("NFKC").replace(/[^가-힣a-zA-Z0-9]/g, "").toLowerCase()

function queryTerms(query: string, lawName: string): string[] {
  const withoutLaw = query.replace(lawName, " ")
  const candidates = withoutLaw.split(/[\s,·;:()\[\]{}]+/).map(compact)
  for (const { trigger, equivalent } of TOPIC_EQUIVALENTS) {
    if (trigger.test(query)) candidates.push(compact(equivalent))
  }
  return [...new Set(candidates.filter(t => t.length >= 4 && !SKIP_WORDS.has(t)))]
}

export function shouldDiscoverTopicArticles(query: string, lawName: string): boolean {
  return queryTerms(query, lawName).length > 0
}

export function rankOfficialArticleHeadings(
  query: string,
  lawName: string,
  units: Array<{ 조문여부?: string; 조문번호?: string | number; 조문가지번호?: string | number; 조문제목?: string }>,
  max = 3,
): TopicArticleMatch[] {
  const terms = queryTerms(query, lawName)
  if (!terms.length) return []
  const scored: Array<{ score: number; match: TopicArticleMatch }> = []
  for (const unit of units) {
    if (unit.조문여부 !== "조문" || !unit.조문제목 || !unit.조문번호) continue
    const normalizedHeading = compact(unit.조문제목)
    if (normalizedHeading.length < 4) continue
    let best = ""
    let bestScore = 0
    for (const term of terms) {
      // Four consecutive Korean characters minimum; 1-3 char matches like
      // 투자 or 금융 are too weak to select a legal article.
      const n = Math.min(8, term.length)
      for (let len = n; len >= 4; len--) {
        for (let i = 0; i + len <= term.length; i++) {
          const phrase = term.slice(i, i + len)
          if (normalizedHeading.includes(phrase) && len > bestScore) {
            best = phrase
            bestScore = len
          }
        }
        if (bestScore >= len) break
      }
    }
    if (!bestScore) continue
    const articleNo = Number(unit.조문번호)
    const branchNo = Number(unit.조문가지번호 || 0)
    if (!Number.isSafeInteger(articleNo) || articleNo < 1 || articleNo > 9999 ||
        !Number.isSafeInteger(branchNo) || branchNo < 0 || branchNo > 99) continue
    const article = `제${articleNo}조${branchNo ? `의${branchNo}` : ""}`
    scored.push({ score: bestScore, match: { article, heading: unit.조문제목, matchedTerm: best } })
  }
  scored.sort((a, b) => b.score - a.score || a.match.article.localeCompare(b.match.article, "ko"))
  const found = new Set<string>()
  return scored.filter(({ match }) => {
    if (found.has(match.article)) return false
    found.add(match.article)
    return true
  }).slice(0, max).map(({ match }) => match)
}

// Short cache: a full law can occupy multiple MiB; never use shared 500-row cache.
const headingCache = new SimpleCache(4)

export async function discoverTopicArticles(
  apiClient: LawApiClient,
  params: { query: string; lawName: string; mst: string; apiKey?: string },
): Promise<TopicArticleDiscovery> {
  if (!shouldDiscoverTopicArticles(params.query, params.lawName)) return { status: "SKIPPED", matches: [] }
  const cacheKey = `topic-headings:${params.mst}`
  try {
    throwIfRequestCancelled()
    let units = headingCache.get<Array<{ 조문여부?: string; 조문번호?: string | number; 조문가지번호?: string | number; 조문제목?: string }>>(cacheKey)
    if (!units) {
      const law = JSON.parse(await apiClient.getLawText({ mst: params.mst, apiKey: params.apiKey }))?.법령
      const received = law?.조문?.조문단위
      if (!received) return { status: "UNAVAILABLE", matches: [], reason: "공식 법령 조문목차 미수신" }
      units = (Array.isArray(received) ? received : [received]).map(unit => ({
        조문여부: unit?.조문여부,
        조문번호: unit?.조문번호,
        조문가지번호: unit?.조문가지번호,
        조문제목: unit?.조문제목,
      }))
      // Cache just headings, not multi-MB statutory bodies.
      headingCache.set(cacheKey, units, 60 * 60 * 1000)
    }
    const matches = rankOfficialArticleHeadings(params.query, params.lawName, units)
    return { status: matches.length ? "MATCH" : "NO_MATCH", matches }
  } catch (error) {
    rethrowIfFatal(error)
    return { status: "UNAVAILABLE", matches: [], reason: error instanceof Error ? error.message.slice(0, 120) : "원문 조회 실패" }
  }
}
