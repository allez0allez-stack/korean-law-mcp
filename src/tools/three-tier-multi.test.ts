import { beforeEach, describe, expect, it, vi } from "vitest"
import { getThreeTier, getThreeTierForArticles } from "./three-tier.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
const row = (n: string, branch = "00", body = `법 제${Number(n)}조의 내용`) => ({조번호:n, 조가지번호:branch, 조제목:`원조문 ${n}-${branch}`, 시행령조문:{조번호:n, 조가지번호:branch, 조내용:body}})
function client(rows: ReturnType<typeof row>[]) {
  const fetch = vi.fn(async () => JSON.stringify({LspttnThdCmpLawXService:{기본정보:{법령명:"검증법",시행령명:"검증법 시행령"},위임조문삼단비교:{법률조문:rows}}}))
  return {api:{getThreeTier:fetch} as unknown as LawApiClient, fetch}
}
describe("generic multi-article delegation", () => {
  beforeEach(() => lawCache.clear())
  it("fetches once and selects only exact requested article/branch in request order", async () => {
    const c=client([row("0012"),row("0020"),row("0020","01"),row("0021")])
    const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:["제20조의1","제12조"]})).content[0].text
    expect(c.fetch).toHaveBeenCalledTimes(1); expect(s).toContain("연결 목록 확인 2개")
    expect(s.indexOf("▶ 위임관계 제20조의1")).toBeLessThan(s.indexOf("▶ 위임관계 제12조")); expect(s).not.toContain("▶ 위임관계 제21조"); expect(s).not.toContain("▶ 위임관계 제20조\n")
  })
  it("reports missing requested articles without substituting others", async () => {
    const c=client([row("0012"),row("0020")]); const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:["제12조","제999조"]})).content[0].text
    expect(s).toContain("[NOT_FOUND] 제999조"); expect(s).toContain("위임관계 부존재를 단정하지 않습니다"); expect(s).not.toContain("▶ 위임관계 제20조")
  })
  it("reports missing links even when the official data contains no linked articles", async () => {
    const c=client([]); const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:["제750조","제751조"]})).content[0].text
    expect(s).toContain("[NOT_FOUND] 제750조"); expect(s).toContain("[NOT_FOUND] 제751조")
  })
  it("deduplicates requests and separates single and multiple response caches", async () => {
    const c=client([row("0012"),row("0020")]); await getThreeTier(c.api,{mst:"100",jo:"제12조",knd:"2"})
    const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:["제12조","제 12조","제20조"]})).content[0].text
    expect(c.fetch).toHaveBeenCalledTimes(2); expect(s).toContain("요청 2개"); expect(s).toContain("▶ 위임관계 제20조")
    await getThreeTierForArticles(c.api,{mst:"100",articles:["제12조","제20조"]}); expect(c.fetch).toHaveBeenCalledTimes(2)
  })
  it("explicitly marks requests beyond bounded coverage", async () => {
    const c=client(Array.from({length:7},(_,i)=>row(String(i+1)))); const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:Array.from({length:7},(_,i)=>`제${i+1}조`)})).content[0].text
    expect(s).toContain("[PARTIAL]"); expect(s).toContain("미조회: 제6조, 제7조"); expect(s).not.toContain("▶ 위임관계 제6조")
  })
  it("preserves a later article even when first delegated body is enormous", async () => {
    const c=client([row("0012","00","법 제12조에 따른 "+"가".repeat(40000)),row("0020")]); const s=(await getThreeTierForArticles(c.api,{mst:"100",articles:["제12조","제20조"]})).content[0].text
    expect(s).toContain("▶ 위임관계 제20조"); expect(s.length).toBeLessThan(15000)
  })
  it("rejects invalid article inputs before official lookup", async () => {
    const c=client([]); const r=await getThreeTierForArticles(c.api,{mst:"100",articles:["제12조","invalid"]}); expect(r.isError).toBe(true); expect(c.fetch).not.toHaveBeenCalled()
  })
})
