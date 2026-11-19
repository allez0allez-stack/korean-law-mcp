import { describe, expect, it } from "vitest"
import { formatDelegationBody } from "./three-tier.js"

describe("get_three_tier delegated-body output", () => {
  const longBody = "제271조의10 " + "가".repeat(700) + "\n⑱ 마지막 항목"
  it("preserves entire delegated statute on exact-article lookup", () => {
    const result = formatDelegationBody(longBody, true)
    expect(result).toContain("⑱ 마지막 항목")
    expect(result).toBe(longBody + "\n\n")
    expect(result).not.toContain("일부만 표시")
  })
  it("keeps bounded preview on unfiltered lookup", () => {
    const result = formatDelegationBody(longBody, false)
    expect(result).toContain("일부만 표시")
    expect(result).not.toContain("⑱ 마지막 항목")
  })
  it("does not omit short content or fabricate delegation text", () => {
    expect(formatDelegationBody("① 짧은 내용", true)).toBe("① 짧은 내용\n\n")
    expect(formatDelegationBody("① 짧은 내용", false)).toBe("① 짧은 내용\n\n")
    expect(formatDelegationBody("", true)).toBe("")
  })
})
