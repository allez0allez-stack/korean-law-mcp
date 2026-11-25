import { beforeEach, describe, expect, it, vi } from "vitest"
import { chainLawSystem } from "./chains.js"
import { legalResearch, LegalResearchSchema } from "./legal-research.js"
import { traceRecursiveAdminDelegations as trace, wantsRecursiveAdminTrace as wants } from "./recursive-admin-delegation.js"
import type { LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"
import { adminRuleXmlCache } from "../lib/admin-rule-views.js"
const law=(lawName:string,mst:string,lawType="법률")=>({lawName,mst,lawId:mst,lawType,effectiveDate:"20200101"})
const A=law("시험법","991100"),B=law("시험법 시행령","991101","대통령령"),C=law("시험법 시행규칙","991102","부령")
const serial="2100000000001", ruleName="시험기준"
const edge=(target:typeof A,num:string,loc:string)=>({위임법령일련번호:target.mst,위임법령제목:target.lawName,위임법령조문정보:{위임법령조문번호:num,조항호목:loc,라인텍스트:"정한다"}})
const admin={위임행정규칙조문정보:{위임행정규칙일련번호:serial,위임행정규칙제목:ruleName,조항호목:"제3조제1항",라인텍스트:"고시한다"}}
type RecordFixture={law:typeof A;jo:string;links:unknown;wrongDate?:boolean;wrongId?:boolean;wrongBody?:boolean;wrongEnvelope?:boolean}
function fixture(records:RecordFixture[]){
  const searchLaw=vi.fn(async(q:string)=>`<LawSearch><totalCnt>${records.length}</totalCnt>${records.filter(r=>r.law.lawName.includes(q)).map(({law:l})=>`<law><법령명한글>${l.lawName}</법령명한글><법령ID>${l.lawId}</법령ID><법령일련번호>${l.mst}</법령일련번호><법령구분명>${l.lawType}</법령구분명><시행일자>${l.effectiveDate}</시행일자></law>`).join("")}</LawSearch>`)
  const getLawText=vi.fn(async(p:{mst:string;jo:string;efYd:string})=>{
    const r=records.find(x=>x.law.mst===p.mst);if(!r)throw Error("missing")
    return JSON.stringify({법령:{기본정보:{법령명_한글:r.law.lawName,법령ID:r.wrongId?undefined:r.law.lawId,시행일자:r.wrongDate?"20210101":r.law.effectiveDate},조문:{조문단위:{조문여부:"조문",조문번호:r.wrongBody?"9999":r.jo,조문가지번호:"0",조문제목:"원문",조문내용:"원문 내용"}}}})
  })
  const fetchApi=vi.fn(async(p:{extraParams:{MST:string}})=>{const r=records.find(x=>x.law.mst===p.extraParams.MST);if(!r)throw Error("missing");return JSON.stringify({lsDelegated:{법령:{법령정보:{법령명:r.law.lawName,법령일련번호:r.law.mst,법령ID:r.law.lawId,시행일자:r.wrongEnvelope?"20210101":r.law.effectiveDate},위임조문정보:{조정보:{조문번호:r.jo},위임정보:r.links}}}})})
  const searchAdminRule=vi.fn(async()=>`<AdmRulSearch><totalCnt>1</totalCnt><admrul><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${ruleName}</행정규칙명><행정규칙종류>고시</행정규칙종류><시행일자>20200101</시행일자><발령일자>20200101</발령일자><발령번호>1</발령번호><제개정구분명>일부개정</제개정구분명><현행연혁구분>현행</현행연혁구분></admrul></AdmRulSearch>`)
  const getAdminRule=vi.fn(async()=>`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${ruleName}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>제1조(목적) 「시험법 시행규칙」 제3조에 따른다.</조문내용></AdmRulService>`)
  return {api:{searchLaw,getLawText,fetchApi,searchAdminRule,getAdminRule,getThreeTier:async()=>"{}"} as unknown as LawApiClient,searchLaw,getLawText,fetchApi,searchAdminRule,getAdminRule}
}
const records=()=>[{law:A,jo:"1",links:edge(B,"2","제1조")},{law:B,jo:"2",links:edge(C,"3","제2조")},{law:C,jo:"3",links:admin}]
const run=(c:ReturnType<typeof fixture>)=>trace(c.api,{law:A,articles:["제1조"]})
describe("bounded recursive official delegation",()=>{
  beforeEach(()=>{lawCache.clear();adminRuleXmlCache.clear()})
  it("opts in explicitly and does not change existing direct lookup",()=>{expect(wants("시험법 제1조 다단계 고시 추적")).toBe(true);expect(wants("시험법 제1조 재위임 추적")).toBe(true);expect(wants("시험법 제1조 다단계 위임 추적")).toBe(true);expect(wants("시험법 제1조 고시 추적")).toBe(false)})
  it("verifies act -> decree -> rule -> notice with a bounded official path",async()=>{const c=fixture(records());const s=(await run(c)).content[0].text;expect(s).toContain("[DELEGATED_ARTICLE_VERIFIED] 깊이 2 | 시험법 제1조 → 시험법 시행령 제2조 → 시험법 시행규칙 제3조");expect(s).toContain("[ADMIN_VERSION_VERIFIED]");expect(c.fetchApi).toHaveBeenCalledTimes(3);expect(c.getLawText).toHaveBeenCalledTimes(3);expect(c.getAdminRule).toHaveBeenCalledTimes(1);expect(c.getLawText.mock.calls.every(([p])=>p.efYd==="20200101")).toBe(true)})
  it("propagates unverified administrative detail into the overall coverage",async()=>{
    const c=fixture(records());c.getAdminRule.mockResolvedValueOnce("<AdmRulService/>")
    const s=(await run(c)).content[0].text
    expect(s).toContain("행정규칙 미완결 경로 1건")
    expect(s).toContain("[ADMIN_TRACE_COVERAGE] PARTIAL")
    expect(s.indexOf("[PARTIAL] 일부 경로")).toBeLessThan(s.indexOf("[DELEGATION_ROOT_VERIFIED]"))
  })
  it("keeps an entirely verified bounded path out of partial coverage",async()=>{
    const s=(await run(fixture(records()))).content[0].text
    expect(s).toContain("행정규칙 미완결 경로 0건")
    expect(s).toContain("[ADMIN_TRACE_COVERAGE] COMPLETE")
    expect(s).not.toContain("[PARTIAL] 일부 경로")
  })
  it("does not silently promote a stale listed subordinate MST",async()=>{const rs=records();rs[0].links=edge({...B,mst:"999999"},"2","제1조");const c=fixture(rs);const s=(await run(c)).content[0].text;expect(s).toContain("[LINKED_LAW_MST_NOT_CURRENT]");expect(c.getLawText).toHaveBeenCalledTimes(1);expect(c.getAdminRule).not.toHaveBeenCalled()})
  it("rejects an incorrect effective slice before following its links",async()=>{const c=fixture(records().map(r=>r.law===B?{...r,wrongDate:true}:r));const s=(await run(c)).content[0].text;expect(s).toContain("[NOT_VERIFIED] 시험법 시행령 제2조");expect(s).not.toContain("[ADMIN_VERSION_VERIFIED]");expect(c.fetchApi).toHaveBeenCalledTimes(1)})
  it("rejects a missing returned source law ID",async()=>{const c=fixture(records().map(r=>r.law===A?{...r,wrongId:true}:r));expect((await run(c)).isError).toBe(true);expect(c.fetchApi).not.toHaveBeenCalled()})
  it("rejects a wrong target article",async()=>{const c=fixture(records().map(r=>r.law===B?{...r,wrongBody:true}:r));expect((await run(c)).content[0].text).not.toContain("[DELEGATED_ARTICLE_VERIFIED]");expect(c.getAdminRule).not.toHaveBeenCalled()})
  it("does not use an envelope from another effective slice",async()=>{const c=fixture(records().map(r=>r.law===B?{...r,wrongEnvelope:true}:r));expect((await run(c)).content[0].text).toContain("공식 연결 범위 미확인");expect(c.getAdminRule).not.toHaveBeenCalled()})
  it("prevents circular rereads",async()=>{const rs=records().slice(0,2);rs[1].links=edge(A,"1","제2조");const c=fixture(rs);expect((await run(c)).content[0].text).toContain("[ALREADY_SEEN]");expect(c.getLawText).toHaveBeenCalledTimes(2)})
  it("explicitly reports depth-limited candidates",async()=>{const rs=records();rs[2].links=edge(law("다른법","991103"),"4","제3조");const c=fixture(rs);const s=(await run(c)).content[0].text;expect(s).toContain("[PARTIAL]");expect(s).toContain("미추적 후보");expect(c.getLawText).toHaveBeenCalledTimes(3)})
  it("does not treat missing official structure as absence",async()=>{const c=fixture(records());c.fetchApi.mockResolvedValueOnce("{}");expect((await run(c)).content[0].text).toContain("공식 연결 범위 미확인");expect(c.getLawText).toHaveBeenCalledTimes(1)})
  it("routes explicit recursive requests through the shared chain and default research",async()=>{
    const c=fixture(records());const a=await chainLawSystem(c.api,{query:"시험법 제1조 재위임 추적"});expect(a.content[0].text).toContain("[RECURSIVE_ADMIN_DELEGATION_TRACE]");expect(a.content[0].text).toContain("[ADMIN_VERSION_VERIFIED]")
    const b=await legalResearch(c.api,LegalResearchSchema.parse({query:"시험법 제1조 다단계 위임 추적"}));expect(b.content[0].text).toContain("[RECURSIVE_ADMIN_DELEGATION_TRACE]")
  })
  it("keeps direct mode and ordinary lookup out of recursive tracing",async()=>{const c=fixture(records());const a=await chainLawSystem(c.api,{query:"시험법 제1조 고시 추적"});expect(a.content[0].text).toContain("[OFFICIAL_ADMIN_DELEGATION_TRACE]");expect(a.content[0].text).not.toContain("[RECURSIVE_ADMIN_DELEGATION_TRACE]");expect(c.fetchApi).toHaveBeenCalledTimes(1)})
  it("rejects historical requests before querying official current links",async()=>{const c=fixture(records());const a=await chainLawSystem(c.api,{query:"시험법 제1조 2024년 재위임 추적"});expect(a.isError).toBe(true);expect(c.fetchApi).not.toHaveBeenCalled()})
  it("preserves multiple source clauses without reading a target twice",async()=>{const rs=records();rs[0].links=[edge(B,"2","제1조제1항"),edge(B,"2","제1조제2항")];const c=fixture(rs);const s=(await run(c)).content[0].text;expect(s).toContain("시작 위치 제1조제1항");expect(s).toContain("시작 위치 제1조제2항");expect(c.getLawText).toHaveBeenCalledTimes(3)})
})
