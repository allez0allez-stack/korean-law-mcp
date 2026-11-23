import { afterEach, describe, expect, it, vi } from "vitest"
import { legalResearch, LegalResearchSchema, shouldPreferIpoStatutoryGrounding } from "./legal-research.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const ACT = "자본시장과 금융투자업에 관한 법률"

function client(): LawApiClient {
  return {
    async searchLaw(q: string) {
      if (q !== ACT) return '<LawSearch><totalCnt>0</totalCnt></LawSearch>'
      return `<LawSearch><totalCnt>1</totalCnt><law><법령명한글>${ACT}</법령명한글><법령일련번호>285957</법령일련번호><법령ID>010513</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`
    },
    async getLawText() {
      return JSON.stringify({ 법령: { 조문: { 조문단위: [
        { 조문여부:"조문", 조문번호:"119", 조문가지번호:"4", 조문제목:"주권의 사전 청약", 조문내용:"법률 제119조의4 사전 청약" },
      ] } } })
    },
    async getThreeTier() { return "{}" },
    async fetchApi() { throw Error("generic aiSearch should not determine cornerstone source") },
  } as unknown as LawApiClient
}

const mockHtml = `<html><body>증권 인수업무 등에 관한 규정 개정 2026. 11. 12
 제5조의5(사전청약투자자 참여자격 및 확인 등) 주금납입능력이 사전청약 금액의 20배 이상일 것.
 </body></html>`

describe("LegalResearch default routing to official IPO legal authorities", () => {
  afterEach(() => { vi.unstubAllGlobals(); lawCache.clear() })

  it("routes only official-rule criteria questions, never litigation or unrelated laws", () => {
    expect(shouldPreferIpoStatutoryGrounding("코너스톤투자자 사전청약 참여자격 및 금융투자협회 규정")).toBe(true)
    expect(shouldPreferIpoStatutoryGrounding("사전수요조사 자격 기준")).toBe(true)
    expect(shouldPreferIpoStatutoryGrounding("코너스톤투자자 관련 판례")).toBe(false)
    expect(shouldPreferIpoStatutoryGrounding("코너스톤투자자 관련 민법 제750조")).toBe(false)
    expect(shouldPreferIpoStatutoryGrounding("관세법 체계")).toBe(false)
  })

  it("default full_research returns official article and self-regulatory tier", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.includes("revisionlist.do") ? `<table><tr><td><a href="revisionView.do?historySeq=1820">증권 인수업무 등에 관한 규정</a></td><td>2026-11-12</td></tr></table>` : mockHtml, {status:200, headers:{"content-type":"text/html"}})))
    const input = LegalResearchSchema.parse({query:"코너스톤투자자 사전청약 참여자격 및 금융투자협회 규정"})
    expect(input.task).toBe("full_research")
    const result = await legalResearch(client(), input)
    const s = result.content[0]?.text || ""
    expect(s).toContain("공식 규정·참여요건 질의로 판정")
    expect(s).toContain("법체계 확인: 자본시장과 금융투자업에 관한 법률")
    expect(s).toContain("제119조의4")
    expect(s).toContain("협회 자율규정 공식 원문")
    expect(s).not.toContain("종합 리서치:")
  })
})
