import { beforeEach, describe, expect, it, vi } from "vitest"
import { extractNamedStatuteReferences as extract, traceStatuteReferences as trace, wantsStatuteReferenceTrace as wants, matchesExplicitTraceRoot as matchesRoot } from "./statute-reference-trace.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

const law = (name: string, mst: string) => ({ lawName: name, mst, lawId: mst, lawType: "법률" })
const ROOT = law("건축법", "991000")
const A = law("국토의 계획 및 이용에 관한 법률", "991001")
const B = law("민법", "991002")
type FixtureRecord = { law: ReturnType<typeof law>; articles: Record<string, string>; returnedName?: string }
function mock(records: FixtureRecord[]) {
  const searchLaw = vi.fn(async (q: string) => `<LawSearch><totalCnt>${records.length}</totalCnt>${records.filter(r=>r.law.lawName.includes(q)).map(r=>`<law><법령명한글>${r.law.lawName}</법령명한글><법령ID>${r.law.lawId}</법령ID><법령일련번호>${r.law.mst}</법령일련번호><법령구분명>법률</법령구분명></law>`).join("")}</LawSearch>`)
  const getLawText = vi.fn(async ({mst}: {mst:string}) => {
    const r = records.find(r=>r.law.mst===mst)
    if (!r) throw Error("upstream missing")
    return JSON.stringify({법령:{기본정보:{법령명_한글:r.returnedName??r.law.lawName,법령ID:r.law.lawId},조문:{조문단위:Object.entries(r.articles).map(([id,body])=>({조문여부:"조문",조문번호:id.slice(0,4),조문가지번호:id.slice(4),조문제목:"원문",조문내용:body}))}}})
  })
  return { api:{searchLaw,getLawText} as unknown as LawApiClient, getLawText, searchLaw }
}

