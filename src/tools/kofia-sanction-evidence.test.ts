import {describe,it,expect} from 'vitest'
import {lockupCompliance,bondBase,aggravationLimits,economicBenefitStandard} from './kofia-sanction-evidence.js'
describe('20261112 Annex 1 source-bound arithmetic',()=>{
 it('caps balances at committed shares and finds minimum',()=>{const r=lockupCompliance(100,100,4,[150,60,80,100],2000);expect(r).toMatchObject({violationShares:40,violationAmountKrw:80000,numerator:'340',denominator:'400',compliancePercent:85,meets80Percent:true})})
 it('uses allocated shares as denominator and exact 80% threshold',()=>{expect(lockupCompliance(100,80,2,[80,80],1).meets80Percent).toBe(true);expect(lockupCompliance(100,80,2,[80,79],1).meets80Percent).toBe(false)})
 it('rejects incomplete or invalid balance records',()=>{expect(()=>lockupCompliance(100,100,2,[100],1)).toThrow();expect(()=>lockupCompliance(100,101,1,[100],1)).toThrow();expect(()=>lockupCompliance(100,100,1,[-1],1)).toThrow()})
 it.each([[20e9,100e9,2],[20e9+1,100e9,3],[40e9,100e9,3],[40e9+1,100e9,4],[10e9,20e9,3],[10e9+1,20e9,4],[1e9,10e9,2]])('bond thresholds %d %d', (a,i,m)=>expect(bondBase(a,i).baseMonths).toBe(m))
 it('rejects impossible bond issue',()=>expect(()=>bondBase(100,99)).toThrow())
 it.each([[1,0],[2,50],[3,100],[4,100],[5,200],[10,200]])('repeat count %d', (n,p)=>expect(aggravationLimits('ipo_nonpayment',n,false)).toMatchObject({repeatPercent:p,finalCapMonths:36}))
 it('separates listing day from repeat aggravation and bond rules',()=>{expect(aggravationLimits('ipo_lockup',3,true)).toMatchObject({listingDayPercent:50,listingDayMinimumMonths:1,finalCapMonths:24});expect(aggravationLimits('bond',3,false).repeatBondMonths).toBe(2);expect(()=>aggravationLimits('bond',3,true)).toThrow()})
 it('preserves signed loss and gain standards',()=>{expect(economicBenefitStandard('nonpayment',100,1000,800)).toMatchObject({signedStandardKrw:20000,positiveBenefitKrw:20000});expect(economicBenefitStandard('nonpayment',100,1000,1200)).toMatchObject({signedStandardKrw:-20000,positiveBenefitKrw:0});expect(economicBenefitStandard('false_information',100,1000,1200).signedStandardKrw).toBe(20000);expect(economicBenefitStandard('proxy',1,1,1,123).signedStandardKrw).toBe(123)})
})
