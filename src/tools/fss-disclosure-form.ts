import {z} from 'zod'
import type {LawApiClient} from '../lib/api-client.js'
import type {ToolResponse} from '../lib/types.js'
import {FSS_FORMS} from './fss-form-corpus.js'
import {FSS_TOPICS,fssRegulatoryLink} from './fss-regulatory-link.js'
import {MezzanineFilingReviewSchema,reviewMezzanineFiling} from './fss-cb-filing-review.js'
export const FssDisclosureFormSchema=z.discriminatedUnion('mode',[
 MezzanineFilingReviewSchema,
 z.object({mode:z.literal('form'),version:z.literal('20260930'),instrument:z.enum(['CB','BW','EB']),start_line:z.number().int().min(1).max(10000).default(1),keyword:z.string().trim().min(1).max(100).optional()}).strict(),
 z.object({mode:z.literal('regulatory_basis'),instrument:z.enum(['CB','BW','EB']),topic:z.enum(FSS_TOPICS)}).strict(),
 z.object({mode:z.literal('amendment_scope'),version:z.literal('20261113')}).strict(),
])
const SOURCE='(붙임5) 별지서식(2026.9.30. 시행)_게시.hwp'
const SHA='eba54197af2dd630ea3faef9c014ead899844a5cbb4207ad534d5b57d6d8ff24'
const changedArticles=['제2-1-1조 공모개요','제2-1-3조 공모가격 결정','제2-1-4조 모집 또는 매출절차 등','제2-3-1조 투자위험요소','제2-4-5조 공모가격에 대한 의견','제13-1-1조 청약 및 배정']
export async function fssDisclosureForm(_api:LawApiClient,input:z.input<typeof FssDisclosureFormSchema>):Promise<ToolResponse>{
 const parsed=FssDisclosureFormSchema.safeParse(input)
 if(!parsed.success)return {isError:true,content:[{type:'text',text:'[NOT_VERIFIED] 지원하는 고정 자료 버전과 모드만 입력하세요. 행위시 적용 및 현행성 미검증.'}]}
 const p=parsed.data
 if(p.mode==='filing_review'){try{return {content:[{type:'text',text:JSON.stringify(reviewMezzanineFiling(p),null,2)}]}}catch(error){if(!(error instanceof RangeError))throw error;return {isError:true,content:[{type:'text',text:'[NOT_VERIFIED] '+error.message}]}}}
 if(p.mode==='regulatory_basis')return fssRegulatoryLink(_api,p)
 if(p.mode==='amendment_scope')return {content:[{type:'text',text:JSON.stringify({status:'SUPPLIED_AMENDMENT_SCOPE_ONLY',publisher:'금융감독원',version:p.version,source:'(붙임2) 기업공시서식 작성기준 개정내용(본문).pdf',sha256:'5f9bcecca0d24c74b362e5a8f41d943ac41e5eeb55fe9bb2ca50e9863d06a446',changedArticles,summary:'사전수요조사 및 사전청약(코너스톤) IPO 공시 관련 개정. 제공된 개정본문에서 별지 38-24~26의 변경은 확인되지 않음. 별지서식 자체의 전후 비교는 별도 이전본 필요.',currentnessVerified:false,applicabilityVerified:false},null,2)}]}
 const f=FSS_FORMS[p.instrument], lines=f.lines as readonly string[]
 const normalize=(s:string)=>s.normalize('NFKC').replace(/<[^>]*>/g,'').replace(/\s+/g,'').toLowerCase()
 const keyword=p.keyword?normalize(p.keyword):undefined
 if(p.keyword&&!keyword)return {isError:true,content:[{type:'text',text:'검색어가 비어 있습니다.'}]}
 const selected=lines.map((text,i)=>({line:i+1,text})).filter(x=>!keyword||normalize(x.text).includes(keyword))
 const offset=p.start_line-1
 if(offset>selected.length)return {isError:true,content:[{type:'text',text:'[NOT_VERIFIED] 검색 결과 범위를 벗어난 페이지입니다.'}]}
 // Return complete lines, with deterministic continuation cursor. No silently dropped matches.
 const page:typeof selected=[];let chars=0
 for(const row of selected.slice(offset,offset+40)){if(page.length&&chars+row.text.length>7500)break;page.push(row);chars+=row.text.length}
 const next=offset+page.length<selected.length?offset+page.length+1:null
 return {content:[{type:'text',text:JSON.stringify({status:'SUPPLIED_FORM_SNAPSHOT_ONLY',publisher:'금융감독원',version:p.version,source:SOURCE,sha256:SHA,formNo:f.formNo,instrument:p.instrument,sourceLineCount:lines.length,matchCount:selected.length,keyword:p.keyword??null,startLine:p.start_line,nextStartLine:next,currentnessVerified:false,applicabilityVerified:false,originalBinaryReturned:false,parserOutput:true,lines:page},null,2)}]}
}
