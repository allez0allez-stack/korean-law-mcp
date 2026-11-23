import { afterEach, describe, expect, it, vi } from "vitest"
import { parseKofiaLatestIpoVersion, latestRevisionDateInRule, KOFIA_REVISION_INDEX_URL } from "./kofia-version-resolver.js"
import { getKofiaIpoRuleEvidence, fetchKofiaOfficialHtml } from "./official-industry-rule.js"
import type { LawApiClient } from "../lib/api-client.js"

const client = {} as LawApiClient
const row = (seq: string, date: string, title = "증권 인수업무 등에 관한 규정") =>
  '<tr><td>1448</td><td><a href="/service/revision/revisionView.do?historySeq=' +
  seq + '">' + title + '</a></td><td>개정</td><td>' + date + '</td></tr>'
const listing = (rows: string) => "<html><table>" + rows + "</table></html>"
const rule = (date = "2026. 11. 12") =>
  "<html><body><h1>증권 인수업무 등에 관한 규정</h1>" +
  "제정 2008. 12. 30 개정 2026. 3. 12 개정 " + date +
  " 제1장 총칙 제5조의5(사전청약투자자 참여자격 및 확인 등) 20배 이상</body></html>"

describe("KOFIA current self-regulation revision resolution (#29)", () => {
  afterEach(() => vi.restoreAllMocks())

  it("selects newest linked version from the official index", () => {
    expect(parseKofiaLatestIpoVersion(listing(row("1820", "2026-11-12") +
      row("1782", "2026-03-12")))).toMatchObject({ historySeq: "1820", amendedOn: "2026-11-12" })
  })

  it("adopts future amendment without changing hard-coded historySeq", () => {
    expect(parseKofiaLatestIpoVersion(listing(row("1902", "2027-01-05") +
      row("1820", "2026-11-12")))?.historySeq).toBe("1902")
  })

  it("rejects similarly named execution rules, missing URLs and wrong names", () => {
    expect(parseKofiaLatestIpoVersion(listing(row("1960", "2027-02-02", "증권 인수업무 등에 관한 규정 시행세칙") +
      row("1902", "2027-01-05")))?.historySeq).toBe("1902")
    expect(parseKofiaLatestIpoVersion(listing('<tr><td>1448</td><td>증권 인수업무 등에 관한 규정</td><td>2026-11-12</td></tr>'))).toBeNull()
    expect(parseKofiaLatestIpoVersion(listing(row("1820", "2026-11-12", "다른 규정")))).toBeNull()
  })

  it("verifies the latest revision only from the statute-like preamble, not body amendments", () => {
    expect(latestRevisionDateInRule(rule())).toBe("2026-11-12")
    expect(latestRevisionDateInRule("증권 인수업무 등에 관한 규정 개정 2026. 3. 12 제1장 총칙 제5조 본문 개정 2027. 1. 1")).toBe("2026-03-12")
  })

  it("returns verified self-regulation evidence only if latest index and content match", async () => {
    const res=await getKofiaIpoRuleEvidence(client,{
      query:"코너스톤투자자",lawName:"자본시장과 금융투자업에 관한 법률",
      loadIndexHtml: async()=>listing(row("1820","2026-11-12")),
      loadHtml: async()=>rule(),
    })
    expect(res.isError).toBeFalsy()
    expect(res.content[0].text).toContain("LATEST_INDEX_VERIFIED")
    expect(res.content[0].text).toContain("2026-11-12 개정 목록·본문 연혁 대조 PASS")
  })

  it("fails closed if exact rule is missing or index date conflicts with body", async () => {
    const params={query:"코너스톤투자자",lawName:"자본시장과 금융투자업에 관한 법률"}
    const missing=await getKofiaIpoRuleEvidence(client,{...params,
      loadIndexHtml:async()=>listing(row("1820","2026-11-12","다른 규정")),
      loadHtml:async()=>rule(),
    })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain("LATEST_UNVERIFIED")
    const mismatch=await getKofiaIpoRuleEvidence(client,{...params,
      loadIndexHtml:async()=>listing(row("1902","2027-01-05")),
      loadHtml:async()=>rule(),
    })
    expect(mismatch.isError).toBe(true)
    expect(mismatch.content[0].text).toContain("일치하지 않습니다")
  })

  it("only permits the official index and fixed-host numeric revision URLs", async () => {
    await expect(fetchKofiaOfficialHtml("http://127.0.0.1/admin")).rejects.toThrow("허용목록")
    await expect(fetchKofiaOfficialHtml(
      "https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq=https://evil&seq=140"
    )).rejects.toThrow("허용목록")
  })

  it("fetches official index first and its resolved version second", async () => {
    const urls:string[]=[]
    const spy=vi.spyOn(globalThis,"fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url=String(input);urls.push(url)
      return new Response(url===KOFIA_REVISION_INDEX_URL?
        listing(row("1820","2026-11-12")):rule(),{status:200,headers:{"content-type":"text/html; charset=utf-8"}})
    })
    const res=await getKofiaIpoRuleEvidence(client,{query:"코너스톤투자자",lawName:"자본시장과 금융투자업에 관한 법률"})
    expect(res.isError).toBeFalsy()
    expect(urls).toHaveLength(2)
    expect(urls[0]).toBe(KOFIA_REVISION_INDEX_URL)
    expect(urls[1]).toContain("historySeq=1820&seq=140")
    expect(spy).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:"manual"}))
  })
})
