import { describe, expect, it, vi } from "vitest"
import { getKofiaIpoRuleEvidence, htmlRuleText, extractKofiaArticleEvidence, shouldReadKofiaIpoRule, fetchKofiaOfficialHtml } from "./official-industry-rule.js"
import type { LawApiClient } from "../lib/api-client.js"

const ACT = "자본시장과 금융투자업에 관한 법률"
const SAMPLE = `<html><head><script>alert('x')</script></head><body>
<h1>증권 인수업무 등에 관한 규정</h1>
<p>개정 2026. 11. 12</p>
<table><tr><td>제5조의4(사전수요조사 참여자격 및 확인)</td><td>① 사전수요조사 참여자는 전문투자자여야 한다.</td></tr>
<tr><td>제5조의5(사전청약투자자 참여자격 및 확인 등)</td><td>① 조건부 검증</td></tr>
<tr><td>제5조의7(사전청약투자자계약의 체결 등)</td><td>① 계약을 체결해야 한다.</td></tr>
<tr><td>제9조의3(사전청약투자자 주식의 배정)</td><td>① 주식 배정</td></tr></table>
</body></html>`

const INDEX = '<table><tr><td><a href="revisionView.do?historySeq=1820">증권 인수업무 등에 관한 규정</a></td><td>2026-11-12</td></tr></table>'
const client = {} as LawApiClient

describe("KOFIA evidence is a distinct official association rule, not a statute", () => {
  it("routes only capital-markets-related cornerstone/IPO topics", () => {
    expect(shouldReadKofiaIpoRule("코너스톤투자자 참여조건", ACT)).toBe(true)
    expect(shouldReadKofiaIpoRule("부동산임대차", ACT)).toBe(false)
    expect(shouldReadKofiaIpoRule("코너스톤투자자", "부동산투자회사법")).toBe(false)
  })
  it("strips scripts and extracts official section numbers from HTML", () => {
    expect(htmlRuleText(SAMPLE)).not.toContain("alert")
    expect(extractKofiaArticleEvidence(SAMPLE).map(x => x.article)).toEqual(["제5조의4", "제5조의5", "제5조의7", "제9조의3"])
  })
  it("renders section evidence with provenance and snapshot caveat", async () => {
    const res = await getKofiaIpoRuleEvidence(client, { query:"코너스톤투자자 참여조건", lawName: ACT, loadHtml: async () => SAMPLE, loadIndexHtml: async () => INDEX })
    const out = res.content[0].text
    expect(out).toContain("OFFICIAL_SELF_REGULATION / LATEST_INDEX_VERIFIED")
    expect(out).toContain("2026-11-12 개정 목록·본문 연혁 대조 PASS")
    expect(out).toContain("제5조의4")
    expect(out).toContain("law.kofia.or.kr")
    expect(out).toContain("협회 자율규정")
  })
  it("does not fabricate rule text on fetch failures", async () => {
    const res = await getKofiaIpoRuleEvidence(client, { query:"코너스톤투자자", lawName: ACT, loadHtml: async () => {throw Error("Network unavailable")}, loadIndexHtml: async () => INDEX })
    expect(res.isError).toBeTruthy()
    expect(res.content[0].text).toContain("원문 조회 미완료")
    expect(res.content[0].text).toContain("law.kofia.or.kr")
  })
  it("rejects unexpected redirects and arbitrary forwarding", async () => {
    const orig = globalThis.fetch
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {status:302, headers:{location:"https://127.0.0.1/admin",'content-type':'text/html'}}))
    try {
      await expect(fetchKofiaOfficialHtml()).rejects.toThrow(/HTTP 302/)
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("law.kofia.or.kr"), expect.objectContaining({redirect:"manual"}))
    } finally { spy.mockRestore(); globalThis.fetch = orig }
  })
})
