import { describe, expect, it, vi } from "vitest"
import { ordinanceRadar } from "./tools/ordinance-radar.js"
import type { LawApiClient } from "./lib/api-client.js"

const requested = "서울특별시 주차장 설치 및 관리 조례"
const wrong = "서울특별시 강남구 주차장 설치 및 관리 조례"
const xml = (items: Array<[string, string]>, total = items.length, page = 1) =>
  `<OrdinSearch><totalCnt>${total}</totalCnt><page>${page}</page>${items.map(([id, name]) =>
    `<law><자치법규일련번호>${id}</자치법규일련번호><자치법규명>${name}</자치법규명></law>`).join("")}</OrdinSearch>`
const body = (name: string) => JSON.stringify({ LawService: {
  자치법규기본정보: { 자치법규명: name, 시행일자: "20260101" },
  조문: { 조: [{ 조제목: "목적", 조내용: "이 조례는 「주차장법」에 따라 정한다." }] }
} })
const mockClient = (pages: string[], actual = requested) => ({
  searchOrdinance: vi.fn(async ({page = 1}: {page?: number}) => pages[page - 1] || xml([])),
  getOrdinance: vi.fn(async () => body(actual)),
  searchLaw: vi.fn(async () => "<LawSearch><totalCnt>0</totalCnt></LawSearch>"),
}) as unknown as LawApiClient

describe("ordinance_radar exact municipality guard", () => {
  it("rejects fuzzy municipality-only hit", async () => {
    const api = mockClient([xml([["11", wrong]])])
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[NOT_FOUND]")
    expect((api.getOrdinance as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
  it("finds exact match on a later page", async () => {
    const api = mockClient([xml([["11", wrong]], 101, 1), xml([["22", requested]], 101, 2)])
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).not.toBe(true)
    expect((api.getOrdinance as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("22")
  })
  it("rejects multiple exact records", async () => {
    const api = mockClient([xml([["22", requested], ["23", requested]])])
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[AMBIGUOUS]")
  })
  it("rejects a mismatching detail response", async () => {
    const api = mockClient([xml([["22", requested]])], wrong)
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[ORDINANCE_NAME_MISMATCH]")
  })
  it("keeps direct ordinSeq lookup without search", async () => {
    const api = mockClient([])
    const result = await ordinanceRadar(api, { ordinSeq: "22" })
    expect(result.isError).not.toBe(true)
    expect((api.searchOrdinance as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0)
  })
  it("fails closed when the result set exceeds the bounded page budget", async () => {
    const api = mockClient(Array.from({length: 10}, (_, i) => xml([[String(i + 11), wrong]], 1001, i + 1)))
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[SEARCH_INCOMPLETE]")
  })
  it("rejects ignored page parameters that repeat the same result page", async () => {
    const api = mockClient([xml([["11", wrong]], 201, 1), xml([["11", wrong]], 201, 1)])
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[PAGINATION_UNVERIFIED]")
  })

  it("rejects missing or invalid totalCnt metadata", async () => {
    const api = mockClient([xml([["22", requested]], 0)])
    const result = await ordinanceRadar(api, { ordinanceName: requested })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("[SEARCH_METADATA_INVALID]")
  })

})
