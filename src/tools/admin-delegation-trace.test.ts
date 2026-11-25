import { beforeEach, describe, expect, it, vi } from "vitest"
import { traceAdminRuleDelegations as trace, wantsAdminDelegationTrace, isHistoricalAdminTrace } from "./admin-delegation-trace.js"
import { adminRuleXmlCache } from "../lib/admin-rule-views.js"
import type { LawApiClient } from "../lib/api-client.js"
const law={lawName:"시험법 시행령",mst:"123456",lawId:"000001",lawType:"대통령령",effectiveDate:"20200101"}
const name="시험기준",serial="2100000000001"
const payload={lsDelegated:{법령:{법령정보:{"법령명":law.lawName,"법령일련번호":law.mst,"법령ID":law.lawId,"시행일자":law.effectiveDate},위임조문정보:[{조정보:{조문번호:"11",조문가지번호:"2"},위임정보:{위임구분:"행정규칙",위임행정규칙조문정보:{위임행정규칙일련번호:serial,위임행정규칙제목:name,라인텍스트:"정하여 고시한다",조항호목:"제11조의2제1항"}}}]}}}
const row=(id:string,date:string)=>"<admrul><행정규칙일련번호>"+id+"</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>"+name+"</행정규칙명><행정규칙종류>고시</행정규칙종류><시행일자>"+date+"</시행일자><발령일자>"+date+"</발령일자><발령번호>1</발령번호><제개정구분명>일부개정</제개정구분명><현행연혁구분>현행</현행연혁구분></admrul>"
function fixture({stale=false,wrongDate=false,broken=false,wrongSerial=false,wrongRuleId=false,missingIdentity=false}={}) {
  const fetchApi=vi.fn(async()=>broken?"not json":JSON.stringify(payload))
  const searchAdminRule=vi.fn(async()=>"<AdmRulSearch><totalCnt>"+(stale?2:1)+"</totalCnt>"+row(serial,"20200101")+(stale?row("2100000000002","20210101"):"")+"</AdmRulSearch>")
  const getAdminRule=vi.fn(async()=>"<AdmRulService>"+(missingIdentity?"":"<행정규칙일련번호>"+(wrongSerial?"2100000000002":serial)+"</행정규칙일련번호><행정규칙ID>"+(wrongRuleId?"9998":"9999")+"</행정규칙ID>")+"<행정규칙명>"+name+"</행정규칙명><시행일자>"+(wrongDate?"20200102":"20200101")+"</시행일자><발령일자>20200101</발령일자><조문내용>제1조(목적) 「시험법 시행령」 제11조의2에 따른 기준을 정한다.</조문내용></AdmRulService>")
  return {api:{fetchApi,searchAdminRule,getAdminRule} as unknown as LawApiClient,fetchApi,searchAdminRule,getAdminRule}
}
describe("administrative delegation source and version safeguards",()=>{
  beforeEach(()=>adminRuleXmlCache.clear())
  it("uses the documented official endpoint and verifies a linked current version",async()=>{const c=fixture();const r=await trace(c.api,{law,articles:["제11조의2"]});expect(c.fetchApi).toHaveBeenCalledWith(expect.objectContaining({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:{MST:law.mst}}));expect(r.content[0].text).toContain("[ADMIN_VERSION_VERIFIED]");expect(r.content[0].text).toContain("[DIRECT_CITATION_WORDING]")})
  it("does not silently promote a stale listed serial",async()=>{const c=fixture({stale:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).toContain("[LINKED_SERIAL_NOT_CURRENT]");expect(c.getAdminRule).not.toHaveBeenCalled()})
  it("separately verifies the current candidate after a stale listing, without promoting the link",async()=>{
    const c=fixture({stale:true})
    c.getAdminRule.mockResolvedValueOnce("<AdmRulService><행정규칙일련번호>2100000000002</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>"+name+"</행정규칙명><시행일자>20210101</시행일자><발령일자>20210101</발령일자><조문내용>제1조(목적) 「시험법 시행령」 제11조의2에 따른 기준을 정한다.</조문내용></AdmRulService>")
    const s=(await trace(c.api,{law,articles:["제11조의2"],inspectCurrentCandidate:true})).content[0].text
    expect(c.getAdminRule).toHaveBeenCalledWith("2100000000002",undefined)
    expect(s).toContain("[LINKED_SERIAL_NOT_CURRENT]")
    expect(s).toContain("[CURRENT_CANDIDATE_VERSION_VERIFIED]")
    expect(s).toContain("[CURRENT_CANDIDATE_CITATION_WORDING]")
    expect(s).not.toContain("[ADMIN_VERSION_VERIFIED]")
    expect(s).not.toContain("[DIRECT_CITATION_WORDING]")
    expect(s).toContain("[PARTIAL]")
  })
  it("finds a late article in a large rule using its explicitly defined alias",async()=>{
    const c=fixture({stale:true})
    const filler=Array.from({length:340},(_,i)=>`제${i+2}조(기준) ${"가".repeat(1000)}`).join("\n")
    const body='제1조(목적) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n'+filler+'\n제400조(보고) 영 제11조의2제1항에 따른 보고를 한다.'
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>2100000000002</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20210101</시행일자><발령일자>20210101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"],inspectCurrentCandidate:true})).content[0].text
    expect(s).toContain("[CURRENT_CANDIDATE_DECLARED_ALIAS_WORDING]")
    expect(s).toContain("제400조(보고)")
    expect(s).toContain("영 제11조의2제1항")
    expect(s).not.toContain("[ADMIN_VERSION_VERIFIED]")
  })
  it.each([
    '제1조(목적) 영 제11조의2에 따른다.',
    '제1조(목적) 「다른법 시행령」(이하 "영"이라 한다)에 따른다.\n제2조(보고) 영 제11조의2에 따른다.',
    '제1조(목적) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n제2조(보고) 「다른법 시행령」(이하 이 조에서 "영"이라 한다) 영 제11조의2에 따른다.',
    '제1조(목적) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n제2조(보고) 영 제11조의20에 따른다.'
  ])("does not infer an undefined, conflicting, or wrong article alias",async body=>{
    const c=fixture()
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).not.toContain("[DECLARED_ALIAS_CITATION_WORDING]")
  })
  it.each([
    '제1조(목적) 기준을 정한다.\n제2조(정의) 「시험법 시행령」(이하 "영"이라 한다)에서 정하는 바에 따른다.\n제3조(보고) 영 제11조의2에 따른다.',
    '제1조(목적) 기준을 정한다.\n제2조(정의) 「시험법」(이하 "법"이라 한다), 같은 법 시행령(이하 "영"이라 한다), 같은 법 시행규칙(이하 "규칙"이라 한다)에 따른다.\n제3조(보고) 영 제11조의2에 따른다.'
  ])("resolves an early definition and a relative decree name",async body=>{
    const c=fixture()
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("[DECLARED_ALIAS_CITATION_WORDING]")
    expect(s).toContain("제3조(보고)")
  })
  it.each([
    '제1조(목적) 기준을 정한다.\n제2조(정의) 「다른법」(이하 "법"이라 한다), 같은 법 시행령(이하 "영"이라 한다)에 따른다.\n제3조(보고) 영 제11조의2에 따른다.',
    '제1조(목적) 기준을 정한다.\n제2조(정의) 「시험법」(이하 "법"이라 한다)에 따른다. 같은 법 시행령(이하 "영"이라 한다)에 따른다.\n제3조(보고) 영 제11조의2에 따른다.',
    '제1조(목적) 기준을 정한다.\n제2조(특례) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n제3조(보고) 영 제11조의2에 따른다.',
    '제1조(목적) 기준을 정한다.\n제2조(정의) 「시험법」(이하 "법"이라 한다), 같은 법 시행령(이하 "영"이라 한다)에 따른다.\n제3조(보고) 「다른법 시행령」(이하 이 조에서\n"영"이라 한다) 영 제11조의2에 따른다.'
  ])("rejects an unsafe relative or scoped definition",async body=>{
    const c=fixture()
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).not.toContain("[DECLARED_ALIAS_CITATION_WORDING]")
  })
  it.each([
    ["제11조의2제1항제4호", "제11조의2제1항제4호", "EXACT=1"],
    ["제11조의2제1항제4호", "제11조의2제1항", "BROADER=1"],
    ["제11조의2제1항", "제11조의2제1항제4호", "NARROWER=1"],
    ["제11조의2제1항제4호", "제11조의2제2항제4호", "SAME_ARTICLE_OTHER_LOCATION=1"],
    ["제11조의2제1항제4호가목", "제11조의2제1항제4호가목", "EXACT=1"],
    ["제11조의2제1항제4호가목", "제11조의2제1항제4호나목", "SAME_ARTICLE_OTHER_LOCATION=1"],
    ["제11조의2제1항제4호의2", "제11조의2제1항제4호의2", "EXACT=1"],
    ["제11조의2제4호", "제11조의2제1항제4호", "SAME_ARTICLE_OTHER_LOCATION=1"],
    ["제11조의2제1항", "제11조의20제1항", "EXACT=0 / NARROWER=0 / BROADER=0 / SAME_ARTICLE_OTHER_LOCATION=0"],
    ["제11조의2제1항", "제11조의2제1항부터 제3항까지", "EXACT=0 / NARROWER=0 / BROADER=0 / SAME_ARTICLE_OTHER_LOCATION=0"],
    ["제11조의2제1항 각 호 외의 부분", "제11조의2제1항", "UNRESOLVED: 공식 위치 형식 미지원"],
  ])("compares literal official and cited locations: %s / %s",async (location,citation,expected)=>{
    const c=fixture()
    const p=structuredClone(payload)
    p.lsDelegated.법령.위임조문정보[0].위임정보.위임행정규칙조문정보.조항호목=location
    const body='제1조(목적) 「시험법 시행령」 '+citation+'에 따른다.'
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"],officialPayload:p})).content[0].text
    expect(s).toContain("[ADMIN_LOCATION_COMPARISON]")
    expect(s).toContain(expected)
    if(expected!=="EXACT=1")expect(s).not.toContain("EXACT=1")
  })
  it("finds an exact alias citation after the displayed excerpt limit without counting repeated citations twice",async()=>{
    const c=fixture()
    const body='제1조(목적) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n제2조(다른 항) '+Array.from({length:8},(_,i)=>'영 제11조의2제2항제'+(i+1)+'호').join(' 및 ')+'에 따른다.\n제3조(보고) 영 제11조의2제1항 및 영 제11조의2제1항에 따른다.'
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("EXACT=1")
    expect(s).toContain("SAME_ARTICLE_OTHER_LOCATION=8")
    expect(s).toContain("EXACT: 제3조(보고)")
    expect(s).toContain("[PARTIAL]")
  })
  it("rejects a current candidate with the wrong returned identity",async()=>{
    const c=fixture({stale:true})
    const s=(await trace(c.api,{law,articles:["제11조의2"],inspectCurrentCandidate:true})).content[0].text
    expect(s).toContain("[LINKED_SERIAL_NOT_CURRENT]")
    expect(s).toContain("[NOT_VERIFIED]")
    expect(s).not.toContain("[CURRENT_CANDIDATE_VERSION_VERIFIED]")
    expect(s).not.toContain("[CURRENT_CANDIDATE_CITATION_WORDING]")
  })
  it("rejects a mismatched returned effective date",async()=>{const c=fixture({wrongDate:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).toContain("[NOT_VERIFIED]");expect(r.content[0].text).not.toContain("[ADMIN_VERSION_VERIFIED]")})
  it("rejects a wrong returned administrative-rule serial even if title and dates match",async()=>{const c=fixture({wrongSerial:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).toContain("[NOT_VERIFIED]");expect(r.content[0].text).not.toContain("[ADMIN_VERSION_VERIFIED]")})
  it("rejects a wrong returned lineage ID",async()=>{const c=fixture({wrongRuleId:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).not.toContain("[ADMIN_VERSION_VERIFIED]")})
  it("rejects a body with missing identity metadata",async()=>{const c=fixture({missingIdentity:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).not.toContain("[ADMIN_VERSION_VERIFIED]")})
  it("never converts transport or schema failure into an empty link result",async()=>{const c=fixture({broken:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.isError).toBe(true);expect(c.searchAdminRule).not.toHaveBeenCalled()})
  it("does not fetch an unverified source date",async()=>{const c=fixture();const r=await trace(c.api,{law:{...law,effectiveDate:""},articles:["제11조의2"]});expect(r.isError).toBe(true);expect(c.fetchApi).not.toHaveBeenCalled()})
  it("keeps opt-in intent separate from historical cases",()=>{expect(wantsAdminDelegationTrace("건축법 제11조 고시 추적")).toBe(true);expect(wantsAdminDelegationTrace("건축법 제11조")).toBe(false);expect(isHistoricalAdminTrace("2024년 건축법 제11조 고시 추적")).toBe(true)})
})
