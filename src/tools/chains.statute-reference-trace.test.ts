import { beforeEach, describe, expect, it, vi } from "vitest"
import { chainLawSystem } from "./chains.js"
import { legalResearch, LegalResearchSchema } from "./legal-research.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

const names = ["건축법", "국토의 계획 및 이용에 관한 법률", "민법", "근로기준법"]
const rows = names.map((name,i)=>({name,mst:String(992100+i),jo:["11","56","750","23"][i],body:["「국토의 계획 및 이용에 관한 법률」 제56조에 따른다.","「민법」 제750조를 준용한다.","손해배상의 책임", "해고 등의 제한"][i]}))
function fixture() {
  const searchLaw = vi.fn(async(q:string)=>`<LawSearch><totalCnt>${rows.length}</totalCnt>${rows.filter(r=>r.name.includes(q)).map(r=>`<law><법령명한글>${r.name}</법령명한글><법령ID>${r.mst}</법령ID><법령일련번호>${r.mst}</법령일련번호><법령구분명>법률</법령구분명></law>`).join("")}</LawSearch>`)
  const getLawText = vi.fn(async({mst}:{mst:string})=>{const r=rows.find(r=>r.mst===mst); if(!r) throw Error("unknown MST"); return JSON.stringify({법령:{기본정보:{법령명_한글:r.name,법령ID:r.mst},조문:{조문단위:[{조문여부:"조문",조문번호:r.jo,조문가지번호:"0",조문제목:"시험 원문",조문내용:r.body}]}}})})
  const api={searchLaw,getLawText,getThreeTier:async()=>"{}"} as unknown as LawApiClient
  return {api,getLawText,searchLaw}
}

describe("law_system explicit reference tracing integration",()=>{
  beforeEach(()=>lawCache.clear())
  it("traces official cited articles through the existing chain",async()=>{
    const c=fixture();const r=await chainLawSystem(c.api,{query:"건축법 제11조 인용관계 추적"});const s=r.content[0].text
    expect(s).toContain("▶ 법령 간 명시 인용 추적");expect(s).toContain("[TARGET_VERIFIED] 깊이 1 | 국토의 계획 및 이용에 관한 법률 제56조");expect(s).toContain("[TARGET_VERIFIED] 깊이 2 | 민법 제750조")
  })
  it("uses the same reference evidence in default legal_research",async()=>{
    const c=fixture();const r=await legalResearch(c.api,LegalResearchSchema.parse({query:"건축법 제11조 인용 추적"}));expect(r.content[0].text).toContain("[BOUNDED_STATUTE_REFERENCE_TRACE]");expect(r.content[0].text).toContain("공식 법령 원문의 명시적 인용 추적을 우선합니다")
  })
  it("does not fan out for ordinary article retrieval",async()=>{
    const c=fixture();const s=(await chainLawSystem(c.api,{query:"건축법 제11조"})).content[0].text;expect(s).not.toContain("[BOUNDED_STATUTE_REFERENCE_TRACE]");expect(c.getLawText.mock.calls.every(([p])=>p.mst===rows[0].mst)).toBe(true)
  })
  it("does not trace a loose root match",async()=>{
    const c=fixture();const r=await chainLawSystem(c.api,{query:"기준법 제23조 인용 추적"});expect(r.isError).toBe(true);expect(r.content[0].text).not.toContain("[TARGET_VERIFIED]");expect(c.getLawText).not.toHaveBeenCalled()
  })
})
