import { describe, expect, it } from "vitest"
import { extractRuleSections as sections, extractSupplementarySection as supplement } from "./kofia-section-evidence.js"
describe("KOFIA bounded regulatory evidence", () => {
  it("does not cross into the next article", () => {
    const r=sections("제5조의3(주금납입능력)\n① 납입능력을 확인한다.\n제5조의4(참여자격)\n별도 요건",["제5조의3"])[0]
    expect(r.status).toBe("HEADING_BOUNDED"); expect(r.excerpt).not.toContain("제5조의4")
  })
  it("supports spacing in article numbers",()=>expect(sections("제 5 조 의 3 (납입)\n본문\n제6조(다음)",["제5조의3"])[0].status).toBe("HEADING_BOUNDED"))
  it("marks clipping rather than claiming a complete article",()=>expect(sections("제5조의3(납입)\n"+"본문".repeat(100)+"\n제6조(다음)",["제5조의3"],40)[0].truncated).toBe(true))
  it("ignores inline cross-reference when a distinct structural heading exists",()=>expect(sections("제4조(앞)\n제5조의3(납입)에 따른 확인\n제5조의3(납입)\n본문",["제5조의3"])[0].status).toBe("AMBIGUOUS"))
  it("does not certify flat HTML text as structurally bounded",()=>expect(sections("목차 제5조의3(납입) 본문 제6조(다음)",["제5조의3"])[0].status).toBe("EXCERPT_ONLY"))
  it("reports absent articles",()=>expect(sections("제5조(기준)",["제5조의3"])[0].status).toBe("NOT_FOUND"))
  it("stops article extraction before supplementary provisions",()=>expect(sections("제9조의3(배정)\n본문\n부 칙 (2026. 11. 12)\n시행일",["제9조의3"])[0].excerpt).not.toContain("부 칙"))
  it("chooses only supplementary provisions for the selected amendment",()=>{const r=supplement("부칙 (2026. 3. 12)\n이전\n부 칙 (2026. 11. 12)\n시행일과 적용례\n[별표/서식 파일]","2026-11-12");expect(r.excerpt).toContain("시행일과 적용례");expect(r.excerpt).not.toContain("이전");expect(r.status).toBe("HEADING_BOUNDED")})
  it("does not substitute an older supplementary provision",()=>expect(supplement("부칙 (2026. 3. 12)\n이전","2026-11-12").status).toBe("NOT_FOUND"))
  it("rejects duplicate supplementary headings",()=>expect(supplement("부칙 (2026. 11. 12)\nA\n부칙 (2026. 11. 12)\nB","2026-11-12").status).toBe("AMBIGUOUS"))
})
