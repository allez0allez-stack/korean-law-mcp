import { beforeEach, describe, expect, it, vi } from "vitest"
import { traceAdminRuleDelegations as trace, wantsAdminDelegationTrace, isHistoricalAdminTrace } from "./admin-delegation-trace.js"
import { adminRuleXmlCache } from "../lib/admin-rule-views.js"
import type { LawApiClient } from "../lib/api-client.js"
const law={lawName:"시험법 시행령",mst:"123456",lawId:"000001",lawType:"대통령령",effectiveDate:"20200101"}
const name="시험기준",serial="2100000000001"
const payload={service:{basic:{"법령명":law.lawName,"법령일련번호":law.mst,"법령ID":law.lawId,"시행일자":law.effectiveDate},rows:[{조문번호:"제11조의2",links:[{위임행정규칙일련번호:serial,위임행정규칙제목:name,위임구분:"위임행정규칙",라인텍스트:"정하여 고시한다"}]}]}}
const row=(id:string,date:string)=>"<admrul><행정규칙일련번호>"+id+"</행정규칙일련번호><행정규칙ID>9999</행정규칙ID><행정규칙명>"+name+"</행정규칙명><행정규칙종류>고시</행정규칙종류><시행일자>"+date+"</시행일자><발령일자>"+date+"</발령일자><발령번호>1</발령번호><제개정구분명>일부개정</제개정구분명><현행연혁구분>현행</현행연혁구분></admrul>"
function fixture({stale=false,wrongDate=false,broken=false}={}) {
  const fetchApi=vi.fn(async()=>broken?"not json":JSON.stringify(payload))
  const searchAdminRule=vi.fn(async()=>"<AdmRulSearch><totalCnt>"+(stale?2:1)+"</totalCnt>"+row(serial,"20200101")+(stale?row("2100000000002","20210101"):"")+"</AdmRulSearch>")
  const getAdminRule=vi.fn(async()=>"<AdmRulService><행정규칙명>"+name+"</행정규칙명><시행일자>"+(wrongDate?"20200102":"20200101")+"</시행일자><발령일자>20200101</발령일자><조문내용>제1조(목적) 「시험법 시행령」 제11조의2에 따른 기준을 정한다.</조문내용></AdmRulService>")
  return {api:{fetchApi,searchAdminRule,getAdminRule} as unknown as LawApiClient,fetchApi,searchAdminRule,getAdminRule}
}
describe("administrative delegation source and version safeguards",()=>{
  beforeEach(()=>adminRuleXmlCache.clear())
  it("uses the documented official endpoint and verifies a linked current version",async()=>{const c=fixture();const r=await trace(c.api,{law,articles:["제11조의2"]});expect(c.fetchApi).toHaveBeenCalledWith(expect.objectContaining({endpoint:"lawService.do",target:"lsDelegated",type:"JSON",extraParams:{MST:law.mst}}));expect(r.content[0].text).toContain("[ADMIN_VERSION_VERIFIED]");expect(r.content[0].text).toContain("[DIRECT_CITATION_WORDING]")})
  it("does not silently promote a stale listed serial",async()=>{const c=fixture({stale:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).toContain("[LINKED_SERIAL_NOT_CURRENT]");expect(c.getAdminRule).not.toHaveBeenCalled()})
  it("rejects a mismatched returned effective date",async()=>{const c=fixture({wrongDate:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.content[0].text).toContain("[NOT_VERIFIED]");expect(r.content[0].text).not.toContain("[ADMIN_VERSION_VERIFIED]")})
  it("never converts transport or schema failure into an empty link result",async()=>{const c=fixture({broken:true});const r=await trace(c.api,{law,articles:["제11조의2"]});expect(r.isError).toBe(true);expect(c.searchAdminRule).not.toHaveBeenCalled()})
  it("does not fetch an unverified source date",async()=>{const c=fixture();const r=await trace(c.api,{law:{...law,effectiveDate:""},articles:["제11조의2"]});expect(r.isError).toBe(true);expect(c.fetchApi).not.toHaveBeenCalled()})
  it("keeps opt-in intent separate from historical cases",()=>{expect(wantsAdminDelegationTrace("건축법 제11조 고시 추적")).toBe(true);expect(wantsAdminDelegationTrace("건축법 제11조")).toBe(false);expect(isHistoricalAdminTrace("2024년 건축법 제11조 고시 추적")).toBe(true)})
})
