import {beforeEach, describe, expect, it, vi} from "vitest"
import type {LawApiClient} from "../lib/api-client.js"
import {verifyHistoricalDelegation} from "./historical-delegation.js"
import {getLawText} from "./law-text.js"
import {getAdminRule} from "./admin-rule.js"
import {fetchLineageVersions} from "../lib/law-lineage.js"
import {fetchAdminRuleHistory} from "../lib/admin-rule-history.js"
import {loadAdminRuleDoc} from "../lib/admin-rule-doc.js"

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
vi.mock("../lib/admin-rule-doc.js",()=>({
 loadAdminRuleDoc:vi.fn(async()=>({
  ruleName:"금융투자업규정",issuedDate:"20251001",efDate:"20251001",
  addenda:[
    "부칙 제2025-26호\\n제1조(시행일) 이 고시는 2025년 10월 1일부터 시행한다.\\n제2조(경과조치) 제7-41조의7제8항은 종전의 규정에 따른다.",
    "부칙 제2021-42호\\n제3조(적용례) 영 제271조의10제13항에 따른 보고절차는 시행 이후 적용한다.",
  ],
 }))
}))

const input={lawId:"010513",jo:"제249조의7",decreeLawId:"010817",decreeJo:"제271조의10",adminRuleName:"금융투자업규정",adminRuleId:"2100000285020",asOf:"20251021"}
const client={
 getLawText:vi.fn(async (p:{mst:string})=>JSON.stringify({법령:{
   기본정보:{시행일자:"20251001"},
   부칙:{부칙단위:[{
    부칙공포번호:"1",부칙공포일자:"20251001",
    부칙내용:[p.mst==="277365"
      ?"제2조(경과조치) 제249조의7의 종전 규정에 따른다."
      :"제3조(적용례) 제271조의10에 따라 고시하는 사항은 시행 이후 적용한다."]
   }]}
 }}))
} as unknown as LawApiClient

describe("historical delegation: three independent exact versions",()=>{
 beforeEach(()=>vi.clearAllMocks())
 it("uses three historical versions; never asks for a current three-tier result",async()=>{
  const r=await verifyHistoricalDelegation(client,input)
  const t=r.content[0].text
  expect(t).toContain("MST 277365")
  expect(t).toContain("MST 278155")
  expect(t).toContain("일련번호 2100000266378")
  expect(t).toContain("[문언상 대응 후보]")
  expect(t).toContain("▶ 부칙·분리시행 검토 게이트")
  expect(t).toContain("[REVIEW_REQUIRED — 원자료 확보")
  expect(t).toContain("[적용 여부 미확정:조문 직접 언급]")
  expect(t).toContain("[고시] 부칙 원본 2블록")
  expect(t).toContain("[적용 여부 미확정:고시 조문 직접 언급]")
  expect(t).toContain("[적용 여부 미확정:시행령 조문 직접 언급]")
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
 it("keeps citation result but labels addenda partial when the original version JSON fails",async()=>{
  vi.mocked(client.getLawText).mockRejectedValueOnce(new Error("temporary upstream error"))
  const r=await verifyHistoricalDelegation(client,input)
  expect(r.content[0].text).toContain("[PARTIAL — 부칙 원자료 미확인]")
  expect(r.content[0].text).toContain("[법률][NOT_VERIFIED]")
  expect(r.content[0].text).toContain("MST 277365")
 })
 it("reports PARTIAL when official historical notice addenda are missing",async()=>{
  vi.mocked(loadAdminRuleDoc).mockResolvedValueOnce({
    ruleName:"금융투자업규정",issuedDate:"20251001",efDate:"20251001",addenda:null,
  } as Awaited<ReturnType<typeof loadAdminRuleDoc>>)
  const r=await verifyHistoricalDelegation(client,input)
  expect(r.content[0].text).toContain("[고시][NOT_VERIFIED]")
  expect(r.content[0].text).toContain("[PARTIAL — 부칙 원자료 미확인]")
  expect(r.content[0].text).toContain("MST 277365")
 })
 it("rejects wrong XML serial metadata instead of trusting a different notice's addenda",async()=>{
  vi.mocked(loadAdminRuleDoc).mockResolvedValueOnce({
    ruleName:"다른 고시",issuedDate:"20251001",efDate:"20251001",addenda:["제7-41조의7"],
  } as Awaited<ReturnType<typeof loadAdminRuleDoc>>)
  const r=await verifyHistoricalDelegation(client,input)
  expect(r.content[0].text).toContain("[고시][NOT_VERIFIED]")
  expect(r.content[0].text).not.toContain("[고시] 부칙 원본")
 })
 it("rejects future date without contacting source APIs",async()=>{
  const r=await verifyHistoricalDelegation(client,{...input,asOf:"20300101"})
  expect(r.content[0].text).toContain("[NOT_VERIFIED]")
  expect(fetchLineageVersions).not.toHaveBeenCalled()
  expect(fetchAdminRuleHistory).not.toHaveBeenCalled()
 })
})
