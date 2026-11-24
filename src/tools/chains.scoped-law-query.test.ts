import { beforeEach, describe, expect, it, vi } from "vitest"
import { chainLawSystem } from "./chains.js"
import { legalResearch, LegalResearchSchema } from "./legal-research.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const records = [
  {name:"민법", mst:"900120", articles:["750","751","23"]},
  {name:"근로기준법", mst:"900121", articles:["23"]},
  {name:"소득세법", mst:"900122", articles:["20","19"]},
  {name:"법인세법", mst:"900123", articles:["19"]},
  {name:"건축법", mst:"900124", articles:["11"]},
  {name:"국토의 계획 및 이용에 관한 법률", mst:"900125", articles:["56"]},
  {name:"건축법 시행령", mst:"900126", articles:["8"]},
]
function fixture() {
  const xml = (r:typeof records[number])=>`<law><법령일련번호>${r.mst}</법령일련번호><법령ID>${r.mst}</법령ID><법령명한글>${r.name}</법령명한글><법령구분명>법률</법령구분명></law>`
  const searchLaw=vi.fn(async(q:string)=>`<LawSearch><totalCnt>${records.length}</totalCnt>${records.filter(r=>r.name.includes(q)).map(xml).join("")}</LawSearch>`)
  const getLawText=vi.fn(async({mst}:{mst:string})=>{const r=records.find(r=>r.mst===mst);if(!r)throw Error("unknown MST");return JSON.stringify({법령:{기본정보:{법령명_한글:r.name},조문:{조문단위:r.articles.map(n=>({조문여부:"조문",조문번호:n,조문제목:`${r.name} 고유본문 ${n}`,조문내용:`제${n}조(${r.name} 고유본문 ${n})`}))}}})})
  const api={searchLaw,getLawText,getThreeTier:async()=>"{}"} as unknown as LawApiClient
  return {api,searchLaw,getLawText}
}
describe("multi-law query integration",()=>{
  beforeEach(()=>lawCache.clear())
  it("isolates Civil Act and Labor Standards Act articles",async()=>{const c=fixture();const s=(await chainLawSystem(c.api,{query:"민법 제750조 및 근로기준법 제23조"})).content[0].text;expect(s).toContain("민법 고유본문 750");expect(s).toContain("근로기준법 고유본문 23");expect(s).not.toContain("민법 고유본문 23")})
  it("also isolates default full research explicit citations",async()=>{const c=fixture();const s=(await legalResearch(c.api,LegalResearchSchema.parse({query:"소득세법 제20조 및 법인세법 제19조"}))).content[0].text;expect(s).toContain("소득세법 고유본문 20");expect(s).toContain("법인세법 고유본문 19");expect(s).not.toContain("소득세법 고유본문 19")})
  it("uses official alias resolution and retains full statute title",async()=>{const c=fixture();const s=(await chainLawSystem(c.api,{query:"건축법 제11조 및 국토계획법 제56조"})).content[0].text;expect(s).toContain("국토의 계획 및 이용에 관한 법률 고유본문 56");expect(s).toContain("건축법 고유본문 11")})
  it("keeps the statute and decree distinct",async()=>{const c=fixture();const s=(await chainLawSystem(c.api,{query:"건축법 제11조 및 같은 법 시행령 제8조"})).content[0].text;expect(s).toContain("건축법 시행령 고유본문 8");expect(s).toContain("건축법 고유본문 11")})
  it("does not replace a nonexistent law with a partial name hit",async()=>{const c=fixture();const s=(await chainLawSystem(c.api,{query:"민법 제750조 및 기준법 제23조"})).content[0].text;expect(s).toContain("[NOT_VERIFIED]");expect(s).not.toContain("근로기준법 고유본문 23");expect(s).not.toContain("민법 고유본문 23")})
  it("refuses a conflicting flat article parameter",async()=>{const c=fixture();const r=await chainLawSystem(c.api,{query:"민법 제750조 및 근로기준법 제23조",articles:["제751조"]});expect(r.isError).toBe(true);expect(c.getLawText).not.toHaveBeenCalled()})
})
