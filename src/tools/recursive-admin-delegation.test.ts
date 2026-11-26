import { beforeEach, describe, expect, it, vi } from "vitest"
import { chainLawSystem } from "./chains.js"
import { legalResearch, LegalResearchSchema } from "./legal-research.js"
import { traceRecursiveAdminDelegations as trace, wantsRecursiveAdminTrace as wants, continueDelegationTrace, ContinueDelegationSchema } from "./recursive-admin-delegation.js"
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
  it.each([
    ["마감재료[제2조제1항의 자재를 포함한다]는 「시험법 시행령」 제5조에 따른다.","제2조제1항",true],
    ["마감재료[제2조제1항의 자재를 포함한다]는 「시험법 시행령」 제2조에 따른다.","제2조제1항",false],
    ["「시험법 시행령」 제2조제1항에 따른다.","제2조제1항",false],
    ["마감재료[제2조의2제1항의 자재를 포함한다]에 따른다.","제2조",false],
    ["마감재료[제2조제11항의 자재를 포함한다]에 따른다.","제2조제1항",false],
    ["마감재료[제2조제1항의 자재를 포함한다]에 따른다.","제2조제1항에 따른다",false],
  ])("verifies a bounded independent source-law candidate only for corroborated bare bracket references",async(body,wording,expected)=>{
    const rs=records();rs[0].links={...edge(B,"2","제1조"),위임법령조문정보:{...edge(B,"2","제1조").위임법령조문정보,라인텍스트:wording}}
    const c=fixture(rs)
    const original=c.getLawText.getMockImplementation()!
    c.getLawText.mockImplementation(async p=>{
      const raw=JSON.parse(await original(p));const unit=raw.법령.조문.조문단위
      if(p.mst===A.mst&&p.jo==="000100")unit.조문내용=body
      if(p.mst===B.mst)unit.조문번호="9999"
      if(p.mst===A.mst&&p.jo==="000200")unit.조문번호="2"
      return JSON.stringify(raw)
    })
    const s=(await run(c)).content[0].text
    expect(s).toContain("[NOT_VERIFIED] 시험법 시행령 제2조")
    expect(s).toContain("[PARTIAL]")
    expect(s.includes("[SOURCE_LAW_CANDIDATE_VERIFIED] 시험법 제2조")).toBe(expected)
    expect(s).not.toContain("[DELEGATED_ARTICLE_VERIFIED]")
    expect(c.getLawText).toHaveBeenCalledTimes(expected?3:2)
    expect(c.fetchApi).toHaveBeenCalledTimes(1)
  })
  it("does not replace an official target whose exact article is verified",async()=>{
    const rs=records();rs[0].links={...edge(B,"2","제1조"),위임법령조문정보:{...edge(B,"2","제1조").위임법령조문정보,라인텍스트:"제2조"}}
    const c=fixture(rs);const original=c.getLawText.getMockImplementation()!
    c.getLawText.mockImplementation(async p=>{const raw=JSON.parse(await original(p));if(p.mst===A.mst)raw.법령.조문.조문단위.조문내용="자재[제2조의 자재]";return JSON.stringify(raw)})
    const s=(await run(c)).content[0].text
    expect(s).toContain("[DELEGATED_ARTICLE_VERIFIED]")
    expect(s).not.toContain("[SOURCE_LAW_CANDIDATE_VERIFIED]")
    expect(c.getLawText).toHaveBeenCalledTimes(3)
  })
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

describe("recursive target budget accounting",()=>{
  beforeEach(()=>{lawCache.clear();adminRuleXmlCache.clear()})
  const D=law("다른법","991103"),E=law("추가법","991104"),F=law("마지막법","991105")
  it("does not spend a new target slot on a cycle before later branches",async()=>{
    const c=fixture([
      {law:A,jo:"1",links:[edge(B,"2","제1조"),edge(C,"3","제1조"),edge(D,"4","제1조")]},
      {law:B,jo:"2",links:edge(A,"1","제2조")},
      {law:C,jo:"3",links:edge(E,"5","제3조")},
      {law:D,jo:"4",links:edge(F,"6","제4조")},
      {law:E,jo:"5",links:edge(A,"1","제5조")},
      {law:F,jo:"6",links:edge(E,"5","제6조")},
    ])
    const s=(await run(c)).content[0].text
    expect(s).toContain("하위 조문 확인 5건")
    expect(s).toContain("대상 시도 5건 / 중복·순환 재사용 3건")
    expect(s).toContain("[DELEGATED_ARTICLE_VERIFIED] 깊이 2 | 시험법 제1조 → 다른법 제4조 → 마지막법 제6조")
    expect(s.match(/\[ALREADY_SEEN\]/g)).toHaveLength(3)
    expect(c.getLawText).toHaveBeenCalledTimes(6)
    expect(s).not.toContain("미추적 후보")
  })
  it("preserves official source wording on a repeated queued target",async()=>{
    const c=fixture([
      {law:A,jo:"1",links:[edge(B,"2","제1조"),edge(C,"3","제1조")]},
      {law:B,jo:"2",links:edge(C,"3","제2조제1항")},
      {law:C,jo:"3",links:edge(A,"1","제3조")},
    ])
    const s=(await run(c)).content[0].text
    expect(s).toContain("대상 시도 2건 / 중복·순환 재사용 2건")
    expect(s).toContain("시작 위치 제2조제1항")
    expect(c.getLawText).toHaveBeenCalledTimes(3)
  })
  it("does not reuse a stale listed MST simply because the law name matches",async()=>{
    const c=fixture([
      {law:A,jo:"1",links:edge(B,"2","제1조")},
      {law:B,jo:"2",links:edge({...A,mst:"999999"},"1","제2조")},
    ])
    const s=(await run(c)).content[0].text
    expect(s).toContain("[LINKED_LAW_MST_NOT_CURRENT]")
    expect(s).toContain("중복·순환 재사용 0건")
    expect(s).not.toContain("[ALREADY_SEEN]")
  })
})

