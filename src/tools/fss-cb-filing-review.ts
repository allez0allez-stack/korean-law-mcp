/** Read-only review of a caller-supplied DART main CB table, not a DART client. */
import {z} from 'zod'
const cell=z.object({value:z.string().max(24000),dart_code:z.string().max(64).nullable().optional(),unit:z.string().max(64).nullable().optional(),unit_value:z.string().max(80).nullable().optional()})
export const MezzanineFilingReviewSchema=z.object({mode:z.literal('filing_review'),version:z.literal('20260930'),instrument:z.enum(['CB','BW','EB']),rcept_no:z.string().regex(/^\d{14}$/),source_file:z.string().min(1).max(256),source_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),table_index:z.number().int().nonnegative(),rows:z.array(z.array(cell).min(1).max(40)).min(1).max(200)}).strict()
export const CbFilingReviewSchema=MezzanineFilingReviewSchema.extend({instrument:z.literal('CB')})
type Input=z.infer<typeof MezzanineFilingReviewSchema>
const normalized=(s:string)=>s.normalize('NFKC').replace(/\s/g,'')
const date=(s:string)=>{const v=s.trim().replace(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/,(_,y,m,d)=>y+m.padStart(2,'0')+d.padStart(2,'0')).replace(/[.-]/g,'');if(!/^\d{8}$/.test(v))return undefined;const d=`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6)}`;const t=Date.parse(d);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d?v:undefined}
const integer=(s:string|undefined)=>s&&/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s.trim())?BigInt(s.replace(/,/g,'')):undefined
const DEFINITIONS={DNM_SUM:'권면(전자등록)총액',ARI_LMT:'정관상잔여발행한도',PRFT_RATE:'표면이자율',LST_RTN_RT:'만기이자율',EXP_DT:'사채만기일',ISSU_MTH:'사채발행방법',EXE_RT:'전환비율',EXE_PRC:'전환가액(원/주)',EXE_FUNC:'전환가액결정방법',STK_CNT:'주식수',SB_BGN_DT:'시작일',SB_END_DT:'종료일',EXE_REG:'전환가액조정에관한사항',MIN_PRC:'최저조정가액(원)',MIN_RSN:'최저조정가액근거',CTR_LMT:'70%미만으로조정가능한잔여발행한도',OPT_FCT:'옵션에관한사항',PYM_DT:'납입일',DRC_DT:'이사회결의일',RPT_SM_YN:'증권신고서제출대상여부',RPT_SBM:'제출을면제받은경우그사유',SSL_YN:'해당여부',MOR_OFR:'담보제공에관한사항'} as const
export function reviewMezzanineFiling(p:Input){
 const term={CB:'전환',BW:'행사',EB:'교환'}[p.instrument]
 const security={CB:'전환사채',BW:'신주인수권부사채',EB:'교환사채'}[p.instrument]
 const defs:Record<string,string>={...DEFINITIONS,EXE_RT:term+'비율',EXE_PRC:term+'가액(원/주)',EXE_FUNC:term+'가액결정방법',EXE_REG:term+'가액조정에관한사항',STK_KND:'종류'}
 if(p.instrument==='BW')Object.assign(defs,{DIV_YN:'사채와인수권의분리여부',PYM_MTH:'신주대금납입방법'})
 if(p.instrument==='EB')for(const code of ['ARI_LMT','MIN_PRC','MIN_RSN','CTR_LMT','SSL_YN','MOR_OFR'])delete defs[code]

 if(p.rows.reduce((n,r)=>n+r.reduce((m,c)=>m+c.value.length,0),0)>180000)throw new RangeError('Table text exceeds review limit')
 const candidates=(code:string)=>p.rows.flatMap((r,row)=>r.flatMap((c,col)=>c.dart_code===code||c.unit===code?[{row,col,value:c.value,unitValue:c.unit_value??null,labels:r.filter(x=>!x.dart_code&&!x.unit).map(x=>x.value)}]:[]))
 const kind=candidates('PL_KND');if(kind.length!==1||!normalized(kind[0].value).includes(security)||!kind[0].labels.some(l=>normalized(l).includes('사채의종류')))throw new RangeError('Requested instrument main table identity not established')
 const fields=Object.entries(defs).map(([code,label])=>{const found=candidates(code);const matched=found.filter(c=>c.labels.some(l=>normalized(l).includes(label)));const v=matched.length===1&&found.length===1?matched[0]:undefined;return {code,label,state:found.length>1?'AMBIGUOUS':!found.length?'NOT_IN_SUPPLIED_TABLE':!v?'LABEL_MISMATCH':!v.value.trim()||/^(?:-|—|–)$/.test(v.value.trim())?'DASH_OR_EMPTY':'VALUE_PRESENT',evidence:found}})
 const value=(code:string)=>{const f=fields.find(x=>x.code===code);return f?.state==='VALUE_PRESENT'?f.evidence[0].value.trim():undefined}
 const checks:{id:string;status:string;detail:object}[]=[]
 const flag=(id:string,status:string,detail:object={})=>checks.push({id,status,detail})
 const a=integer(value('DNM_SUM')),price=integer(value('EXE_PRC')),shares=integer(value('STK_CNT')),ratio=value('EXE_RT')
 if(a!==undefined&&price!==undefined&&price>0n&&shares!==undefined&&ratio!==undefined&&/^100(?:\.0+)?$/.test(ratio))flag('share_arithmetic',a/price===shares?'ARITHMETIC_MATCH':'RECONCILE_SHARES',{calculatedFloor:(a/price).toString(),reported:shares.toString(),remainderKrw:(a%price).toString()});else flag('share_arithmetic','INSUFFICIENT_OR_UNSUPPORTED_INPUT')
 const floor=integer(value('MIN_PRC'));if(p.instrument==='EB')flag('70_percent_screen','NOT_MAPPED_FOR_EB');else if(price!==undefined&&price>0n&&floor!==undefined&&floor>0n){flag('70_percent_screen',floor*100n<price*70n?'REVIEW_SPECIAL_RESOLUTION_AND_BASIS':'NOT_BELOW_70_PERCENT_OF_REPORTED_PRICE',{basis:'Reported initial price only; corporate action adjustments and applicable law not verified',article:p.instrument==='BW'?'제5-24조제1항 및 제5-23조제2호':'제5-23조제2호'})}else flag('70_percent_screen','NO_NUMERIC_FLOOR_IN_SUPPLIED_TABLE',{note:'Dash is not proof of no market-price refixing; read full contract and adjustment text.'})
 const fieldDate=(code:string)=>{const v=date(value(code)??'');const u=fields.find(f=>f.code===code)?.evidence[0]?.unitValue;return v&&(!u||date(u)===v)?v:undefined}
 const payment=fieldDate('PYM_DT'),start=fieldDate('SB_BGN_DT'),end=fieldDate('SB_END_DT'),maturity=fieldDate('EXP_DT')
 if(p.instrument==='EB')flag('private_conversion_date','NOT_MAPPED_FOR_EB');else if(payment&&start&&value('ISSU_MTH')==='사모'&&payment.slice(4)!=='0229'){const anniversary=String(Number(payment.slice(0,4))+1)+payment.slice(4);flag('private_conversion_date',start<anniversary?'REVIEW_EARLY_START':'AT_OR_AFTER_PAYMENT_PLUS_YEAR',{payment,start,anniversary,article:p.instrument==='BW'?'제5-24조제1항 및 제5-21조제2항':'제5-21조제2항',assumption:'Payment date is used as an issuance-date proxy only; verify actual issue date and applicable law.'})}else flag('private_conversion_date','INSUFFICIENT_OR_UNSUPPORTED_INPUT')
 if(start&&end&&maturity)flag('date_order',start<=end&&end<=maturity?'DATE_ORDER_MATCH':'RECONCILE_DATES',{start,end,maturity});else flag('date_order','INSUFFICIENT_INPUT')
 const opts=value('OPT_FCT');flag('option_review',opts?'READ_OPTION_CLAUSE':'NO_OPTION_TEXT_IN_SUPPLIED_TABLE',{issuerEarlyRedemptionMention:opts?/(발행회사|발행사)의?\s*조기상환권/.test(opts):null,purchaseOptionMention:opts?/매수선택권|매도청구권/.test(opts):null,note:'Lexical indicators only. Issuer early redemption is not automatically a third-party purchase option. No inference of holder eligibility, cap or absence.'})
 if(p.instrument==='BW')flag('warrant_structure','REVIEW_WARRANT_TERMS',{separation:value('DIV_YN')??null,paymentMethod:value('PYM_MTH')??null,article:'제5-24조'})
 if(p.instrument==='EB')flag('exchange_asset','REVIEW_ASSET_OWNERSHIP_AND_AVAILABILITY',{reportedAsset:value('STK_KND')??null,note:'Existing shares, treasury vs third-party ownership not inferred; no new-share dilution conclusion.'})
 const registration=value('RPT_SM_YN');flag('registration_exemption',registration==='아니오'&&!value('RPT_SBM')?'REVIEW_MISSING_EXEMPTION_REASON':'REVIEW_REGISTRATION_AND_REASON',{registration:registration??null,article:'자본시장법 제161조제1항제9호'})
 return {status:`SUPPLIED_${p.instrument}_TABLE_REVIEW_ONLY`,instrument:p.instrument,version:p.version,formNo:{CB:'38-24',BW:'38-25',EB:'38-26'}[p.instrument],rceptNo:p.rcept_no,sourceUrl:`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${p.rcept_no}`,sourceFile:p.source_file,sourceSha256:p.source_sha256??null,tableIndex:p.table_index,indexBase:0,sourceAttested:false,latestCorrectionVerified:false,tableCompletenessVerified:false,formCurrentnessVerified:false,applicabilityVerified:false,complianceDetermined:false,fields,checks}
}

/** Backward-compatible CB-only entry point. */
export function reviewCbFiling(p:z.infer<typeof CbFilingReviewSchema>){return reviewMezzanineFiling(p)}
