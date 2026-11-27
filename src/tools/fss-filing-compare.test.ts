import {describe,it,expect} from 'vitest'
import {FilingCompareSchema,compareMezzanineFilings} from './fss-filing-compare.js'
const row=(label:string,code:string,value:string)=>[{value:label},{dart_code:code,value}]
const b={version:'20260930',instrument:'CB',rcept_no:'20261116002211',source_file:'before.xml',table_index:2,rows:[row('1. 사채의 종류','PL_KND','사모 전환사채'),row('회차','SEQ_NO','2'),row('전환가액 (원/주)','EXE_PRC','3911'),row('최저 조정가액 (원)','MIN_PRC','-')]}
const a={...b,rcept_no:'20261127000001',source_file:'after.xml',rows:[...b.rows.slice(0,2),row('전환가액 (원/주)','EXE_PRC','4000')]}
const p=FilingCompareSchema.parse({mode:'filing_compare',issuer_code:'01437858',before:b,after:a})
describe('supplied pair comparison (synthetic amendment)',()=>{
 it('shows changed values with row evidence, missing not equal',()=>{const r=compareMezzanineFilings(p);expect(r.changedCount).toBe(1);expect(r.fields.find(f=>f.code==='EXE_PRC')).toMatchObject({status:'VALUE_CHANGED_REVIEW',before:[{value:'3911',row:2}],after:[{value:'4000',row:2}]});expect(r.fields.find(f=>f.code==='MIN_PRC')?.status).toBe('NOT_COMPARABLE');expect(r.lineageVerified).toBe(false)})
 it('rejects different issue or reverse receipt',()=>{expect(()=>compareMezzanineFilings({...p,after:{...p.after,rows:[row('회차','SEQ_NO','3'),...p.after.rows.slice(2)]}})).toThrow();expect(()=>compareMezzanineFilings({...p,before:p.after,after:p.before})).toThrow()})
})

it('detects Finger 10th CB reported start-date change from selected recovered source cells',()=>{
 const before={...b,rcept_no:'20261027000338',source_file:'SOURCE_001_20261027000338.xml',source_sha256:'543fcf4019b12dbb1f3bae23ec626265ec69ad7f37c5d0cfaeec5a7ca6ac839a',parser_status:'RECOVERED',rows:[row('1. 사채의 종류','PL_KND','무기명식 이권부 무보증 사모 전환사채'),row('회차','SEQ_NO','10'),row('전환가액 (원/주)','EXE_PRC','12,193'),[{value:'시작일'},{value:'2027년 11월 12일',unit:'SB_BGN_DT',unit_value:'20271112'}]]}
 const after={...before,rcept_no:'20261104000361',source_file:'SOURCE_001_20261104000361.xml',source_sha256:'376b33d3a2983eabfb19c3606b53680c70523868b6f7fc7bcfa412f281dda6a8',table_index:11,rows:[...before.rows.slice(0,3),[{value:'시작일'},{value:'2027년 11월 13일',unit:'SB_BGN_DT',unit_value:'20271113'}]]}
 // Issuer code is caller asserted here; selected cells only, not complete tables.
 const r=compareMezzanineFilings(FilingCompareSchema.parse({mode:'filing_compare',issuer_code:'00000000',before,after}));expect(r.changedCount).toBe(1);expect(r.fields.find(f=>f.code==='SB_BGN_DT')).toMatchObject({status:'VALUE_CHANGED_REVIEW',before:[{value:'2027년 11월 12일'}],after:[{value:'2027년 11월 13일'}]});expect(r).toMatchObject({originalReviewRequired:true,sourceAttested:false,beforeSource:{parserStatus:'RECOVERED'},afterSource:{parserStatus:'RECOVERED'}})
})
it('compares disclosed share-total percentage without inventing numeric equivalence',()=>{
 const before={...b,rows:[...b.rows,row('주식총수 대비비율(%)','STK_RT','6.04')]}
 const after={...a,rows:[...a.rows,row('주식총수 대비비율(%)','STK_RT','6.03')]}
 const result=compareMezzanineFilings(FilingCompareSchema.parse({mode:'filing_compare',issuer_code:'00000000',before,after}));expect(result.fields.find(f=>f.code==='STK_RT')).toMatchObject({status:'VALUE_CHANGED_REVIEW',before:[{value:'6.04'}],after:[{value:'6.03'}]})
})
