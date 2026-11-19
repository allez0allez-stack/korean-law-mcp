import {beforeEach, describe, expect, it, vi} from "vitest"
import type {LawApiClient} from "../lib/api-client.js"
import {verifyHistoricalDelegation} from "./historical-delegation.js"
import {getLawText} from "./law-text.js"
import {getAdminRule} from "./admin-rule.js"
import {fetchLineageVersions} from "../lib/law-lineage.js"
import {fetchAdminRuleHistory} from "../lib/admin-rule-history.js"

vi.mock("../lib/law-lineage.js",async(importOriginal)=>{
  const original=await importOriginal<typeof import("../lib/law-lineage.js")>()
  return {...original,fetchLineageVersions:vi.fn(async (_c:any,id:string)=>({
    versions:[{mst:id==="010513"?"277365":"278155",efYd:"20251001",ancNo:"1",ancYd:"20251001",lawNm:id==="010513"?"테스트법":"테스트령",rrCls:"일부개정"}],
    totalCount:1,fetchedPages:1,
  })),todayKst:()=> "20261119"}
})
vi.mock("../lib/admin-rule-history.js",async(importOriginal)=>{
 const original=await importOriginal<typeof import("../lib/admin-rule-history.js")>()
 return {...original,fetchAdminRuleHistory:vi.fn(async()=>({
   groups:new Map([["36022",[
     {serial:"2100000285020",ruleId:"36022",name:"금융투자업규정",kind:"고시",issuedYd:"20260909",issuedNo:"2026-38",efYd:"20260909",rrCls:"일부개정",org:"금융위원회",isCurrent:true},
     {serial:"2100000266378",ruleId:"36022",name:"금융투자업규정",kind:"고시",issuedYd:"20251001",issuedNo:"2025-26",efYd:"20251001",rrCls:"일부개정",org:"금융위원회",isCurrent:false}
   ]]]),totalCount:2,truncated:false,
 }))}
})
vi.mock("./law-text.js",()=>({getLawText:vi.fn(async (_:unknown,p:{mst:string})=>({
 content:[{type:"text",text:p.mst==="277365"
 ? "법령명: 테스트법\n시행일: 20251001\n제249조의7 조문\n"
 : "법령명: 테스트령\n시행일: 20251001\n제271조의10\n⑬ 법 제249조의7제3항제4호에 따른 금융위원회가 정하여 고시하는 사항 ⑮ 금융위원회가 정하여 고시하는 회사"
 }] 
}))}))
vi.mock("./admin-rule.js",()=>({getAdminRule:vi.fn(async (_:unknown,p:{jo?:string})=>({
 content:[{type:"text",text:p.jo
 ? "행정규칙명: 금융투자업규정\n시행일: 2025.10.01\n⚠️ 연혁본(현행 아님)\n제7-41조의7\n⑧ 영 제271조의10제13항제4호에서 금융위원회가 정하여 고시하는 사항 ⑩ 영 제271조의10제15항제6호에서 금융위원회가 정하여 고시하는 회사"
 : "행정규칙명: 금융투자업규정\n시행일: 2025.10.01\n[본문 검색: 제271조의10]\n'제271조의10' 포함 조문 1개: 제7-41조의7\n(일부 표시)"
 }]
}))}))
const input={lawId:"010513",jo:"제249조의7",decreeLawId:"010817",decreeJo:"제271조의10",adminRuleName:"금융투자업규정",adminRuleId:"2100000285020",asOf:"20251021"}
const client={} as LawApiClient

describe("historical delegation: three independent exact versions",()=>{
 beforeEach(()=>vi.clearAllMocks())
 it("uses three historical versions; never asks for a current three-tier result",async()=>{
  const r=await verifyHistoricalDelegation(client,input)
  const t=r.content[0].text
  expect(t).toContain("MST 277365")
  expect(t).toContain("MST 278155")
  expect(t).toContain("일련번호 2100000266378")
  expect(t).toContain("[문언상 대응 후보]")
  expect(getLawText).toHaveBeenCalledTimes(2)
  expect(getAdminRule).toHaveBeenCalledTimes(2)
  expect(vi.mocked(getAdminRule).mock.calls[1][1]).toMatchObject({id:"2100000266378",jo:"제7-41조의7"})
 })
 it("rejects wrong notice genealogy rather than borrowing another notice",async()=>{
  const r=await verifyHistoricalDelegation(client,{...input,adminRuleId:"9999999999999"})
  expect(r.content[0].text).toContain("[NOT_VERIFIED]")
  expect(getLawText).not.toHaveBeenCalled()
 })
 it("fails closed when the notice article search is ambiguous",async()=>{
  vi.mocked(getAdminRule).mockResolvedValueOnce({content:[{type:"text",text:"'제271조의10' 포함 조문 2개: 제1조, 제2조"}]})
  const r=await verifyHistoricalDelegation(client,input)
  expect(r.content[0].text).toContain("[NOT_VERIFIED]")
  expect(vi.mocked(getAdminRule).mock.calls.length).toBe(1)
 })
 it("fails closed when fetched historical text effective date differs",async()=>{
  vi.mocked(getLawText).mockResolvedValueOnce({content:[{type:"text",text:"법령명: 테스트법\n시행일: 20250901\n제249조의7"}]})
  const r=await verifyHistoricalDelegation(client,input)
  expect(r.content[0].text).toContain("[NOT_VERIFIED]")
  expect(r.content[0].text).toContain("시행일")
 })
 it("rejects future date without contacting source APIs",async()=>{
  const r=await verifyHistoricalDelegation(client,{...input,asOf:"20300101"})
  expect(r.content[0].text).toContain("[NOT_VERIFIED]")
  expect(fetchLineageVersions).not.toHaveBeenCalled()
  expect(fetchAdminRuleHistory).not.toHaveBeenCalled()
 })
})
