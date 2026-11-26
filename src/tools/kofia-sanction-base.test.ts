import { describe, expect, it } from "vitest"
import type { LawApiClient } from "../lib/api-client.js"
import "../tool-registry.js"
import { discoverTools, executeTool } from "./meta-tools.js"
import { KofiaSanctionBaseSchema, kofiaSanctionBase } from "./kofia-sanction-base.js"
const api = {} as LawApiClient
async function calc(violation:string, amount:number){
  const r=await kofiaSanctionBase(api,KofiaSanctionBaseSchema.parse({version:"20261112",violation,violation_amount_krw:amount}))
  const t=r.content[0].text
  expect(t).toContain("[BASE_SCENARIO_ONLY]")
  const d=JSON.parse(t.slice(t.indexOf("{\n"),t.lastIndexOf("\n}")+2))
  expect(d.legalEffectVerified).toBe(false);expect(d.currentnessVerified).toBe(false)
  return d
}
describe("fixed user-provided KOFIA annex base arithmetic",()=>{
  it.each([
    ["ipo_nonpayment",100_000_000,6,6,24], ["ipo_nonpayment",100_000_001,6,7,24],
    ["ipo_nonpayment",150_000_000,7,7,24], ["ipo_nonpayment",1_100_000_000,24,24,24],
    ["ipo_lockup",250_000_000,7,7,12], ["ipo_lockup",249_999_999,6,7,12],
    ["ipo_payment_capacity",400_000_000,8,8,12], ["ipo_false_information",900_000_000,12,12,12],
    ["ipo_proxy_subscription",50_000_000,6,6,12], ["ipo_manager_size",1_000_000_000,24,24,24],
    ["ipo_manager_other",500_000_000,6,6,6], ["ipo_related_underwriter",150_000_000,7,7,12],
    ["cornerstone_nonpayment",100_000_000,12,12,48], ["cornerstone_lockup",150_000_000,13,13,48],
    ["cornerstone_lockup",2_000_000_000,48,48,48],
  ] as const)("%s %d",async (kind,amount,lo,hi,cap)=>{
    const d=await calc(kind,amount);expect([d.cappedFloorMonths,d.cappedCeilMonths,d.baseCapMonths]).toEqual([lo,hi,cap])
  })
  it("preserves uncapped period and unresolved residual even when caps converge",async()=>{
    const d=await calc("ipo_nonpayment",1_100_000_001);expect([d.uncappedFloorMonths,d.uncappedCeilMonths]).toEqual([26,27]);expect(d.incompleteUnitUnresolved).toBe(true)
  })
  it("uses allocated shares rather than excess amount for capacity breaches",async()=>expect((await calc("ipo_payment_capacity",150_000_000)).amountBasis).toContain("초과금액 자체 아님"))
  it.each([0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN])("rejects invalid amount %s",amount=>expect(KofiaSanctionBaseSchema.safeParse({version:"20261112",violation:"ipo_nonpayment",violation_amount_krw:amount}).success).toBe(false))
  it.each(["20260312","current",null])("rejects unsupported version %s",version=>expect(KofiaSanctionBaseSchema.safeParse({version,violation:"ipo_nonpayment",violation_amount_krw:100}).success).toBe(false))
  it("rejects unsupported discretion-only violation",()=>expect(KofiaSanctionBaseSchema.safeParse({version:"20261112",violation:"venture_redemption",violation_amount_krw:100}).success).toBe(false))
})

describe("registered KOFIA tool",()=>{
  it("discovers the tool by exact regulatory alias",async()=>expect((await discoverTools(api,{intent:"불성실 수요예측"})).content[0].text).toContain("kofia_sanction_base"))
  it("runs through execute_tool and retains the source warning",async()=>{
    const r=await executeTool(api,{tool_name:"kofia_sanction_base",params:{version:"20261112",violation:"ipo_nonpayment",violation_amount_krw:150_000_000}})
    expect(r.isError).toBeFalsy();expect(r.content[0].text).toContain('"cappedFloorMonths": 7');expect(r.content[0].text).toContain("[PARTIAL]")
  })
})
