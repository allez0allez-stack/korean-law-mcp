import { beforeEach, describe, expect, it, vi } from "vitest"
import { discoverTopicArticles, namedStatuteForTopic, rankOfficialArticleHeadings, shouldDiscoverTopicArticles } from "./law-topic-articles.js"
import { chainLawSystem } from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const ACT = "자본시장과 금융투자업에 관한 법률"
const UNITS = [
  { 조문여부: "조문", 조문번호: "119", 조문가지번호: "3", 조문제목: "주권의 사전수요조사", 조문내용: "제119조의3(주권의 사전수요조사)" },
  { 조문여부: "조문", 조문번호: "119", 조문가지번호: "4", 조문제목: "주권의 사전 청약", 조문내용: "제119조의4(주권의 사전 청약)" },
  { 조문여부: "조문", 조문번호: "14", 조문가지번호: "8", 조문제목: "일반 청약 정보의 공개", 조문내용: "무관한 부동산 조문" },
  { 조문여부: "전문", 조문번호: "119", 조문가지번호: "0", 조문제목: "총칙" },
]

function client() {
  const stats = { lawSearch: [] as string[], getText: 0, threeTier: 0 }
  const api = {
    async searchLaw(q: string) {
      stats.lawSearch.push(q)
      if (!q.includes(ACT)) return '<LawSearch><totalCnt>0</totalCnt></LawSearch>'
      return `<LawSearch><totalCnt>1</totalCnt><law><법령명한글>${ACT}</법령명한글><법령일련번호>285957</법령일련번호><법령ID>010513</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`
    },
    async getLawText() {
      stats.getText++
      return JSON.stringify({ 법령: { 기본정보: { 법령명_한글: ACT }, 조문: { 조문단위: UNITS } } })
    },
    async getThreeTier() { stats.threeTier++; return "{}" },
    async fetchApi() { throw Error("aiSearch must not determine the statute for cornerstone") },
  }
  return { api: api as unknown as LawApiClient, stats }
}

describe("topic articles: only verified official headings may nominate an article", () => {
  beforeEach(() => lawCache.clear())

  it("maps the documented cornerstone term to Capital Markets Act, not REITs", () => {
    expect(namedStatuteForTopic("코너스톤투자자 사전청약 투자 요건")).toBe(ACT)
    expect(namedStatuteForTopic("일반 청약 정보")).toBeUndefined()
  })
  it("extracts Article 119-4 from query using article heading evidence", () => {
    const found = rankOfficialArticleHeadings("코너스톤투자자 사전청약투자자 금융투자협회 규정 참여 요건", ACT, UNITS)
    expect(found[0]).toMatchObject({ article: "제119조의4", heading: "주권의 사전 청약" })
    expect(found.map(x => x.article)).not.toContain("제14조의8")
  })
  it("maps 사전수요예측 to statutory 사전수요조사", () => {
    expect(rankOfficialArticleHeadings("IPO 사전수요예측 자격", ACT, UNITS)[0]?.article).toBe("제119조의3")
  })
  it("rejects unrelated headings instead of guessing", () => {
    expect(rankOfficialArticleHeadings("미공개 특정 독립 용어", ACT, UNITS)).toEqual([])
    expect(shouldDiscoverTopicArticles("관세법 체계", "관세법")).toBe(false)
  })
  it("auto-discovers official Article 119-4 without AI search", async () => {
    const c = client()
    vi.stubGlobal("fetch", vi.fn(async () => new Response('<html><body>증권 인수업무 등에 관한 규정 제5조의4(사전수요조사 참여자격) 제5조의5(사전청약투자자 참여자격) 개정 2026. 11. 12</body></html>', {status: 200, headers: {'content-type':'text/html'}})))
    const res = await chainLawSystem(c.api, { query: "코너스톤투자자 사전청약투자자 금융투자협회 규정 참여 요건" })
    vi.unstubAllGlobals()
    const out = res.content[0].text
    expect(out).toContain("법체계 확인: " + ACT)
    expect(out).toContain("제119조의4 주권의 사전 청약")
    expect(out).toContain("조문제목 기반 후보")
    expect(out).toContain("핵심 조문 (지정 조문 우선)")
    expect(c.stats.getText).toBeGreaterThan(0)
  })
  it("does not retrieve full headings for a pure statute-name query", async () => {
    const c = client()
    const res = await chainLawSystem(c.api, { query: `${ACT} 체계` })
    expect(res.content[0].text).toContain("3단 비교 (법률·시행령·시행규칙)")
    expect(c.stats.getText).toBe(0)
  })
  it("preserves explicit article priority over inferred topic", async () => {
    const c = client()
    const out = (await chainLawSystem(c.api, { query: "코너스톤투자자", articles: ["제119조의3"] })).content[0].text
    expect(out).not.toContain("조문제목 기반 후보")
    expect(out).toContain("핵심 조문 (지정 조문 우선)")
  })
  it("does not invent an article on upstream failure", async () => {
    const broken = { getLawText: async () => { throw Error("Law API temporary failure") } } as unknown as LawApiClient
    const result = await discoverTopicArticles(broken, { query: "코너스톤투자자", mst: "999987", lawName: ACT })
    expect(result.status).toBe("UNAVAILABLE")
    expect(result.matches).toEqual([])
  })
})
