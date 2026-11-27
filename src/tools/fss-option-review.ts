/** Evidence-bounded extraction from selected option clauses or correction-table cells. */
import {z} from 'zod'
import {normalizeDate} from './applicable-law.js'
const receipt=z.string().regex(/^\d{14}$/).refine(x=>normalizeDate(x.slice(0,8))===x.slice(0,8))
const source=z.object({rcept_no:receipt,source_file:z.string().trim().min(1).max(256),source_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),table_index:z.number().int().nonnegative(),row_index:z.number().int().nonnegative(),column:z.enum(['clause','before','after']),text:z.string().min(1).max(16000),scope:z.enum(['option_text','purchase_allocation'])}).strict()
export const OptionReviewSchema=z.object({mode:z.literal('option_review'),instrument:z.enum(['CB','BW','EB']),issuer_code:z.string().regex(/^\d{8}$/),issue_sequence:z.string().regex(/^\d{1,12}$/),source,before:source.optional()}).strict()
type Input=z.infer<typeof OptionReviewSchema>
type Source=z.infer<typeof source>
const rules=[['PUT_DENIAL',/사채권자는[^.!?\n]{0,120}(?:조기상환|중도상환)[^.!?\n]{0,40}(?:할 수 없다|요구할 수 없다)/g],['FINANCING_REPAYMENT_CONDITION',/인수금융의\s*원리금이\s*전액\s*상환되기\s*전에는\s*행사할\s*수\s*없다?[^.!?\n]*/g],['EXTENSION_WORDING',/그\s*기간만큼\s*매도청구기간이\s*연장된다/g],['NOTICE_DAYS',/\d{1,3}\s*(?:영업일|일)\s*전(?:까지|에)/g],['INTERVAL_MONTHS',/매\s*\d{1,3}\s*개월/g]] as const
function hits(text:string,re:RegExp,base=0){return [...text.matchAll(re)].map(m=>({text:m[0],start:base+m.index!,end:base+m.index!+m[0].length}))}
function extract(s:Source){
 const text=s.text
 const headings=[...text.matchAll(/\[([^\]\n]{1,100})\]/g)].filter(m=>/조기상환|중도상환|매도청구권|매수선택권|Put Option|Call Option/i.test(m[1]))
 const sections=headings.map((m,i)=>{const start=m.index!,end=headings[i+1]?.index??text.length;const h=m[1];const type=/매도청구권|매수선택권/.test(h)?'PURCHASE_OPTION':/사채권자.*조기상환|Put Option/i.test(h)?'HOLDER_PUT':/발행회사.*(?:조기상환|중도상환)/.test(h)?'ISSUER_REDEMPTION':'UNCLASSIFIED';return {type,heading:h,start,end,text:text.slice(start,end)}})
 const evidence=rules.flatMap(([kind,re])=>hits(text,re).map(x=>({kind,...x})))
 const dates=hits(text,/\d{4}\s*(?:년|[.\/-])\s*\d{1,2}\s*(?:월|[.\/-])\s*\d{1,2}\s*일?/g).map(x=>({...x,date:normalizeDate(x.text)}))
 // Only a specifically supplied allocation cell can produce actor/percentage candidates.
 // Limit to the initial allocation list, never financing or unrelated percentage prose.
 const list=s.scope==='purchase_allocation'?text.split(/-\s*단\s*[,，]/,1)[0]:''
 const m=[...list.matchAll(/(?:^\s*-?\s*|,\s*)([가-힣A-Za-z0-9㈜() .]{1,60}?)\s+(\d{1,3}(?:\.\d{1,4})?)\s*%/g)]
 const allocations=m.map(x=>{const value=x[2],parts=value.split('.'),units=Number(parts[0])*10000+Number((parts[1]??'').padEnd(4,'0'));return {actor:x[1].trim(),percent:value,units,evidence:{text:x[0],start:x.index!,end:x.index!+x[0].length}}})
 const allocationValid=allocations.length>0&&new Set(allocations.map(x=>x.actor)).size===allocations.length&&allocations.every(x=>x.units<=1000000)&&allocations.reduce((a,x)=>a+x.units,0)<=1000000&&list.replace(/(?:^\s*-?\s*|,\s*)([가-힣A-Za-z0-9㈜() .]{1,60}?)\s+(\d{1,3}(?:\.\d{1,4})?)\s*%/g,'').trim()===''
 return {source:{rcept_no:s.rcept_no,file:s.source_file,sha256:s.source_sha256??null,table:s.table_index,row:s.row_index,column:s.column,scope:s.scope},sections,dates,evidence,allocations,allocationListParsed:allocationValid,allocationTotalPercent:allocationValid?allocations.reduce((a,x)=>a+x.units,0)/10000:null,unclassifiedText:sections.length===0,fullText:text}
}
export function reviewOptions(p:Input){
 const after=extract(p.source),before=p.before?extract(p.before):null
 if(p.before&&(p.before.scope!==p.source.scope||p.before.column!=='before'||p.source.column!=='after'||p.before.rcept_no!==p.source.rcept_no||p.before.source_file!==p.source.source_file||p.before.source_sha256!==p.source.source_sha256||p.before.table_index!==p.source.table_index||p.before.row_index!==p.source.row_index))throw new RangeError('Comparison requires before/after cells in same supplied correction row')
 const comparable=before?.allocationListParsed&&after.allocationListParsed
 const actors=comparable?[...new Set([...before.allocations,...after.allocations].map(a=>a.actor))].map(actor=>{const b=before.allocations.find(a=>a.actor===actor),a=after.allocations.find(a=>a.actor===actor);return {actor,beforePercent:b?.percent??null,afterPercent:a?.percent??null,deltaPercentagePoints:b&&a?(a.units-b.units)/10000:null,status:b&&a?(a.units===b.units?'MATCH':'CHANGED'):'NOT_COMPARABLE'}}):[]
 const signals=before?rules.map(([kind])=>{const b=before.evidence.filter(x=>x.kind===kind),a=after.evidence.filter(x=>x.kind===kind);return {kind,before:b,after:a,status:b.length&&a.length?(b.map(x=>x.text).join('\n')===a.map(x=>x.text).join('\n')?'EXACT_TEXT_MATCH':'WORDING_CHANGED_REVIEW'):b.length?'NOT_FOUND_IN_AFTER_CELL':a.length?'NOT_FOUND_IN_BEFORE_CELL':'NOT_OBSERVED'}}):[]
 return {status:'SUPPLIED_OPTION_EVIDENCE_ONLY',issuerCode:p.issuer_code,issueSequence:p.issue_sequence,instrument:p.instrument,after,before,comparison:before?{allocationComparable:!!comparable,actors,signals}:null,sourceAttested:false,issuerIdentityVerified:false,completeContractVerified:false,optionExistenceDetermined:false,complianceDetermined:false,note:'선택된 원문 셀의 문언 후보만 비교. 미발견은 권리 부존재 또는 법적 소멸을 뜻하지 않음. 날짜의 법적 의미·행사자 지분·분모·정정계보·계약 전문 별도 확인.'}
}
