import {describe,it,expect} from 'vitest'
import {MezzanineTermsSchema,reviewMezzanineTerms} from './fss-mezzanine-terms.js'
import {fssDisclosureForm} from './fss-disclosure-form.js'
import type {LawApiClient} from '../lib/api-client.js'
const run=(scenario:object,instrument='CB')=>reviewMezzanineTerms(MezzanineTermsSchema.parse({mode:'term_review',instrument,scenario}))
const call={kind:'holder_call',outstanding_at_issue:1000,holder_owned_at_issue:231,total_underlying_shares:101,holder_acquisition_shares:23,holder_role:'related_party',right_type:'purchase_option'}
const pricing={kind:'initial_price',month_vwap:'1000.1',week_vwap:'1100.2',recent_vwap:'1000.3',offering:'third_party_under_month',reported_price:1034}
const refix={kind:'market_refixing',month_vwap:'600',week_vwap:'650',recent_vwap:'650',adjusted_original_price:1000,previous_price:900,reported_price:700,direction:'down',offering:'other_nonpublic'}
describe('mezzanine term arithmetic',()=>{
 it('individual proportion with exact integer floor',()=>expect(run(call)).toMatchObject({status:'WITHIN_PROPORTIONAL_SCREEN',individualShareCapFloor:'23',ownershipVerified:false}))
 it('flags next share above fractional cap',()=>expect(run({...call,holder_acquisition_shares:24},'BW')).toMatchObject({status:'REVIEW_ABOVE_PROPORTIONAL_SCREEN',article:'제5-24조제1항 및 제5-21조제3항'}))
 it.each(['issuer_redemption','unknown'])('does not equate %s with purchase option',right_type=>expect(run({...call,right_type}).status).toBe('SCOPE_NOT_ESTABLISHED'))
 it('rejects impossible holding counts',()=>expect(()=>run({...call,holder_owned_at_issue:1001})).toThrow(RangeError))
 it('uses rational arithmetic without premature rounding',()=>expect(run(pricing)).toMatchObject({status:'AT_OR_ABOVE_STANDARD_PRICE',minimumWholeKrw:'1034'}))
 it('flags one KRW below fractional reference',()=>expect(run({...pricing,reported_price:1033}).status).toBe('REVIEW_BELOW_STANDARD_PRICE'))
 it('requires applicable third-day price',()=>expect(run({...pricing,offering:'third_party_at_least_month'}).status).toBe('INSUFFICIENT_INPUT'))
 it('uses actual payment third-day reference',()=>expect(run({...pricing,offering:'third_party_at_least_month',third_trading_day_vwap:'1200.1'})).toMatchObject({minimumWholeKrw:'1201',thirdTradingDayBasis:'actual_payment'}))
 it('selects lowest for explicitly scoped public offering',()=>expect(run({...pricing,offering:'public_165_6_1_3',third_trading_day_vwap:'999.5'})).toMatchObject({minimumWholeKrw:'1000'}))
 it('rejects excluded extra third-day price',()=>expect(()=>run({...pricing,third_trading_day_vwap:'1000'})).toThrow())
 it('70 percent boundary and no automatic exception',()=>{expect(run(refix)).toMatchObject({minimumWholeKrw:'700',status:'WITHIN_ARITHMETIC_SCREEN'});expect(run({...refix,reported_price:699}).status).toBe('REVIEW_BELOW_FLOOR')})
 it('market reference can dominate special resolution floor',()=>expect(run({...refix,special_resolution_floor:500,reported_price:650})).toMatchObject({minimumWholeKrw:'650',specialResolutionAssumed:true}))
 it('upward ceiling and conflicting market floor',()=>{expect(run({...refix,direction:'up',reported_price:1001}).status).toBe('REVIEW_ABOVE_ORIGINAL_CEILING');expect(run({...refix,direction:'up',recent_vwap:'1100',reported_price:1000}).status).toBe('REVIEW_MARKET_FLOOR_ABOVE_CEILING')})
 it('does not apply upward market rule to public offering',()=>expect(run({...refix,direction:'up',offering:'public_165_6_1_3'}).status).toBe('PUBLIC_OFFERING_UPWARD_RULE_NOT_MAPPED'))
 it('exact corporate action ratio reference and direction',()=>{const c={kind:'corporate_action',previous_price:3911,adjustment_numerator:3,adjustment_denominator:2,reported_price:5867,action:'value_increase'};expect(run(c)).toMatchObject({minimumWholeKrw:'5867',status:'AT_OR_ABOVE_PROPORTIONAL_REFERENCE'});expect(run({...c,reported_price:5866}).status).toBe('REVIEW_BELOW_PROPORTIONAL_REFERENCE');expect(()=>run({...c,action:'value_decrease'})).toThrow()})
 it.each([call,pricing,refix])('does not import CB rules into EB',s=>expect(run(s,'EB').status).toBe('NOT_MAPPED_FOR_EB'))
 it('wrapper returns scenario with no signoff',async()=>{const r=await fssDisclosureForm({} as LawApiClient,{mode:'term_review',instrument:'CB',scenario:MezzanineTermsSchema.parse({mode:'term_review',instrument:'CB',scenario:call}).scenario});expect(JSON.parse(r.content[0].text)).toMatchObject({complianceDetermined:false,applicabilityVerified:false})})
})
