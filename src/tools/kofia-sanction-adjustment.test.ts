import {describe, expect, it} from 'vitest'
import {reviewKofiaAdjustment} from './kofia-sanction-adjustment.js'
const run = (before:number, reduction:number, benefit:number, membership:'member'|'nonmember'|'unknown'='member') => reviewKofiaAdjustment({preMitigationMonths:before,proposedMitigationMonths:reduction,economicBenefitKrw:benefit,membership})
describe('KOFIA source-verified review, not a final sanction',()=>{
  it.each([[8,6,0,2],[8,6,4_999_999,2],[8,6,5_000_000,3],[8,6,10_000_000,4],[8,6,100_000_000,8],[8,0,100_000_000,8],[0,0,0,0]])('preserves protected mitigation boundary %d %d %d', (b,r,e,m)=>expect(run(b,r,e).scenarioMonths).toBe(m))
  it('limits payment review to 3 months and does not assume approval',()=>{
    expect(run(3,0,0,'nonmember').paymentRoute).toBe('PAYMENT_INTENT_AND_COMMITTEE_APPROVAL_REQUIRED')
    expect(run(4,0,0).feeScenarioKrw).toBeNull()
    expect(run(3,0,0,'unknown').paymentRoute).toBe('MEMBERSHIP_UNVERIFIED')
    expect(run(3,0,0).committeeDecisionVerified).toBe(false)
  })
  it('preserves two monetary remainder interpretations',()=>expect(run(1,0,6_500_000).feeScenarioKrw).toEqual({millionUnitFloor:6_000_000,retainRemainder:6_500_000}))
  it.each([[-1,0,0],[2,3,0],[2,1,-1],[2.5,1,0],[2,1,NaN],[Number.MAX_SAFE_INTEGER,0,0]])('rejects invalid or unsafe inputs', (b,r,e)=>expect(()=>run(b,r,e)).toThrow(RangeError))
  it('verifies source version but never final sanction',()=>{const d=run(3,1,0); expect(d.annexVersionVerified).toBe(true);expect(d.finalSanctionDetermined).toBe(false);expect(d.legalEffectVerified).toBe(false)})
})


describe('KOFIA review arithmetic invariant regression',()=>{
  it('matches exact integer reference across 47,775 combinations',()=>{
    const benefits=[0,1,999999,1000000,1000001,4999999,5000000,5000001,9999999,10000000,10000001,100000000,Number.MAX_SAFE_INTEGER]
    let count=0
    for(let b=0;b<=48;b++) for(let r=0;r<=b;r++) for(const membership of ['member','nonmember','unknown'] as const){
      let previous=-1
      for(const benefit of benefits){
        const d=run(b,r,benefit,membership)
        const protectedMonths=Math.min(r,Number(BigInt(benefit)/5000000n))
        expect(d.protectedMonths).toBe(protectedMonths)
        expect(d.scenarioMonths).toBe(b-r+protectedMonths)
        expect(d.scenarioMonths>=previous && d.scenarioMonths<=b).toBe(true)
        expect(d.paymentReviewThresholdMet).toBe(d.scenarioMonths<=3)
        expect(d.legalEffectVerified).toBe(false)
        expect(d.finalSanctionDetermined).toBe(false)
        if(d.scenarioMonths<=3){
          expect(d.feeScenarioKrw?.millionUnitFloor).toBe(Math.max(d.scenarioMonths*5000000,Number(BigInt(benefit)/1000000n*1000000n)))
          expect(d.feeScenarioKrw!.retainRemainder>=d.feeScenarioKrw!.millionUnitFloor).toBe(true)
        }else expect(d.feeScenarioKrw).toBeNull()
        previous=d.scenarioMonths
        count++
      }
    }
    expect(count).toBe(47775)
  },30000)
})
