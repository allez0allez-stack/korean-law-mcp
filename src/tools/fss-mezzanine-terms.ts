/** Arithmetic screens only, based on FSC regulation effective 20261113 (articles 5-21–5-24).
 * Inputs are caller assertions; no historical applicability, market-data or ownership attestation. */
import {z} from 'zod'
const nat=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const pos=nat.min(1)
// Exact decimal KRW inputs, including VWAP, with up to 8 decimal places.
const decimal=z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,8})?$/)
const priceInputs={month_vwap:decimal,week_vwap:decimal,recent_vwap:decimal}
const scenario=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('holder_call'),outstanding_at_issue:pos,holder_owned_at_issue:nat,total_underlying_shares:pos,holder_acquisition_shares:nat,holder_role:z.enum(['maximum_shareholder','related_party','other','unknown']),right_type:z.enum(['purchase_option','issuer_redemption','unknown'])}).strict(),
 z.object({kind:z.literal('initial_price'),...priceInputs,third_trading_day_vwap:decimal.optional(),offering:z.enum(['public_165_6_1_3','third_party_under_month','third_party_at_least_month','other_nonpublic']),reported_price:pos}).strict(),
 z.object({kind:z.literal('market_refixing'),...priceInputs,adjusted_original_price:pos,previous_price:pos,reported_price:pos,direction:z.enum(['down','up']),special_resolution_floor:pos.optional(),offering:z.enum(['public_165_6_1_3','other_nonpublic'])}).strict(),
 z.object({kind:z.literal('corporate_action'),previous_price:pos,adjustment_numerator:pos,adjustment_denominator:pos,reported_price:pos,action:z.enum(['value_increase','value_decrease'])}).strict(),
])
export const MezzanineTermsSchema=z.object({mode:z.literal('term_review'),instrument:z.enum(['CB','BW','EB']),scenario}).strict()
const SCALE=100000000n
const scaled=(s:string)=>{const [a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(8,'0'))}
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b
const max=(a:bigint,b:bigint)=>a>b?a:b
const min=(a:bigint,b:bigint)=>a<b?a:b
const reviewPrice=(x:{month_vwap:string;week_vwap:string;recent_vwap:string},lower:boolean)=>{
 const m=scaled(x.month_vwap),w=scaled(x.week_vwap),r=scaled(x.recent_vwap)
 if(m===0n||w===0n||r===0n)throw new RangeError('Positive market prices required')
 return (lower?min:max)(m+w+r,3n*r) // denominator 3*SCALE, no intermediate rounding
}
export function reviewMezzanineTerms(p:z.infer<typeof MezzanineTermsSchema>){
 const s=p.scenario,base={instrument:p.instrument,kind:s.kind,regulationReferenceVersion:'20261113',sourceUrl:'https://www.law.go.kr/admRulInfoP.do?admRulSeq=2100000287734',sourceAttested:false,marketDataVerified:false,ownershipVerified:false,applicabilityVerified:false,complianceDetermined:false}
 const out=(status:string,detail:object)=>({...base,status,...detail})
 if(p.instrument==='EB')return out('NOT_MAPPED_FOR_EB',{reason:'Separate EB legal basis required.'})
 const incorporation=p.instrument==='BW'?'제5-24조제1항 및 ':''
 if(s.kind==='holder_call'){
  if(s.holder_owned_at_issue>s.outstanding_at_issue||s.holder_acquisition_shares>s.total_underlying_shares)throw new RangeError('Inconsistent share counts')
  if(s.right_type!=='purchase_option'||!['maximum_shareholder','related_party'].includes(s.holder_role))return out('SCOPE_NOT_ESTABLISHED',{article:incorporation+'제5-21조제3항',reason:'Only individually identified maximum shareholder or related party purchase option; issuer redemption is different.'})
  const owned=BigInt(s.holder_owned_at_issue),total=BigInt(s.outstanding_at_issue),under=BigInt(s.total_underlying_shares),acq=BigInt(s.holder_acquisition_shares)
  const cap=under*owned/total
  return out(acq*total>under*owned?'REVIEW_ABOVE_PROPORTIONAL_SCREEN':'WITHIN_PROPORTIONAL_SCREEN',{article:incorporation+'제5-21조제3항',individualShareCapFloor:cap.toString(),reportedAcquisitionShares:acq.toString(),ownershipFraction:{numerator:owned.toString(),denominator:total.toString()},acquisitionFraction:{numerator:acq.toString(),denominator:under.toString()},basis:'Scenario compares individual acquisition share of issue to issue-date beneficial ownership. Verify denominator, allocation, aggregated exercise and actual rights; no legal cap determination.'})
 }
 if(s.kind==='initial_price'){
  const lower=s.offering==='public_165_6_1_3',den=3n*SCALE
  let n=reviewPrice(s,lower)
  if(s.offering!=='third_party_under_month'){
   if(s.third_trading_day_vwap===undefined)return out('INSUFFICIENT_INPUT',{reason:'Applicable third-trading-day VWAP required.'})
   const t=scaled(s.third_trading_day_vwap);if(t===0n)throw new RangeError('Positive third-trading-day VWAP required')
   n=(lower?min:max)(n,3n*t)
  }else if(s.third_trading_day_vwap!==undefined)throw new RangeError('Excluded third-trading-day input supplied')
  return out(BigInt(s.reported_price)*den<n?'REVIEW_BELOW_STANDARD_PRICE':'AT_OR_ABOVE_STANDARD_PRICE',{article:incorporation+'제5-22조제1항',referenceNumerator:n.toString(),referenceDenominator:den.toString(),minimumWholeKrw:ceil(n,den).toString(),reportedPrice:s.reported_price,thirdTradingDayBasis:s.offering==='third_party_under_month'?'excluded':s.offering==='third_party_at_least_month'?'actual_payment':'subscription_or_payment',note:'Standard paragraph 1 only. No automatic discount, restructuring exception, market-unpriced shares or historical applicability.'})
 }
 if(s.kind==='market_refixing'){
  if(s.direction==='up'&&s.offering==='public_165_6_1_3')return out('PUBLIC_OFFERING_UPWARD_RULE_NOT_MAPPED',{article:incorporation+'제5-23조제1호나목'})
  const den=30n*SCALE,original=BigInt(s.adjusted_original_price),prev=BigInt(s.previous_price),reported=BigInt(s.reported_price)
  if(s.special_resolution_floor!==undefined&&BigInt(s.special_resolution_floor)>original)throw new RangeError('Special floor exceeds adjusted original price')
  const statutory=s.special_resolution_floor===undefined?original*21n*SCALE:BigInt(s.special_resolution_floor)*den
  const market=reviewPrice(s,s.offering==='public_165_6_1_3')*10n
  const floor=max(statutory,market),upper=original*den
  const status=s.direction==='up'&&floor>upper?'REVIEW_MARKET_FLOOR_ABOVE_CEILING':s.direction==='down'&&reported>prev||s.direction==='up'&&reported<prev?'REVIEW_DIRECTION_MISMATCH':reported*den<floor?'REVIEW_BELOW_FLOOR':s.direction==='up'&&reported>original?'REVIEW_ABOVE_ORIGINAL_CEILING':'WITHIN_ARITHMETIC_SCREEN'
  return out(status,{article:incorporation+'제5-23조제2호 및 제3호',minimumWholeKrw:ceil(floor,den).toString(),upperWholeKrw:s.direction==='up'?original.toString():null,marketReferenceNumerator:market.toString(),referenceDenominator:den.toString(),specialResolutionAssumed:s.special_resolution_floor!==undefined,note:'Adjusted initial price, adjustment date market observations and special resolution validity are supplied assumptions; verify prior actions and contract.'})
 }
 const n=BigInt(s.adjustment_numerator),d=BigInt(s.adjustment_denominator),v=BigInt(s.previous_price)*n
 if(s.action==='value_increase'&&n<d||s.action==='value_decrease'&&n>d)throw new RangeError('Ratio direction conflicts with corporate action')
 return out(BigInt(s.reported_price)*d<v?'REVIEW_BELOW_PROPORTIONAL_REFERENCE':'AT_OR_ABOVE_PROPORTIONAL_REFERENCE',{article:incorporation+(s.action==='value_increase'?'제5-23조의2':'제5-23조제4호'),referenceNumerator:v.toString(),referenceDenominator:d.toString(),minimumWholeKrw:ceil(v,d).toString(),note:'Arithmetic only. Verify legal ratio and exceptions including par value, special resolution, restructuring and contract.'})
}
