import { beforeEach, describe, expect, it, vi } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { findExplicitDecreeCitations, getThreeTier } from "./three-tier.js"
import { getAdminRule } from "./admin-rule.js"

vi.mock("./admin-rule.js", () => ({
  getAdminRule: vi.fn(async () => ({
    content: [{
      type: "text", text: "행정규칙명: 금융투자업규정\n시행일: 2026.09.09\n[본문 검색: 제271조의10]\n\n제7-41조의7(보고 서류 등)\n⑧ 영 제271조의10제13항제4호에서 금융위원회가 정하여 고시하는 사항은 다음 각 호이다. ⑩ 영 제271조의10제15항제6호에서 고시하는 회사란 다음 각 호를 말한다.",
    }],
  })),
}))

const fixture = {
  LspttnThdCmpLawXService: {
    기본정보: { 법령명: "자본시장법", 시행령명: "자본시장법 시행령" },
    위임조문삼단비교: { 법률조문: {
      조번호:"0249",조가지번호:"07",조제목:"일반 사모집합투자기구",
      시행령조문:{조번호:"0271",조가지번호:"10",조내용:"① 법 제249조의7제1항에 따른다. ⑱ 금융위원회가 정하여 고시한다."},
    }},
  },
}
const client = {getThreeTier: vi.fn(async () => JSON.stringify(fixture))} as unknown as LawApiClient

describe("specific decree→notice cross-reference", () => {
  beforeEach(() => {vi.clearAllMocks(); lawCache.clear()})

  it("matches exact implementing-decree citation including branch and not the parent or adjacent articles", () => {
    expect(findExplicitDecreeCitations("제271조의10", "⑧ 영 제271조의10제13항제4호에서 정한 사항")).toHaveLength(1)
    expect(findExplicitDecreeCitations("제271조의10", "⑧ 영 제271조의100제13항에서 정한 사항")).toHaveLength(0)
    expect(findExplicitDecreeCitations("제271조", "⑧ 영 제271조의10제13항에서 정한 사항")).toHaveLength(0)
    expect(findExplicitDecreeCitations("제271조의10", "본문 검색: 제271조의10")).toHaveLength(0)
    expect(findExplicitDecreeCitations("제271조의10", "법 제271조의10")).toHaveLength(0)
    expect(findExplicitDecreeCitations("제271조의10", "관련 규정의 번호")).toHaveLength(0)
  })

  it("adds linked official notice citations only on explicit exact-article request", async () => {
    const out = await getThreeTier(client,{mst:"notice-fixture",jo:"제249조의7",knd:"2",adminRuleId:"2100000285020"})
    const t=out.content[0].text
    expect(out.isError).not.toBe(true)
    expect(t).toContain("금융투자업규정")
    expect(t).toContain("제7-41조의7")
    expect(t).toContain("[고시 본문 직접 인용 후보]")
    expect(t).toContain("영 제271조의10제13항")
    expect(t).toContain("적법성은 확인하지 않았습니다")
    expect(getAdminRule).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getAdminRule).mock.calls[0][1]).toMatchObject({id:"2100000285020",keyword:"제271조의10",max_results:5})
  })

  it("refuses a historical asOf before requesting current three-tier or notice data", async () => {
    const result = await getThreeTier(client,{mst:"notice-fixture",jo:"제249조의7",adminRuleId:"2100000285020",asOf:"20250101",knd:"2"})
    expect(result.content[0].text).toContain("[NOT_VERIFIED]")
    expect(result.content[0].text).toContain("현행본을 과거·미래 법령으로 대체하지 않습니다")
    expect(client.getThreeTier).not.toHaveBeenCalled()
    expect(getAdminRule).not.toHaveBeenCalled()
  })

  it("refuses a future-effective notice instead of reporting matching historical scope", async () => {
    vi.mocked(getAdminRule).mockResolvedValueOnce({content:[{type:"text",text:"행정규칙명: 미래 고시\\n시행일: 2099.01.01\\n영 제271조의10제13항"}]})
    const result=await getThreeTier(client,{mst:"notice-fixture",jo:"제249조의7",adminRuleId:"2100000285020",knd:"2"})
    expect(result.content[0].text).toContain("[NOT_VERIFIED]")
    expect(result.content[0].text).not.toContain("[고시 본문 직접 인용 후보]")
  })

  it("rejects unscoped lookup without consuming a notice call", async () => {
    const out=await getThreeTier(client,{mst:"notice-fixture",adminRuleId:"2100000285020",knd:"2"})
    expect(out.isError).toBe(true)
    expect(getAdminRule).not.toHaveBeenCalled()
  })

  it("does not present a searched notice as a verified match when it lacks the decree citation", async () => {
    vi.mocked(getAdminRule).mockResolvedValueOnce({content:[{type:"text",text:"행정규칙명: 다른 규정\n시행일: 2026.09.09\n본문 검색: 제271조의10\n제1조(목적) 법 제249조의7을 규정한다."}]})
    const out=await getThreeTier(client,{mst:"notice-fixture",jo:"제249조의7",knd:"2",adminRuleId:"2100000285020"})
    expect(out.content[0].text).toContain("[직접 인용 미확인]")
    expect(out.content[0].text).not.toContain("[고시 본문 직접 인용 후보]")
  })

  it("does not treat historical or invalid official text as verified", async () => {
    vi.mocked(getAdminRule).mockResolvedValueOnce({content:[{type:"text",text:"행정규칙명: 금융투자업규정\n⚠️ 연혁본\n영 제271조의10"}]})
    const out=await getThreeTier(client,{mst:"notice-fixture",jo:"제249조의7",knd:"2",adminRuleId:"2100000285020"})
    expect(out.content[0].text).toContain("[NOT_VERIFIED]")
  })
})
