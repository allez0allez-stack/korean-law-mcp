/** Annex 1 I.1 note, III.2–3. Selection and reconciliation only; no committee adjudication. */
export interface ReviewCase { case_id:string; security_id:string; event_date:string; restriction_months:number }
const isDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s
const nat=(n:number)=>Number.isSafeInteger(n)&&n>=0
export function groupSanctionReview(cases:ReviewCase[], alreadyDecided?:{months:number;decision_date:string;case_ids:string[];recomputed_total_months:number}) {
 if(!Array.isArray(cases)||cases.length<1||cases.length>1000)throw new RangeError('Require 1–1000 cases for the same verified person')
 const ids=new Set<string>(), bySecurity=new Map<string,ReviewCase[]>()
 for(const c of cases){if(!c.case_id.trim()||!c.security_id.trim()||ids.has(c.case_id)||!isDate(c.event_date)||!Number.isFinite(c.restriction_months)||c.restriction_months<0||c.restriction_months>48)throw new RangeError('Invalid/duplicate case, date or duration');ids.add(c.case_id);const a=bySecurity.get(c.security_id)??[];a.push(c);bySecurity.set(c.security_id,a)}
 const securities=[...bySecurity].map(([security_id,cs])=>{const max=Math.max(...cs.map(c=>c.restriction_months));return {security_id,longestMonths:max,leadingCaseIds:cs.filter(c=>c.restriction_months===max).map(c=>c.case_id)}})
 const longest=Math.max(...securities.map(s=>s.longestMonths)),latest=cases.map(c=>c.event_date).sort().at(-1)!
 let reconciliation=null
 if(alreadyDecided){const d=alreadyDecided;if(!nat(d.months)||!nat(d.recomputed_total_months)||!isDate(d.decision_date)||!d.case_ids.length||new Set(d.case_ids).size!==d.case_ids.length||d.case_ids.length>=cases.length||d.case_ids.some(id=>!ids.has(id))||cases.some(c=>c.event_date>=d.decision_date))throw new RangeError('Require distinct prior subset and all events strictly before prior decision; whole-month periods only')
 const delta=d.recomputed_total_months-d.months;reconciliation={priorMonths:d.months,recomputedTotalMonths:d.recomputed_total_months,additionalMonths:delta>=0?delta:null,status:delta<0?'PRIOR_DECISION_EXCEEDS_RECOMPUTED_REVIEW_REQUIRED':'ARITHMETIC_DELTA_ONLY',recomputedTotalVerified:false}}
 return {status:'GROUP_SELECTION_ONLY',locator:'별표 1 I.1 비고, III.2~3',securityCount:securities.length,caseCount:cases.length,securities,longestMonths:longest,leadingSecurityIds:securities.filter(s=>s.longestMonths===longest).map(s=>s.security_id),latestEventDate:latest,reconciliation,priorHistoryVerified:false,committeeDecisionVerified:false,finalSanctionDetermined:false}
}
/** Annex 1 I.1 note **: cumulative redemption / (cumulative subscription - other withdrawals). */
export function ventureRedemptionBase(redemption:number,subscription:number,otherWithdrawals:number){
 if(![redemption,subscription,otherWithdrawals].every(nat)||redemption===0||subscription<=otherWithdrawals)throw new RangeError('Positive redemption and denominator with safe integer KRW required')
 const d=BigInt(subscription)-BigInt(otherWithdrawals),n=BigInt(redemption);if(n>d)throw new RangeError('Redemption exceeds denominator; reconcile cash ledger')
 const m=12n*n;return {status:'REDEMPTION_BASE_ONLY',locator:'별표 1 I.1 및 비고 **',ratioNumerator:n.toString(),ratioDenominator:d.toString(),monthsNumerator:m.toString(),monthsDenominator:d.toString(),months:Number(m)/Number(d),wholeMonthFloor:Number(m/d),wholeMonthCeil:Number((m+d-1n)/d),roundingVerified:m%d===0n,legalEffectVerified:false,finalSanctionDetermined:false}
}
