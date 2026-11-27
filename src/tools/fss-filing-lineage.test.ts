import {describe,it,expect} from 'vitest'
import {FilingLineageSchema,reviewFilingLineage} from './fss-filing-lineage.js'
const name='주요사항보고서(전환사채권발행결정)',issuer='00000001'
const root={rcept_no:'20261027000338',rcept_dt:'20261027',corp_code:issuer,report_nm:name,issue_sequence:'10'}
const corr=(id:string,original:string,seq='10')=>({rcept_no:id,rcept_dt:id.slice(0,8),corp_code:issuer,report_nm:'[기재정정]'+name,issue_sequence:seq,source_file:id+'.xml',header_excerpt:`1. 정정대상 공시서류 :\n${name}\n2. 정정대상 공시서류의 최초제출일 :\n${original}\n3. 정정사항`})
// Selected original-submission dates observed in Finger's DART headers. Issuer ID is synthetic.
const other=corr('20261027000343','2026년 4월 22일','9'),match=corr('20261104000361','2026년 10월 27일')
const p=FilingLineageSchema.parse({mode:'filing_lineage',issuer_code:issuer,instrument:'CB',root_receipt:root.rcept_no,as_of:'20261127',records:[root,other,match]})
describe('filing lineage review',()=>{
 it('excludes unrelated same-day correction and selects matching date/title/issue candidate',()=>{const r=reviewFilingLineage(p);expect(r.candidates.map(x=>x.receipt)).toEqual([match.rcept_no]);expect(r.excluded[0].receipt).toBe(other.rcept_no);expect(r.latestSuppliedCandidate).toBe(match.rcept_no);expect(r.latestCorrectionVerified).toBe(false)})
 it('blocks same-day multiple roots',()=>expect(reviewFilingLineage({...p,records:[...p.records,{...root,rcept_no:'20261027000999',issue_sequence:'11'}]}).latestSuppliedCandidate).toBeNull())
 it('blocks missing header or issue sequence',()=>{for(const bad of [{...match,header_excerpt:undefined},{...match,issue_sequence:undefined},{...match,issue_sequence:'11'},{...match,header_excerpt:match.header_excerpt+'\n'+match.header_excerpt}])expect(reviewFilingLineage({...p,records:[root,bad]}).latestSuppliedCandidate).toBeNull()})
 it('rejects duplicate receipts, wrong issuer and post cutoff records',()=>{for(const records of [[root,root],[root,{...match,corp_code:'00000002'}],[root,corr('20261201000001','2026년 10월 27일')]])expect(()=>reviewFilingLineage({...p,records})).toThrow()})
 it('does not treat unverified corrected title or root as original',()=>{expect(()=>reviewFilingLineage({...p,root_receipt:match.rcept_no})).toThrow();expect(reviewFilingLineage({...p,records:[root,{...match,header_excerpt:match.header_excerpt.replace(name,'주요사항보고서(교환사채권발행결정)')}]}).latestSuppliedCandidate).toBeNull()})
})
