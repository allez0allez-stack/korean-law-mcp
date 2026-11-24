import { describe, expect, it, vi } from "vitest"
import { planScopedLawQuery as plan, runScopedLawQuery as run, shouldRouteScopedResearch as route } from "./scoped-law-query.js"
const law = (lawName: string) => ({ lawName, lawId: lawName, mst: lawName, lawType: "법률" })
const read = async (l: ReturnType<typeof law>, a: string[]) => ({ content: [{type:"text", text: l.lawName + ": " + a.join(",")} ] })
describe("explicit multi-statute grouping", () => {
  it("does not assign Labor Standards Act Article 23 to Civil Act", () => expect(plan("민법 제750조 및 근로기준법 제23조")?.groups).toEqual([{lawName:"민법",articles:["제750조"]},{lawName:"근로기준법",articles:["제23조"]}]))
  it("preserves full multiword statute names containing conjunctions", () => expect(plan("건축법 제11조와 국토의 계획 및 이용에 관한 법률 제56조")?.groups[1]).toEqual({lawName:"국토의 계획 및 이용에 관한 법률",articles:["제56조"]}))
  it("preserves separate law ownership for identical article numbers", () => expect(plan("소득세법 제20조, 법인세법 제20조")?.groups.map(g=>g.articles)).toEqual([["제20조"],["제20조"]]))
  it("inherits bare article only across list separators", () => expect(plan("민법 제750조·제751조 및 근로기준법 제23조")?.groups[0].articles).toEqual(["제750조","제751조"]))
  it("handles quoted law names and an article branch", () => expect(plan("「자본시장과 금융투자업에 관한 법률」 제249조의7 및 「민법」 제750조")?.groups[0]).toEqual({lawName:"자본시장과 금융투자업에 관한 법률",articles:["제249조의7"]}))
  it("handles subordinate laws explicitly without merging their articles", () => expect(plan("건축법 제11조 및 같은 법 시행령 제8조")?.groups[1]).toEqual({lawName:"건축법 시행령",articles:["제8조"]}))
  it("does not infer an owner from prose or a range", () => {const p=plan("민법 제750조 및 근로기준법 제23조 관련 다른 내용 제40조");expect(p?.unresolved).toContain("관련 다른 내용 제40조");expect(p?.groups[1].articles).toEqual(["제23조"])})
  it("preserves existing single-law flow", () => expect(plan("민법 제750조 및 제751조")).toBeNull())
  it("keeps litigation and historical intent on existing routes", () => {expect(route("민법 제750조 및 근로기준법 제23조 판례")).toBe(false);expect(route("민법 제750조 및 근로기준법 제23조 2024년")).toBe(false);expect(route("민법 제750조 및 근로기준법 제23조 비교")).toBe(true)})
  it("resolves and reads each statute independently", async()=>{const fn=vi.fn(read);const r=await run(plan("민법 제750조 및 근로기준법 제23조")!,{},async n=>law(n),fn);expect(fn.mock.calls.map(c=>[c[0].lawName,c[1]])).toEqual([["민법",["제750조"]],["근로기준법",["제23조"]]]);expect(r.content[0].text).toContain("근로기준법: 제23조")})
  it("does not read unverified law", async()=>{const fn=vi.fn(read);const r=await run(plan("민법 제750조 및 가상법 제23조")!,{},async n=>n==="민법"?law(n):undefined,fn);expect(fn).toHaveBeenCalledTimes(1);expect(r.content[0].text).toContain("[NOT_VERIFIED]")})
  it("rejects unscoped conflicting articles parameter", async()=>{const fn=vi.fn(read);const r=await run(plan("민법 제750조 및 근로기준법 제23조")!,{articles:["제44조"]},async n=>law(n),fn);expect(r.isError).toBe(true);expect(fn).not.toHaveBeenCalled()})
  it("keeps equal explicit article set tied to inline owners", async()=>{const fn=vi.fn(read);await run(plan("민법 제750조 및 근로기준법 제23조")!,{articles:["제23조","제750조"]},async n=>law(n),fn);expect(fn.mock.calls[1][1]).toEqual(["제23조"])})
  it("labels laws outside the bounded lookup",async()=>{const fn=vi.fn(read);const r=await run(plan("민법 제1조, 형법 제2조, 상법 제3조, 건축법 제4조")!,{},async n=>law(n),fn);expect(fn).toHaveBeenCalledTimes(3);expect(r.content[0].text).toContain("[PARTIAL] 법령 조회 한도 초과: 건축법")})
})

describe("partial result isolation", () => {
  it("retains the other statute when one lookup fails", async () => {const fn=vi.fn(read);const r=await run(plan("민법 제750조 및 근로기준법 제23조")!,{},async n=>{if(n==="민법")throw Error("temporary upstream error");return law(n)},fn);expect(fn).toHaveBeenCalledTimes(1);expect(r.content[0].text).toContain("[NOT_VERIFIED]");expect(r.content[0].text).toContain("근로기준법: 제23조");expect(r.isError).not.toBe(true)})
  it("marks complete resolution failure as error", async () => {const r=await run(plan("가상법 제1조 및 가짜법 제2조")!,{},async()=>undefined,read);expect(r.isError).toBe(true)})
})

describe("additional ownership boundary guards", () => {
  it("recognizes parenthesized legal names",()=>expect(plan("민법 제750조 및 (근로기준법) 제23조")?.groups[1].lawName).toBe("근로기준법"))
  it("reports malformed legal name instead of handing its article to the first law",()=>{const p=plan("민법 제750조 및 @근로기준법 제23조");expect(p?.groups).toEqual([{lawName:"민법",articles:["제750조"]}]);expect(p?.unresolved).toContain("@근로기준법 제23조")})
})