// Follow-up uses fresh exact searches, not cached law-search rows or client evidence.
describe("bounded delegation follow-up",()=>{
  beforeEach(()=>{lawCache.clear();adminRuleXmlCache.clear()})
  const D=law("다른법","991103"),E=law("추가법","991104"),F=law("마지막법","991105")
  const batch={source_name:A.lawName,source_mst:A.mst,source_id:A.lawId,source_effective_date:A.effectiveDate,source_article:"제1조",targets:[{name:B.lawName,mst:B.mst,article:"제2조"}]}
  const searchXml=(laws:typeof A[])=>`<LawSearch><totalCnt>${laws.length}</totalCnt>${laws.map(l=>`<law><법령명한글>${l.lawName}</법령명한글><법령ID>${l.lawId}</법령ID><법령일련번호>${l.mst}</법령일련번호><법령구분명>${l.lawType}</법령구분명><시행일자>${l.effectiveDate}</시행일자></law>`).join("")}</LawSearch>`
  const setup=()=>{const c=fixture(records());c.searchLaw.mockImplementation(async q=>searchXml([A,B,C].filter(l=>l.lawName===q)));return c}
  const call=async(c:ReturnType<typeof fixture>,p:unknown=batch)=>continueDelegationTrace(c.api,ContinueDelegationSchema.parse(p))
  it("returns a structured selector for an actual omitted direct edge",async()=>{
    const c=fixture([{law:A,jo:"1",links:[edge(B,"2","제1조"),edge(C,"3","제1조"),edge(D,"4","제1조"),edge(E,"5","제1조"),edge(F,"6","제1조"),edge(law("여섯번째법","991106"),"7","제1조")]},{law:B,jo:"2",links:[]},{law:C,jo:"3",links:[]},{law:D,jo:"4",links:[]},{law:E,jo:"5",links:[]},{law:F,jo:"6",links:[]}])
    const s=(await run(c)).content[0].text
    const row=s.split("\n").find(l=>l.startsWith("[FOLLOWUP_BATCH] "))!
    const p=ContinueDelegationSchema.parse(JSON.parse(row.slice("[FOLLOWUP_BATCH] ".length)))
    expect(p).toEqual({...batch,targets:[{name:"여섯번째법",mst:"991106",article:"제7조"}]})
    expect(c.getLawText).toHaveBeenCalledTimes(6)
  })
  it("revalidates parent and selected direct target without reading unrelated descendants",async()=>{
    const c=setup(),s=(await call(c)).content[0].text
    expect(s).toContain("[FOLLOWUP_SOURCE_VERIFIED]");expect(s).toContain("[FOLLOWUP_TARGET_VERIFIED] 시험법 시행령 제2조")
    expect(s).toContain("시작 위치 제1조");expect(s).toContain("원문 내용");expect(c.getLawText).toHaveBeenCalledTimes(2);expect(c.fetchApi).toHaveBeenCalledTimes(1)
    expect(c.searchLaw.mock.calls.map(([q])=>q)).toEqual([A.lawName,B.lawName])
  })
  it("rejects a forged or changed edge before target search",async()=>{
    const c=setup(),s=(await call(c,{...batch,targets:[{name:C.lawName,mst:C.mst,article:"제3조"}]})).content[0].text
    expect(s).toContain("[FOLLOWUP_NOT_LISTED]");expect(s).not.toContain("[FOLLOWUP_TARGET_VERIFIED]");expect(c.getLawText).toHaveBeenCalledTimes(1);expect(c.searchLaw).toHaveBeenCalledTimes(1)
  })
  it.each([{source_mst:"999999"},{source_id:"999999"},{source_effective_date:"20190101"}])("rejects stale source identity %j",async changed=>{
    const c=setup(),r=await call(c,{...batch,...changed});expect(r.isError).toBe(true);expect(r.content[0].text).toContain("버전 변경");expect(c.getLawText).not.toHaveBeenCalled();expect(c.fetchApi).not.toHaveBeenCalled()
  })
  it("rejects a listed target no longer current",async()=>{
    const c=setup();c.searchLaw.mockResolvedValueOnce(searchXml([A])).mockResolvedValueOnce(searchXml([{...B,mst:"999999"}]))
    const s=(await call(c)).content[0].text;expect(s).toContain("[FOLLOWUP_STALE_TARGET]");expect(c.getLawText).toHaveBeenCalledTimes(1)
  })
  it("deduplicates exact selectors and rejects conflicting names",async()=>{
    const c=setup(),r=await call(c,{...batch,targets:[batch.targets[0],batch.targets[0]]});expect(r.content[0].text).toContain("고유 대상 1건 / 원문 확인 1건");expect(c.getLawText).toHaveBeenCalledTimes(2)
    const d=setup(),bad=await call(d,{...batch,targets:[batch.targets[0],{...batch.targets[0],name:"무관법"}]});expect(bad.isError).toBe(true);expect(d.searchLaw).not.toHaveBeenCalled()
  })
  it("rejects malformed and incomplete fresh search results",async()=>{
    const c=setup();c.searchLaw.mockResolvedValueOnce(searchXml([A]).replace("<totalCnt>1","<totalCnt>2"));expect((await call(c)).isError).toBe(true);expect(c.getLawText).not.toHaveBeenCalled()
  })
  it("rejects an envelope from another effective slice",async()=>{
    const c=setup();c.fetchApi.mockResolvedValueOnce("{}");expect((await call(c)).isError).toBe(true);expect(c.getLawText).toHaveBeenCalledTimes(1)
  })
  it("does not confirm a wrong returned target article",async()=>{
    const c=setup();const original=c.getLawText.getMockImplementation()!;c.getLawText.mockImplementation(async p=>{const raw=JSON.parse(await original(p));if(p.mst===B.mst)raw.법령.조문.조문단위.조문번호="9999";return JSON.stringify(raw)})
    const s=(await call(c)).content[0].text;expect(s).toContain("[FOLLOWUP_TARGET_NOT_VERIFIED]");expect(s).not.toContain("[FOLLOWUP_TARGET_VERIFIED]")
  })
  it("limits selectors and rejects non-article or extra fields",()=>{
    expect(ContinueDelegationSchema.safeParse({...batch,targets:Array(6).fill(batch.targets[0])}).success).toBe(false)
    expect(ContinueDelegationSchema.safeParse({...batch,source_article:"제1조제2항"}).success).toBe(false)
    expect(ContinueDelegationSchema.safeParse({...batch,targets:[{...batch.targets[0],verified:true}]}).success).toBe(false)
  })
})


