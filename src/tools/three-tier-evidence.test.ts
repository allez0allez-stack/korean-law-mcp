import { describe, it, expect, beforeEach } from "vitest"
import { classifyDelegationEvidence, getThreeTier } from "./three-tier.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

describe("three-tier delegation evidence (conservative)", () => {
  beforeEach(() => lawCache.clear())

  it("distinguishes explicit parent-law article citations from listed-only links", () => {
    expect(classifyDelegationEvidence("제249조의7", "① 법 제249조의7제1항에 따른 비율")).toBe("explicit_citation")
    expect(classifyDelegationEvidence("제249조의7", "① 법 제249조의70에 따른 비율")).toBe("listed_only")
    expect(classifyDelegationEvidence("제249조", "① 법 제249조의7제1항에 따른 비율")).toBe("listed_only")
    expect(classifyDelegationEvidence("제249조의7", "① 법 제249조제1항에 따른 비율")).toBe("listed_only")
    expect(classifyDelegationEvidence("제249조의7", "① 법 제249 조 의 7 제1항에 따른 비율")).toBe("explicit_citation")
    expect(classifyDelegationEvidence("제249조의7", "")).toBe("listed_only")
    expect(classifyDelegationEvidence("제249조의7", "단지 비율을 정한다")).toBe("listed_only")
    expect(classifyDelegationEvidence("제249조의7", "다른법 제249조의7")).toBe("listed_only")
  })

  it("labels downstream evidence separately without asserting legal delegation validity", async () => {
    const fixture = {
      LspttnThdCmpLawXService: {
        기본정보: { 법령ID: "010513", 법령명: "테스트 법", 시행령명: "테스트 법 시행령" },
        위임조문삼단비교: {
          법률조문: {
            조번호: "0249", 조가지번호: "07", 조제목: "테스트 원조문",
            시행령조문: [
              { 조번호: "0271", 조가지번호: "10", 조제목: "위임 내용", 조내용: "① 법 제249조의7제1항에 따른다." },
              { 조번호: "0272", 조가지번호: "00", 조제목: "연계만 표시", 조내용: "① 규칙에서 정한다." }
            ],
            위임행정규칙목록: { 위임행정규칙: { 위임행정규칙명: "테스트 고시", 위임행정규칙조번호:"0001" } },
          },
        },
      },
    }
    const client = { getThreeTier: async () => JSON.stringify(fixture) } as unknown as LawApiClient
    const result = await getThreeTier(client, { mst: "285957", jo:"제249조의7", knd:"2" })
    const output = result.content[0].text
    expect(result.isError).not.toBe(true)
    expect(output).toContain("[본문 인용 확인]")
    expect(output).toContain("[연계 목록 확인]")
    expect(output).toContain("테스트 고시")
    expect(output).toContain("위임의 적법성·범위는 별도 검토")
    expect(output).toContain("미이행 여부를 자동 확정하지 않습니다")
  })
})
