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
  it.each([
    ["제11조의2제2항", "제11조의2제1항 및 제2항", "CONTEXT_LIST=1", "EXACT=0"],
    ["제11조의2제1항제4호", "제11조의2제1항제1호부터 제4호까지", "RANGE_ENDPOINT=1", "EXACT=0"],
    ["제11조의2제1항제2호", "제11조의2제1항제1호부터 제4호까지", "RANGE_ENDPOINT=0", "EXACT=0"],
    ["제11조의2제1항제4호", "제11조의2제1항제1호부터 제4호", "RANGE_ENDPOINT=0", "EXACT=0"],
    ["제11조의2제1항제1호", "제11조의2제1항제1호부터 제4호까지", "RANGE_ENDPOINT=1", "EXACT=0"],
    ["제11조의2제2항", "제11조의2제1항 및 제2항부터 제4항까지", "CONTEXT_LIST=0", "EXACT=0"],
    ["제11조의2제2항", "제11조의2제1항 및 제2항 단서", "CONTEXT_LIST=0", "EXACT=0"],
    ["제11조의2제1항", "제11조의2제1항 본문", "CONTEXT_LIST=0", "EXACT=0"],
    ["제11조의2제1항", "제11조의2제1항 각 호 외의 부분", "CONTEXT_LIST=0", "EXACT=0"],
    ["제11조의2제1항제1호나목", "제11조의2제1항제1호가목 또는 나목", "CONTEXT_LIST=1", "EXACT=0"],
  ])("separates contextual evidence from literal matches: %s / %s",async(location,citation,expected,literal)=>{
    const c=fixture()
    const p=structuredClone(payload)
    p.lsDelegated.법령.위임조문정보[0].위임정보.위임행정규칙조문정보.조항호목=location
    const body='제1조(목적) 「시험법 시행령」(이하 "영"이라 한다)에 따른다.\n제2조(보고) 영 '+citation+'에 따른다.'
    c.getAdminRule.mockResolvedValueOnce(`<AdmRulService><행정규칙일련번호>${serial}</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>${name}</행정규칙명><시행일자>20200101</시행일자><발령일자>20200101</발령일자><조문내용>${body}</조문내용></AdmRulService>`)
    const s=(await trace(c.api,{law,articles:["제11조의2"],officialPayload:p})).content[0].text
    expect(s).toContain(expected)
    expect(s).toContain(literal)
  })
  it.each([
    ['<부칙내용>부칙 제2조(경과조치) 「시험법 시행령」 제11조의2제1항에 따른다.</부칙내용>', "ADDENDUM | 부칙 #1 | 제11조의2제1항 | EXACT_TEXT_LOCATION"],
    ['<별표제목>별표 1</별표제목><별표내용>「시험법 시행령」 제11조의2제1항에 따른 기준</별표내용>', "ANNEX | 별표 #1 별표 1 | 제11조의2제1항 | EXACT_TEXT_LOCATION"],
    ['<별표내용>「시험법 시행령」 제11조의2제2항에 따른 기준</별표내용>', "ANNEX | 별표 #1 | 제11조의2제2항 | ARTICLE_TEXT_REFERENCE"],
  ])("keeps supplementary citations separate from operative article counts",async(extra,expected)=>{
    const c=fixture()
    const xml=await c.getAdminRule.getMockImplementation()!()
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</AdmRulService>",extra+"</AdmRulService>"))
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("[ADMIN_EXTRA_CITATION_EVIDENCE] 일련번호 "+serial+"\n"+expected)
    expect(s).toContain("제11조의2제1항 | EXACT=0 / NARROWER=0 / BROADER=1")
    expect(s).toContain("경과조치 효력")
  })
  it.each([
    '<부칙내용>영 제11조의2제1항에 따른다.</부칙내용>',
    '<별표내용>「다른법 시행령」 제11조의2제1항에 따른다.</별표내용>',
    '<별표제목>「시험법 시행령」 제11조의2제1항</별표제목><별표내용>별도의 기준</별표내용>',
    '<별표내용>「시험법 시행령」 제11조의20제1항에 따른다.</별표내용>',
  ])("does not transfer current aliases, foreign laws, titles or adjacent article numbers to extra evidence",async extra=>{
    const c=fixture()
    const xml=await c.getAdminRule.getMockImplementation()!()
    c.getAdminRule.mockResolvedValueOnce(xml.replace("제1조(목적)", '제1조(목적) 「시험법 시행령」(이하 "영"이라 한다).').replace("</AdmRulService>",extra+"</AdmRulService>"))
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("고유 블록·인용 0건")
    expect(s).not.toContain("[ADMIN_EXTRA_CITATION_EVIDENCE]")
  })
  it("reports uninspected images, attachments and capped extra text",async()=>{
    const c=fixture()
    const xml=await c.getAdminRule.getMockImplementation()!()
    const extra='<별표내용>&lt;img id="123"&gt;</별표내용><부칙내용>'+"가".repeat(100001)+'</부칙내용><첨부파일링크>https://www.law.go.kr/sample.pdf</첨부파일링크>'
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</조문내용>","가".repeat(120)+"</조문내용>").replace("</AdmRulService>",extra+"</AdmRulService>"))
    const r=await trace(c.api,{law,articles:["제11조의2"]})
    expect(r.coverage).toBe("PARTIAL")
    expect(r.content[0].text).toContain("첨부 1건 미열람")
    expect(r.content[0].text).toContain("별표·부칙 텍스트/표시 한도")
  })
  it("extracts explicit application and transition date wording without deciding applicability",async()=>{
    const c=fixture(), xml=await c.getAdminRule.getMockImplementation()!()
    const extra='<부칙내용>부칙 [제2026-73호, 2026. 11. 4.]\n제1조(시행일) 이 고시는 발령한 날부터 시행한다.\n제2조(인정심사에 관한 적용례) 별표의 개정규정은 2027년 1월 1일 이후 인정 또는 재인정을 신청하는 경우부터 적용한다.\n제3조(인정사업장 사후점검에 관한 경과조치) 2027년 1월 1일 전에 인정 또는 재인정을 신청한 사업장은 종전의 별표에 따른다.</부칙내용>'
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</AdmRulService>",extra+"</AdmRulService>"))
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("[ADMIN_TRANSITION_DATE_EVIDENCE]")
    expect(s).toContain("20270101 이후")
    expect(s).toContain("20270101 전")
    expect(s).toContain("명시 날짜 미확인")
    expect(s).toContain("인정 또는 재인정을 신청하는 경우")
    expect(s).toContain("사안별 적용법령·효력을 확정하지 않음")
    expect(s).not.toContain("20261104 이후")
  })
  it.each([
    ["제2조(경과조치) 2027년 2월 29일 이후 신청에 적용한다.","20270229 이후"],
    ["제2조(경과조치) 2027년 13월 1일 이후 신청에 적용한다.","20271301 이후"],
    ["제2조(기타) 2027년 1월 1일 이후 신청에 적용한다.","20270101 이후"],
  ])("does not normalize invalid dates or unrelated headings",async(body,wrong)=>{
    const c=fixture(), xml=await c.getAdminRule.getMockImplementation()!()
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</AdmRulService>","<부칙내용>부칙\n"+body+"</부칙내용></AdmRulService>"))
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("[ADMIN_TRANSITION_SCOPE]")
    expect(s).not.toContain(wrong)
  })
  it("preserves multiple valid dates and does not resolve relative dates",async()=>{
    const c=fixture(), xml=await c.getAdminRule.getMockImplementation()!()
    const extra='<부칙내용>부칙\n제1조(시행일) 2028년 2월 29일부터 시행한다. 다만 제2조는 2028년 3월 1일부터 시행한다.\n제2조(적용례) 시행일부터 3개월 이후 신청분에 적용한다.</부칙내용>'
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</AdmRulService>",extra+"</AdmRulService>"))
    const s=(await trace(c.api,{law,articles:["제11조의2"]})).content[0].text
    expect(s).toContain("20280229 부터, 20280301 부터")
    expect(s).toContain("명시 날짜 미확인")
    expect(s).toContain("다만 제2조")
  })
  it("flags capped transition evidence rather than claiming full coverage",async()=>{
    const c=fixture(), xml=await c.getAdminRule.getMockImplementation()!()
    const extra='<부칙내용>부칙\n'+Array.from({length:9},(_,i)=>'제'+(i+1)+'조(경과조치) 2027년 1월 1일 이후 신청분에 적용한다.').join('\n')+'</부칙내용>'
    c.getAdminRule.mockResolvedValueOnce(xml.replace("</AdmRulService>",extra+"</AdmRulService>"))
    const r=await trace(c.api,{law,articles:["제11조의2"]})
    expect(r.coverage).toBe("PARTIAL")
    expect(r.content[0].text).toContain("제목 후보 9건")
    expect(r.content[0].text).toContain("[PARTIAL] 부칙 날짜 증거")
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