describe("relation wording in recursive and follow-up paths",()=>{
  beforeEach(()=>{lawCache.clear();adminRuleXmlCache.clear()})
  function setup(){
    const rs=records()
    Object.assign((rs[0].links as ReturnType<typeof edge>).위임법령조문정보,{라인텍스트:"사항은 대통령령으로"})
    Object.assign((rs[1].links as ReturnType<typeof edge>).위임법령조문정보,{라인텍스트:"재정경제부령으로 정하는 요건"})
    rs[2].links={위임행정규칙조문정보:{...admin.위임행정규칙조문정보,라인텍스트:"고용노동부장관이 정하여 고시한다"}}
    const c=fixture(rs),original=c.getLawText.getMockImplementation()!
    c.getLawText.mockImplementation(async p=>{const raw=JSON.parse(await original(p));raw.법령.조문.조문단위.조문내용=p.mst===A.mst?"사항은 대통령령으로 정한다.":p.mst===B.mst?"재정경제부령으로 정하는 요건을 갖춘다.":"고용노동부장관이 정하여 고시한다.";return JSON.stringify(raw)})
    return c
  }
  it("classifies verified source wording on both statutory and administrative edges without extra API reads",async()=>{
    const c=setup(),s=(await run(c)).content[0].text
    expect(s).toContain("관계문언: DELEGATION_WORDING (대통령령으로정한다")
    expect(s.match(/관계문언: REDELEGATION_WORDING/g)).toHaveLength(2)
    expect(s).toContain("효력 미판정")
    expect(c.getLawText).toHaveBeenCalledTimes(3)
    expect(c.fetchApi).toHaveBeenCalledTimes(3)
  })
  it("reuses verified parent wording in a follow-up without a new search round",async()=>{
    const c=setup()
    const original=c.searchLaw.getMockImplementation()!
    c.searchLaw.mockImplementation(async q=>{const xml=await original(q);return xml.replace(/<totalCnt>3<\/totalCnt>/,"<totalCnt>"+(xml.match(/<law>/g)?.length??0)+"</totalCnt>")})
    const result=await continueDelegationTrace(c.api,ContinueDelegationSchema.parse({source_name:A.lawName,source_mst:A.mst,source_id:A.lawId,source_effective_date:A.effectiveDate,source_article:"제1조",targets:[{name:B.lawName,mst:B.mst,article:"제2조"}]}))
    expect(result.content[0].text).toContain("관계문언: DELEGATION_WORDING")
    expect(c.getLawText).toHaveBeenCalledTimes(2)
    expect(c.fetchApi).toHaveBeenCalledTimes(1)
  })
})
