import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LawApiClient } from "../../lib/api-client.js"
import { runDelegationScenario } from "./delegation.js"
import { getArticleHistory } from "../article-history.js"
import { getLawSystemTree } from "../law-system-tree.js"

vi.mock("../article-history.js", () => ({
  getArticleHistory: vi.fn(async (_client, input: { jo?: string }) => ({
    content: [{ type: "text", text: `HISTORY_ONLY:${input.jo ?? "ALL"}` }],
  })),
}))
vi.mock("../law-system-tree.js", () => ({
  getLawSystemTree: vi.fn(async () => ({
    content: [{ type: "text", text: "LAW_TREE" }],
  })),
}))

const base = {
  apiClient: {} as LawApiClient,
  query: "자본시장과 금융투자업에 관한 법률 제249조의7 위임",
  law: {lawName:"자본시장과 금융투자업에 관한 법률",lawId:"010513",mst:"285957",lawType:"법률"},
}

describe("delegation scenario: exact-article bounded history", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("requests only the explicitly selected article, never whole-law history", async () => {
    const result = await runDelegationScenario({...base, articles:["제249조의7"]})
    expect(getArticleHistory).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getArticleHistory).mock.calls[0][1]).toMatchObject({lawId:"010513",jo:"제249조의7"})
    expect(result.sections.some(s => s.content.includes("HISTORY_ONLY:제249조의7"))).toBe(true)
    expect(result.sections.some(s => s.content.includes("HISTORY_ONLY:ALL"))).toBe(false)
    expect(getLawSystemTree).toHaveBeenCalledTimes(1)
  })

  it("omits expensive whole-law history when articles are unspecified", async () => {
    const result = await runDelegationScenario(base)
    expect(getArticleHistory).not.toHaveBeenCalled()
    expect(result.sections.some(s => s.content.includes("조문 미지정"))).toBe(true)
    expect(getLawSystemTree).toHaveBeenCalledTimes(1)
  })

  it("deduplicates requested articles", async () => {
    const result = await runDelegationScenario({...base,articles:["제249조의7","제249조의7","제249조의8"]})
    expect(getArticleHistory).toHaveBeenCalledTimes(2)
    expect(vi.mocked(getArticleHistory).mock.calls.map(c => c[1].jo)).toEqual(["제249조의7","제249조의8"])
    expect(result.sections.some(s => s.content.includes("제249조의8"))).toBe(true)
  })

  it("limits upstream history fetches to five selected articles", async () => {
    const result = await runDelegationScenario({...base,articles:Array.from({length:8},(_,i)=>`제${i+1}조`)})
    expect(getArticleHistory).toHaveBeenCalledTimes(5)
    expect(result.sections.some(s => s.title.includes("범위 제한"))).toBe(true)
  })
})
