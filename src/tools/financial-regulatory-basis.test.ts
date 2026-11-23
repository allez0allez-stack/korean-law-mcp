import { describe, expect, it } from "vitest"
import { parseExactFscRuleId, getFscIpoRuleEvidence } from "./financial-regulatory-basis.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { SearchAdminRuleInput, GetAdminRuleInput } from "./admin-rule.js"

const REGS = `행정규칙 검색 결과 (총 2건):

1. 증권의 발행 및 공시 등에 관한 규정
   - 행정규칙일련번호: 2100000287734 (get_admin_rule의 id)
   - 행정규칙ID: 36044
   - 발령일: 20261103 / 시행일: 20261113
   - 구분: 고시
   - 소관부처: 금융위원회

2. 증권의 발행 및 공시 등에 관한 규정 시행세칙
   - 행정규칙일련번호: 2200000107389
   - 행정규칙ID: 2054825`

const empty = {} as LawApiClient

describe("financial regulatory authority chain", () => {
  it("picks exact FSC rule rather than enforcement details/partial name", () => {
    expect(parseExactFscRuleId(REGS)).toBe("2100000287734")
    expect(parseExactFscRuleId("1. 증권의 발행 및 공시 등에 관한 규정 시행세칙\n- 행정규칙일련번호: 9999999999999")).toBeUndefined()
  })
  it("fetches current serial and verifies each of three official article records", async () => {
    const calls: string[] = []
    const res = await getFscIpoRuleEvidence(empty, {}, {
      search: async (_c:LawApiClient, q:SearchAdminRuleInput) => {
        expect(q.query).toBe("증권의 발행 및 공시 등에 관한 규정")
        return {content:[{type:"text",text:REGS}]}
      },
      read: async (_c:LawApiClient, q:GetAdminRuleInput) => {
        calls.push(`${q.id}:${q.jo}`)
        return {content:[{type:"text",text:`행정규칙명: 증권의 발행 및 공시 등에 관한 규정\n[조문 조회: ${q.jo}]\n${q.jo}(주권의 사전 청약) 요건`}]}
      },
    })
    expect(calls).toEqual(["2100000287734:제2-12조의2", "2100000287734:제2-12조의3", "2100000287734:제2-12조의4"])
    const out = res.content[0].text
    expect(out).toContain("OFFICIAL_ADMINISTRATIVE_RULE")
    expect(out).toContain("제2-12조의3")
    expect(out).not.toContain("2200000107389")
  })
  it("marks missing official rule as unverified, not fabricated", async () => {
    const res = await getFscIpoRuleEvidence(empty, {}, {
      search: async () => ({content:[{type:"text",text:"[NOT_FOUND] 없음"}]}),
    })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toContain("NOT_VERIFIED")
  })
  it("does not accept article text from wrong regulation", async () => {
    const res = await getFscIpoRuleEvidence(empty, {}, {
      search: async () => ({content:[{type:"text",text:REGS}]}),
      read: async () => ({content:[{type:"text",text:"행정규칙명: 화장품 규정\n제2-12조의3(무관)"}]}),
    })
    expect(res.content[0].text).toContain("[NOT_VERIFIED]")
  })
})
