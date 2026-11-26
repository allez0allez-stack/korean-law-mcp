import {describe,it,expect} from 'vitest'
import {groupSanctionReview,ventureRedemptionBase} from './kofia-sanction-group.js'
const cases=[{case_id:'a',security_id:'A',event_date:'2026-10-01',restriction_months:6},{case_id:'b',security_id:'A',event_date:'2026-10-02',restriction_months:8},{case_id:'c',security_id:'B',event_date:'2026-10-03',restriction_months:4}]
describe('Annex 1 group and venture redemption arithmetic',()=>{
 it('counts distinct securities and selects longest, not sum, with latest event date',()=>expect(groupSanctionReview(cases)).toMatchObject({securityCount:2,caseCount:3,longestMonths:8,leadingSecurityIds:['A'],latestEventDate:'2026-10-03',finalSanctionDetermined:false}))
 it('retains ties for review',()=>expect(groupSanctionReview([...cases,{...cases[2],case_id:'d',restriction_months:8}]).leadingSecurityIds).toEqual(['A','B']))
 it('reconciles prior subset using explicitly supplied recomputed total',()=>expect(groupSanctionReview(cases,{months:6,decision_date:'2026-10-04',case_ids:['a'],recomputed_total_months:12}).reconciliation).toMatchObject({additionalMonths:6,recomputedTotalVerified:false}))
 it('does not create negative additional sanction',()=>expect(groupSanctionReview(cases,{months:10,decision_date:'2026-10-04',case_ids:['a'],recomputed_total_months:8}).reconciliation?.additionalMonths).toBeNull())
 it('rejects duplicate IDs, invalid dates, and post-decision events',()=>{expect(()=>groupSanctionReview([cases[0],cases[0]])).toThrow();expect(()=>groupSanctionReview([{...cases[0],event_date:'2026-02-30'}])).toThrow();expect(()=>groupSanctionReview(cases,{months:6,decision_date:'2026-10-03',case_ids:['a'],recomputed_total_months:12})).toThrow()})
 it.each([[250,1000,0,3],[300,1000,100,4],[900,1000,100,12],[1,1000,0,0.012]])('redemption %d %d %d', (a,b,c,m)=>expect(ventureRedemptionBase(a,b,c).months).toBeCloseTo(m))
 it('preserves fractional months without deciding rounding',()=>expect(ventureRedemptionBase(1,7,0)).toMatchObject({monthsNumerator:'12',monthsDenominator:'7',wholeMonthFloor:1,wholeMonthCeil:2,roundingVerified:false}))
 it('rejects zero or negative denominator and inconsistent ledger',()=>{expect(()=>ventureRedemptionBase(1,100,100)).toThrow();expect(()=>ventureRedemptionBase(101,100,0)).toThrow();expect(()=>ventureRedemptionBase(0,100,0)).toThrow()})
})
