/** Review candidate only. Formula corroborated by Sep/Oct 2026 issuer prospectus quotations of Annex 1 I.3(4).
 * 2026-11-12 HWP must be re-opened before promoting. Reference date and transaction chronology require external evidence.
 * Scope: original allocation sales plus remedial purchases still held; no resales, fees or corporate actions.
 * All P&L numerators share the returned denominator, preserving three-session fractional prices exactly.
 */
export interface LockupBenefitInput {
 allocatedShares:number; offerPriceKrw:number;
 sales:{shares:number;priceKrw:number}[];
 remedialPurchases:{shares:number;priceKrw:number}[];
 reference:{mode:'end_close'|'three_session_average';closesKrw:number[]};
}
export function lockupBenefitScenario(input:LockupBenefitInput) {
  const {allocatedShares,offerPriceKrw,sales,remedialPurchases,reference}=input;
  const integer=(n:number,min=0)=>{if(!Number.isSafeInteger(n)||n<min)throw new RangeError("Invalid share count or KRW price");return BigInt(n)};
  const a=integer(allocatedShares,1), p=integer(offerPriceKrw,1);
  if(!Array.isArray(sales)||!Array.isArray(remedialPurchases)||sales.length===0||sales.length>10000||remedialPurchases.length>10000)throw new RangeError("Require bounded sale and purchase lots");
  if(!reference||!["end_close","three_session_average"].includes(reference.mode)||!Array.isArray(reference.closesKrw)||reference.closesKrw.length!==(reference.mode==="end_close"?1:3))throw new RangeError("Invalid reference close evidence");
  const d=BigInt(reference.closesKrw.length), closeSum=reference.closesKrw.reduce((s,n)=>s+integer(n,1),0n);
  let sold=0n,bought=0n,realized=0n,purchaseCost=0n;
  for(const lot of sales){const q=integer(lot.shares,1),price=integer(lot.priceKrw,1);sold+=q;realized+=q*(price-p)}
  for(const lot of remedialPurchases){const q=integer(lot.shares,1),price=integer(lot.priceKrw,1);bought+=q;purchaseCost+=q*price}
  if(sold>a||bought>sold)throw new RangeError("Unsupported lot reconciliation: sold > allocated or repurchased > sold");
  const retained=(a-sold)*(closeSum-p*d), repurchase=bought*closeSum-purchaseCost*d, baseline=a*(closeSum-p*d);
  const actual=realized*d+retained+repurchase, benefit=actual-baseline, positive=benefit>0n?benefit:0n;
  return {status:"SECONDARY_SOURCE_SCENARIO_ONLY",annexVersionVerified:false,referenceDatesVerified:false,tradeChronologyVerified:false,committeeDecisionVerified:false,legalEffectVerified:false,referencePriceNumerator:closeSum.toString(),denominator:d.toString(),allocatedShares:a.toString(),soldShares:sold.toString(),retainedOriginalShares:(a-sold).toString(),remedialShares:bought.toString(),realizedProfitNumerator:(realized*d).toString(),retainedProfitNumerator:retained.toString(),remedialProfitNumerator:repurchase.toString(),baselineProfitNumerator:baseline.toString(),actualProfitNumerator:actual.toString(),signedBenefitNumerator:benefit.toString(),positiveBenefitFloorKrw:(positive/d).toString(),positiveBenefitCeilKrw:((positive+d-1n)/d).toString()};
}
