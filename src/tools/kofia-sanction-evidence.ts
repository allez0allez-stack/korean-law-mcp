/** Arithmetic extracted from user-supplied Annex 1 (2026-11-12). No committee decision. */
const integer = (n: number, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min) throw new RangeError('Invalid nonnegative safe integer')
  return BigInt(n)
}
const safe = (n: bigint) => {
  const v = Number(n)
  if (!Number.isSafeInteger(v)) throw new RangeError('Unsafe result')
  return v
}
/** Account-level daily balances for the entire confirmed lockup period, not a sample. */
export function lockupCompliance(allocated: number, committed: number, days: number, balances: number[], offerPrice: number) {
  const a = integer(allocated, 1), c = integer(committed, 1), d = integer(days, 1), p = integer(offerPrice, 1)
  if (c > a || balances.length !== days) throw new RangeError('Invalid commitment or incomplete daily balances')
  let sum = 0n, minimum = c
  for (const n of balances) { const b = integer(n); const capped = b > c ? c : b; sum += capped; if (capped < minimum) minimum = capped }
  const denominator = a*d
  return { violationShares:safe(c-minimum), violationAmountKrw:safe((c-minimum)*p), numerator:sum.toString(), denominator:denominator.toString(), compliancePercent:Number(sum)*100/Number(denominator), meets80Percent:sum*100n>=denominator*80n, committeeDecisionVerified:false }
}
/** Annex 1 II.1: independently calculate amount and share of declared issue, choose longer. */
export function bondBase(amount: number, issue: number) {
  const a=integer(amount,1), i=integer(issue,1)
  if(a>i) throw new RangeError('Violation exceeds declared issue amount')
  const amountMonths=a>40_000_000_000n?4:a>20_000_000_000n?3:2
  const ratioMonths=a*100n>i*50n?4:a*100n>i*20n?3:2
  return {amountMonths,ratioMonths,baseMonths:Math.max(amountMonths,ratioMonths),ratioPercent:Number(a)*100/Number(i),committeeDecisionVerified:false}
}
/** Annex 1 I.2 and II.2: allowable aggravation, including current case in count. */
export function aggravationLimits(kind:'ipo_nonpayment'|'ipo_payment_capacity'|'ipo_lockup'|'ipo_other'|'bond', designationCount: number, listingDayLockup: boolean) {
  integer(designationCount,1)
  if(!['ipo_nonpayment','ipo_payment_capacity','ipo_lockup','ipo_other','bond'].includes(kind) || typeof listingDayLockup!=='boolean' || (listingDayLockup && kind!=='ipo_lockup')) throw new RangeError('Invalid aggravation facts')
  return { repeatPercent:kind==='bond'?0:designationCount>=5?200:designationCount>=3?100:designationCount===2?50:0, repeatBondMonths:kind==='bond'?(designationCount>=3?2:designationCount===2?1:0):0, listingDayPercent:listingDayLockup?50:0, listingDayMinimumMonths:listingDayLockup?1:0, finalCapMonths:kind==='bond'?null:kind==='ipo_nonpayment'||kind==='ipo_payment_capacity'?36:24, committeeDecisionVerified:false }
}
/** Annex 1 I.3(4): reference close must be externally verified; negative standard is retained, not profit. */
export function economicBenefitStandard(kind:'nonpayment'|'false_information'|'manager_condition'|'proxy', allocated:number, offerPrice:number, referenceClose:number, proxyGainKrw?:number) {
  const a=integer(allocated,1), p=integer(offerPrice,1), close=integer(referenceClose)
  if(!['nonpayment','false_information','manager_condition','proxy'].includes(kind)) throw new RangeError('Unsupported economic benefit kind')
  let standard:bigint
  if(kind==='proxy') { if(proxyGainKrw===undefined || !Number.isSafeInteger(proxyGainKrw)) throw new RangeError('Verified disposal gain required'); standard=BigInt(proxyGainKrw) }
  else { if(proxyGainKrw!==undefined) throw new RangeError('Unexpected proxy gain'); standard=a*(close-p)*(kind==='nonpayment'?-1n:1n) }
  return { signedStandardKrw:safe(standard), positiveBenefitKrw:safe(standard>0n?standard:0n), referenceCloseVerified:false, committeeDecisionVerified:false }
}
