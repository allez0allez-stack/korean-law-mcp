/** KRX supplied-row screen; no calendar, licensing, corporate-action or source attestation. */
import {z} from 'zod'
const day=z.string().regex(/^\d{8}$/)
const uint=z.string().regex(/^(0|[1-9]\d{0,24})$/)
const row=z.object({date:day,symbol:z.string().regex(/^\d{6}$/),market:z.enum(['KOSPI','KOSDAQ']),volume:uint,trading_value:uint}).passthrough()
export const MarketReviewSchema=z.object({mode:z.literal('market_review'),instrument:z.enum(['CB','BW','EB']),symbol:z.string().regex(/^\d{6}$/),market:z.enum(['KOSPI','KOSDAQ']),board_date:day,month_start:day,week_start:day,expected_sessions:z.array(day).min(1).max(46),rows:z.array(row).max(46),reported_price:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),offering:z.enum(['third_party_under_month','other_nonpublic','public_165_6_1_3','third_party_at_least_month']),third_session:day.optional(),third_row:row.optional()}).strict()
const iso=(s:string)=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`
const valid=(s:string)=>Number.isFinite(Date.parse(iso(s)))&&new Date(iso(s)).toISOString().slice(0,10)===iso(s)
const sum=(rows:{volume:string;trading_value:string}[])=>({n:rows.reduce((s,r)=>s+BigInt(r.trading_value),0n),d:rows.reduce((s,r)=>s+BigInt(r.volume),0n)})
const fmt=(x:{n:bigint;d:bigint})=>({numerator:x.n.toString(),denominator:x.d.toString(),decimalFloor8:((x.n*100000000n/x.d)/100000000n).toString()+'.'+(x.n*100000000n/x.d%100000000n).toString().padStart(8,'0')})
export function reviewMarket(p:z.infer<typeof MarketReviewSchema>){
 const base={instrument:p.instrument,symbol:p.symbol,market:p.market,boardDate:p.board_date,sourceAttested:false,calendarVerified:false,corporateActionsVerified:false,applicabilityVerified:false,complianceDetermined:false,article:'제5-22조제1항 (BW: 제5-24조제1항 준용)'}
 if(p.instrument==='EB')return {...base,status:'NOT_MAPPED_FOR_EB'}
 const dates=p.expected_sessions;const map=new Map(p.rows.map(r=>[r.date,r]));
 if(![p.board_date,p.month_start,p.week_start,...dates,...p.rows.map(r=>r.date),...(p.third_session?[p.third_session]:[])].every(valid)||p.month_start>=p.week_start||p.week_start>=p.board_date||dates.some(d=>d<p.month_start||d>=p.board_date)||new Set(dates).size!==dates.length||map.size!==p.rows.length||p.rows.some(r=>r.symbol!==p.symbol||r.market!==p.market||!dates.includes(r.date)||((BigInt(r.volume)===0n)!==(BigInt(r.trading_value)===0n))))throw new RangeError('Invalid or inconsistent session manifest/market rows')
 const missing=dates.filter(d=>!map.has(d));if(missing.length)return {...base,status:'INCOMPLETE_SESSION_COVERAGE',missing}
 const ordered=[...p.rows].sort((a,b)=>a.date.localeCompare(b.date));const recent=ordered.at(-1)!;const month=sum(ordered),week=sum(ordered.filter(r=>r.date>=p.week_start)),last=sum([recent]);
 if([month,week,last].some(r=>r.d===0n))return {...base,status:'NO_POSITIVE_VOLUME_IN_REQUIRED_WINDOW'}
 const avg={n:month.n*week.d*last.d+week.n*month.d*last.d+last.n*month.d*week.d,d:3n*month.d*week.d*last.d};const values=[avg,last];let third=null;
 if(p.offering==='third_party_under_month'){if(p.third_row||p.third_session)throw new RangeError('Third-day input excluded for selected offering')}else{const r=p.third_row;if(!r||!p.third_session)return {...base,status:'THIRD_SESSION_REQUIRED'};if(r.date!==p.third_session||r.symbol!==p.symbol||r.market!==p.market||BigInt(r.volume)===0n||BigInt(r.trading_value)===0n)throw new RangeError('Third session row inconsistent');third=sum([r]);values.push(third)}
 const lower=p.offering==='public_165_6_1_3';const ref=values.reduce((a,b)=>(lower?a.n*b.d<=b.n*a.d:a.n*b.d>=b.n*a.d)?a:b);const reported=BigInt(p.reported_price);
 return {...base,status:reported*ref.d<ref.n?'REVIEW_BELOW_STANDARD_PRICE':'AT_OR_ABOVE_STANDARD_PRICE',sessionCount:ordered.length,recentSession:recent.date,month:fmt(month),week:fmt(week),recent:fmt(last),third:third?fmt(third):null,average:fmt(avg),reference:fmt(ref),minimumWholeKrw:((ref.n+ref.d-1n)/ref.d).toString(),reportedPrice:p.reported_price,note:'Caller-supplied calendar windows and session manifest, unadjusted KRX data. Verify holiday calendar, legal date basis, actual payment date, corporate actions, source rights and exceptions independently.'}
}
