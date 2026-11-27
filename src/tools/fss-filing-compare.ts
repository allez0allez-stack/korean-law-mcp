/** Pairwise supplied-table comparison. No automatic amendment lineage or latest-version assertion. */
import {z} from 'zod'
import {MezzanineFilingReviewSchema,reviewMezzanineFiling} from './fss-cb-filing-review.js'
const doc=MezzanineFilingReviewSchema.omit({mode:true}).extend({parser_status:z.enum(['STRICT_OK','RECOVERED','UNKNOWN']).default('UNKNOWN')})
export const FilingCompareSchema=z.object({mode:z.literal('filing_compare'),before:doc,after:doc,issuer_code:z.string().regex(/^\d{8}$/)}).strict()
export function compareMezzanineFilings(p:z.infer<typeof FilingCompareSchema>){
 const {before:b,after:a}=p
 if(b.instrument!==a.instrument||b.rcept_no>=a.rcept_no)throw new RangeError('Require same instrument and increasing receipt numbers')
 const seq=(x:typeof b)=>{const cells=x.rows.flatMap(r=>r.filter(c=>(c.dart_code==='SEQ_NO'||c.unit==='SEQ_NO')&&r.some(l=>!l.dart_code&&!l.unit&&l.value.trim()==='회차')));return cells.length===1&&/^\d+$/.test(cells[0].value.trim())?cells[0].value.trim():null}
 const sb=seq(b),sa=seq(a);if(!sb||sb!==sa)throw new RangeError('Same issue sequence not established')
 const old=reviewMezzanineFiling({...b,mode:'filing_review'}),next=reviewMezzanineFiling({...a,mode:'filing_review'});
 const fields=old.fields.map(f=>{const g=next.fields.find(x=>x.code===f.code)!;const comparable=f.state==='VALUE_PRESENT'&&g.state==='VALUE_PRESENT';const bv=comparable?f.evidence[0].value:null,av=comparable?g.evidence[0].value:null;const bu=comparable?f.evidence[0].unitValue:null,au=comparable?g.evidence[0].unitValue:null;return {code:f.code,beforeState:f.state,afterState:g.state,status:comparable?(bv===av&&bu===au?'EXACT_TEXT_MATCH':'VALUE_CHANGED_REVIEW'):'NOT_COMPARABLE',before:f.evidence,after:g.evidence}})
 return {status:'SUPPLIED_PAIR_COMPARISON_ONLY',instrument:b.instrument,issuerCode:p.issuer_code,issueSequence:sb,beforeReceipt:b.rcept_no,afterReceipt:a.rcept_no,beforeSource:{file:b.source_file,sha256:b.source_sha256??null,table:b.table_index,parserStatus:b.parser_status},afterSource:{file:a.source_file,sha256:a.source_sha256??null,table:a.table_index,parserStatus:a.parser_status},originalReviewRequired:true,issuerIdentityVerified:false,lineageVerified:false,latestCorrectionVerified:false,sourceAttested:false,complianceDetermined:false,changedCount:fields.filter(f=>f.status==='VALUE_CHANGED_REVIEW').length,notComparableCount:fields.filter(f=>f.status==='NOT_COMPARABLE').length,fields}
}
