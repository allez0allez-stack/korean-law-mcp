import {describe,it,expect} from 'vitest'
import {CbFilingReviewSchema,reviewCbFiling} from './fss-cb-filing-review.js'
import {fssDisclosureForm} from './fss-disclosure-form.js'
import type {LawApiClient} from '../lib/api-client.js'
import '../tool-registry.js'
import {executeTool} from './meta-tools.js'
// Selected cells transcribed from live DART MCP table 2, rcept_no=20261116002211.
// Not a complete original table; test reindexes the selected rows and truncates narrative cells.
const row=(label:string,code:string,value:string)=>[{value:label},{dart_code:code,value}]
const fixture={mode:'filing_review' as const,version:'20260930' as const,instrument:'CB' as const,rcept_no:'20261116002211',source_file:'SOURCE_001_20261116002211.xml',source_sha256:'8e35c1cb6157ae8ce5f262e00b08f72952498f401e0521cb726554fed8b8878c',table_index:2,rows:[row('1. 사채의 종류','PL_KND','무기명식 이권부 무보증 사모 전환사채'),row('2. 사채의 권면(전자등록)총액 (원)','DNM_SUM','2,430,526,149'),row('2-1. 정관상 잔여 발행한도 (원)','ARI_LMT','44,200,000,000'),row('표면이자율 (%)','PRFT_RATE','0.0'),row('만기이자율 (%)','LST_RTN_RT','0.0'),row('5. 사채만기일','EXP_DT','2056.11.24'),row('8. 사채발행방법','ISSU_MTH','사모'),row('전환비율 (%)','EXE_RT','100'),row('전환가액 (원/주)','EXE_PRC','3,911'),row('주식수','STK_CNT','621,459'),row('시작일','SB_BGN_DT','2027.11.24'),row('종료일','SB_END_DT','2056.10.24'),row('최저 조정가액 (원)','MIN_PRC','-'),row('9-1. 옵션에 관한 사항','OPT_FCT','(1) 사채권자는 본 사채의 조기상환을 청구할 수 없다. (2) 발행회사의 조기상환권(Call Option)'),row('12. 납입일','PYM_DT','2026.11.24'),row('17. 이사회결의일(결정일)','DRC_DT','2026.11.16'),row('18. 증권신고서 제출대상 여부','RPT_SM_YN','아니오'),row('19. 제출을 면제받은 경우 그 사유','RPT_SBM','사모발행(사채발행일로부터 1년간 전환 및 권면 분할·병합 금지)')]}
const run=(rows=fixture.rows)=>reviewCbFiling(CbFilingReviewSchema.parse({...fixture,rows}))
const status=(id:string,rows=fixture.rows)=>run(rows).checks.find(x=>x.id===id)?.status
const change=(code:string,v:string)=>fixture.rows.map(r=>r[1].dart_code===code?row(r[0].value,code,v):r)
describe('CB supplied table evidence checks',()=>{
 it('reconciles actual selected DART 2nd CB cells',()=>{const d=run();expect(d.checks.find(x=>x.id==='share_arithmetic')).toMatchObject({status:'ARITHMETIC_MATCH',detail:{calculatedFloor:'621459',reported:'621459',remainderKrw:'0'}});expect(d).toMatchObject({sourceAttested:false,tableCompletenessVerified:false,latestCorrectionVerified:false,complianceDetermined:false})})
 it('preserves zero interest and dash separately',()=>{expect(run().fields.find(x=>x.code==='PRFT_RATE')?.state).toBe('VALUE_PRESENT');expect(run().fields.find(x=>x.code==='MIN_PRC')?.state).toBe('DASH_OR_EMPTY')})
 it('never treats missing as a legal violation',()=>expect(run().fields.find(x=>x.code==='MIN_RSN')?.state).toBe('NOT_IN_SUPPLIED_TABLE'))
 it('rejects duplicate tags for arithmetic',()=>{const r=[...fixture.rows,row('전환가액 (원/주)','EXE_PRC','9999')];expect(run(r).fields.find(x=>x.code==='EXE_PRC')?.state).toBe('AMBIGUOUS');expect(status('share_arithmetic',r)).toBe('INSUFFICIENT_OR_UNSUPPORTED_INPUT')})
 it('flags a mislabeled tag',()=>expect(run(fixture.rows.map(r=>r[1].dart_code==='EXE_PRC'?row('다른 가격','EXE_PRC','3911'):r)).fields.find(x=>x.code==='EXE_PRC')?.state).toBe('LABEL_MISMATCH'))
 it('detects share mismatch',()=>expect(status('share_arithmetic',change('STK_CNT','621458'))).toBe('RECONCILE_SHARES'))
 it.each([['2737','REVIEW_SPECIAL_RESOLUTION_AND_BASIS'],['2738','NOT_BELOW_70_PERCENT_OF_REPORTED_PRICE']])('70 percent boundary %s', (n,s)=>expect(status('70_percent_screen',change('MIN_PRC',n))).toBe(s))
 it('screens early private conversion without determining violation',()=>{expect(status('private_conversion_date')).toBe('AT_OR_AFTER_PAYMENT_PLUS_YEAR');expect(status('private_conversion_date',change('SB_BGN_DT','2027.11.23'))).toBe('REVIEW_EARLY_START');expect(status('private_conversion_date',change('SB_BGN_DT','2027.02.30'))).toBe('INSUFFICIENT_OR_UNSUPPORTED_INPUT')})
 it('distinguishes issuer redemption wording from purchase option',()=>expect(run().checks.find(x=>x.id==='option_review')?.detail).toMatchObject({issuerEarlyRedemptionMention:true,purchaseOptionMention:false}))
 it('rejects missing CB identity and unsupported instruments',()=>{expect(()=>run(fixture.rows.slice(1))).toThrow();expect(CbFilingReviewSchema.safeParse({...fixture,instrument:'EB'}).success).toBe(false)})
 it('works via existing MCP route',async()=>{const api={} as LawApiClient;const r=await executeTool(api,{tool_name:'fss_disclosure_form',params:fixture});expect(r.isError).toBeFalsy();expect(JSON.parse(r.content[0].text).status).toBe('SUPPLIED_CB_TABLE_REVIEW_ONLY');expect((await fssDisclosureForm(api,{...fixture,rows:[]})).isError).toBe(true)})
})
