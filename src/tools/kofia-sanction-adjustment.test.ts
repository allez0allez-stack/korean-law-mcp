import {describe, expect, it} from 'vitest'
import {reviewKofiaAdjustment} from './kofia-sanction-adjustment.js'
const run = (before:number, reduction:number, benefit:number, membership:'member'|'nonmember'|'unknown'='member') => reviewKofiaAdjustment({preMitigationMonths:before,proposedMitigationMonths:reduction,economicBenefitKrw:benefit,membership})
describe('KOFIA secondary evidence review, not a final sanction',()=>{
  it.each([[8,6,0,2],[8,6,4_999_999,2],[8,6,5_000_000,3],[8,6,10_000_000,4],[8,6,100_000_000,8],[8,0,100_000_000,8],[0,0,0,0]])('preserves protected mitigation boundary %d %d %d', (b,r,e,m)=>expect(run(b,r,e).scenarioMonths).toBe(m))
  it('limits payment review to 3 months and does not assume approval',()=>{
    expect(run(3,0,0,'nonmember').paymentRoute).toBe('PAYMENT_INTENT_AND_COMMITTEE_APPROVAL_REQUIRED')
    expect(run(4,0,0).feeScenarioKrw).toBeNull()
    expect(run(3,0,0,'unknown').paymentRoute).toBe('MEMBERSHIP_UNVERIFIED')
    expect(run(3,0,0).committeeDecisionVerified).toBe(false)
  })
  it('preserves two monetary remainder interpretations',()=>expect(run(1,0,6_500_000).feeScenarioKrw).toEqual({millionUnitFloor:6_000_000,retainRemainder:6_500_000}))
  it.each([[-1,0,0],[2,3,0],[2,1,-1],[2.5,1,0],[2,1,NaN],[Number.MAX_SAFE_INTEGER,0,0]])('rejects invalid or unsafe inputs', (b,r,e)=>expect(()=>run(b,r,e)).toThrow(RangeError))
  it('never promotes secondary evidence to verified annex or final sanction',()=>{const d=run(3,1,0); expect(d.annexVersionVerified).toBe(false);expect(d.finalSanctionDetermined).toBe(false);expect(d.legalEffectVerified).toBe(false)})
})
