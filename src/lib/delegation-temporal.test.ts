import { describe, expect, it } from "vitest"
import { checkDelegationTemporalContext } from "./delegation-temporal.js"

describe("current-only three-tier administrative notice temporal gate", () => {
  const now = "20261119"
  it("permits only current baseline with effective notice date", () => {
    const x = checkDelegationTemporalContext("행정규칙명: 금융투자업규정\n시행일: 2026.09.09", now)
    expect(x).toMatchObject({status:"current_notice",effectiveDate:"20260909"})
    expect(x.reason).toContain("별도 미검증")
  })
  it("refuses historical and future requested dates, even if current notice is available", () => {
    for (const asOf of ["20240101","20261118","20261120","20300101"]) {
      expect(checkDelegationTemporalContext("시행일: 2026.09.09", now, asOf).status).toBe("not_verified")
    }
  })
  it("refuses future-effective notice or missing effective date", () => {
    expect(checkDelegationTemporalContext("시행일: 2026.12.01",now).status).toBe("not_verified")
    expect(checkDelegationTemporalContext("행정규칙명: 금융투자업규정",now).status).toBe("not_verified")
  })
  it("refuses historical or missing body rather than accepting misleading citation", () => {
    expect(checkDelegationTemporalContext("⚠️ 연혁본(현행 아님)\n시행일: 2021.10.21\n영 제271조의10",now).status).toBe("not_verified")
    expect(checkDelegationTemporalContext("[NOT_FOUND]\n시행일: 2026.09.09",now).status).toBe("not_verified")
  })
  it("accepts same-day effective date but not as a legal scope validation", () => {
    const x=checkDelegationTemporalContext("시행일: 2026.11.19",now,now)
    expect(x.status).toBe("current_notice")
    expect(x.reason).toContain("개별 개정시점")
  })
})