describe("explicit statutory reference evidence", () => {
  beforeEach(()=>lawCache.clear())
  it("binds quoted official full name and article/branch",()=>expect(extract("「국토의 계획 및 이용에 관한 법률」 제56조 및 「민법」 제750조를 준용한다.")).toEqual([
    {lawName:A.lawName,article:"제56조",relation:"CITATION",wording:"「국토의 계획 및 이용에 관한 법률」 제56조"},
    {lawName:B.lawName,article:"제750조",relation:"JUNYONG_WORDING",wording:"「민법」 제750조를 준용"},
  ]))
  it("preserves branch and paragraph wording without claiming paragraph-level verification",()=>expect(extract("「민법」 제123조의2 제3항 제4호")[0]).toMatchObject({article:"제123조의2",wording:"「민법」 제123조의2 제3항 제4호"}))
  it("does not assign bare, unquoted, invalid or incomplete references",()=>expect(extract("제1조와 민법 제750조, 「규정이 아님」 제1조, 「민법」 제0조, 「민법」 제2조의123, 「민법」 제3조례")).toEqual([]))
  it("does not infer 준용 from a distant word",()=>expect(extract("「민법」 제1조에 따른 신청 후 다른 규정을 준용한다")[0].relation).toBe("CITATION"))
  it("requires an exact root name or documented alias",()=>{expect(matchesRoot("건축법 제11조 인용 추적","건축법")).toBe(true);expect(matchesRoot("「건축법」 제11조 인용 추적","건축법")).toBe(true);expect(matchesRoot("국토계획법 제56조 인용 추적",A.lawName)).toBe(true);expect(matchesRoot("기준법 제23조 인용 추적","근로기준법")).toBe(false);expect(matchesRoot("해고 제한 인용 추적","근로기준법")).toBe(false)})
  it("activates only explicit current trace intent",()=>{expect(wants("건축법 제11조 인용관계 추적")).toBe(true);expect(wants("건축법 제11조")).toBe(false);expect(wants("2024년 건축법 제11조 인용 추적")).toBe(false)})
  it("reads exact official bodies recursively to depth 2, prevents circular reread",async()=>{
    const c=mock([{law:ROOT,articles:{"001100":"「국토의 계획 및 이용에 관한 법률」 제56조에 따른다. 「건축법」 제11조에 따른다."}},{law:A,articles:{"005600":"「민법」 제750조를 준용한다."}},{law:B,articles:{"075000":"「건축법」 제11조에 따른다."}}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text
    expect(s).toContain("[TARGET_VERIFIED] 깊이 1 | "+A.lawName+" 제56조");expect(s).toContain("[TARGET_VERIFIED] 깊이 2 | 민법 제750조");expect(s).toContain("[ALREADY_SEEN]");expect(s).toContain("준용 문언");expect(c.getLawText).toHaveBeenCalledTimes(3)
  })
  it("never selects an unrelated partial-name hit",async()=>{const c=mock([{law:ROOT,articles:{"001100":"「기준법」 제23조"}},{law:law("근로기준법","991003"),articles:{"002300":"오귀속 금지"}}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text;expect(s).toContain("[NOT_VERIFIED]");expect(s).not.toContain("오귀속 금지");expect(c.getLawText).toHaveBeenCalledTimes(1)})
  it("rejects returned wrong-law identity even when requested MST matches",async()=>{const c=mock([{law:ROOT,articles:{"001100":"「민법」 제750조"}},{law:B,returnedName:"형법",articles:{"075000":"오귀속 금지"}}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text;expect(s).toContain("법령 원문 명칭 불일치");expect(s).not.toContain("[TARGET_VERIFIED]")})
  it("does not read a different branch from the returned document",async()=>{const c=mock([{law:ROOT,articles:{"001100":"「민법」 제750조의2"}},{law:B,articles:{"075000":"다른 조문"}}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text;expect(s).toContain("정확한 조문을 원문에서 유일하게 식별하지 못함");expect(s).not.toContain("[TARGET_VERIFIED]")})
  it("reports no explicit match without claiming no legal references",async()=>{const c=mock([{law:ROOT,articles:{"001100":"같은 법 제1조를 준용한다."}}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text;expect(s).toContain("[NO_EXPLICIT_MATCH]");expect(s).toContain("다른 참조가 없다는 의미는 아님")})
  it("limits target requests and lists deferred references",async()=>{const c=mock([{law:ROOT,articles:{"001100":Array.from({length:8},(_,i)=>`「민법」 제${i+1}조`).join(" ")}},{law:B,articles:Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1).padStart(4,"0")+"00","공식 본문"]))}]);const s=(await trace(c.api,{law:ROOT,articles:["제11조"]})).content[0].text;expect(c.getLawText).toHaveBeenCalledTimes(7);expect(s).toContain("[PARTIAL]");expect(s).toContain("민법 제7조");expect(c.searchLaw).toHaveBeenCalledTimes(1)})
  it("reports complete failure to verify the root",async()=>{const c=mock([]);const r=await trace(c.api,{law:ROOT,articles:["제11조"]});expect(r.isError).toBe(true);expect(r.content[0].text).toContain("시작 원문 확인 0건")})
})

describe("effective-slice pinning for split commencement", () => {
  beforeEach(()=>lawCache.clear())
  const root = {...ROOT, effectiveDate:"20201112"}
  function sliceFixture(returnedDate?: string) {
    const searchLaw = vi.fn(async()=>`<LawSearch><totalCnt>1</totalCnt><law><법령명한글>민법</법령명한글><법령ID>${B.lawId}</법령ID><법령일련번호>${B.mst}</법령일련번호><법령구분명>법률</법령구분명><시행일자>20200317</시행일자></law></LawSearch>`)
    const getLawText = vi.fn(async(p:{mst:string;jo:string;efYd?:string})=>JSON.stringify({법령:{기본정보:{법령명_한글:p.mst===root.mst?root.lawName:B.lawName,법령ID:p.mst,시행일자:p.mst===root.mst?returnedDate:p.efYd},조문:{조문단위:{조문여부:"조문",조문번호:p.jo.slice(0,4),조문가지번호:p.jo.slice(4),조문제목:"원문",조문내용:p.mst===root.mst?"「민법」 제750조를 준용한다.":"검증된 대상 본문"}}}}))
    return {api:{searchLaw,getLawText} as unknown as LawApiClient,getLawText}
  }
  it("pins root and target effective dates from the search metadata",async()=>{
    const c=sliceFixture("20201112");const r=await trace(c.api,{law:root,articles:["제11조"]});expect(r.isError).not.toBe(true)
    expect(c.getLawText.mock.calls.map(([p])=>[p.mst,p.efYd])).toEqual([[root.mst,"20201112"],[B.mst,"20200317"]])
    expect(r.content[0].text).toContain("[ROOT_VERIFIED] 건축법 제11조 | MST 991000 | 시행일 20201112")
    expect(r.content[0].text).toContain("[TARGET_VERIFIED] 깊이 1 | 민법 제750조 | MST 991002 | 시행일 20200317")
  })
  it("rejects a wrong slice even if it is already in force",async()=>{
    const c=sliceFixture("20200101");const r=await trace(c.api,{law:root,articles:["제11조"]});expect(r.isError).toBe(true);expect(r.content[0].text.startsWith("[NOT_VERIFIED] 건축법 제11조: 법령 시행 버전 불일치")).toBe(true);expect(c.getLawText).toHaveBeenCalledTimes(1)
  })
  it("rejects missing returned effective-date metadata when pinned",async()=>{
    const c=sliceFixture();const r=await trace(c.api,{law:root,articles:["제11조"]});expect(r.isError).toBe(true);expect(r.content[0].text).toContain("법령 시행 버전 불일치")
  })
  it("refuses a future search slice before reading its text",async()=>{
    const c=sliceFixture("29990101");const r=await trace(c.api,{law:{...root,effectiveDate:"29990101"},articles:["제11조"]});expect(r.isError).toBe(true);expect(c.getLawText).not.toHaveBeenCalled()
  })
})
