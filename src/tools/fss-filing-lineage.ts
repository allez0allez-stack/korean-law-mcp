/** Supplied DART listing + correction-header evidence, not a DART client. */
import {z} from 'zod'
import {normalizeDate} from './applicable-law.js'
const date=z.string().regex(/^\d{8}$/).refine(s=>normalizeDate(s)===s)
const receipt=z.string().regex(/^\d{14}$/).refine(s=>normalizeDate(s.slice(0,8))===s.slice(0,8))
const record=z.object({rcept_no:receipt,rcept_dt:date,corp_code:z.string().regex(/^\d{8}$/),report_nm:z.string().trim().min(1).max(200),issue_sequence:z.string().regex(/^\d{1,12}$/).optional(),header_excerpt:z.string().max(12000).optional(),source_file:z.string().max(256).optional(),source_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()
export const FilingLineageSchema=z.object({mode:z.literal('filing_lineage'),issuer_code:z.string().regex(/^\d{8}$/),instrument:z.enum(['CB','BW','EB']),root_receipt:receipt,as_of:date,records:z.array(record).min(1).max(200)}).strict()
type Input=z.infer<typeof FilingLineageSchema>
const title=(s:string)=>s.normalize('NFKC').replace(/\s/g,'')
export function reviewFilingLineage(p:Input){
 const target='주요사항보고서('+{CB:'전환사채권발행결정',BW:'신주인수권부사채권발행결정',EB:'교환사채권발행결정'}[p.instrument]+')'
 const names=(s:string)=>title(s).replace(/^\[(기재정정|첨부정정|첨부추가|정정)\]/,'')
 const isCorrection=(s:string)=>/^\[(기재정정|첨부정정|첨부추가|정정)\]/.test(title(s))
 if(new Set(p.records.map(r=>r.rcept_no)).size!==p.records.length||p.records.some(r=>r.rcept_dt!==r.rcept_no.slice(0,8)||r.corp_code!==p.issuer_code||r.rcept_dt>p.as_of))throw new RangeError('Duplicate, inconsistent issuer/date or future receipt in supplied listing')
 const docs=p.records.filter(r=>names(r.report_nm)===target),root=docs.find(r=>r.rcept_no===p.root_receipt)
 if(!root||isCorrection(root.report_nm)||!root.issue_sequence)throw new RangeError('Original root with issue sequence required')
 const roots=docs.filter(r=>!isCorrection(r.report_nm)&&r.rcept_dt===root.rcept_dt)
 const candidates=[],excluded=[],unresolved=[]
 for(const r of docs.filter(r=>isCorrection(r.report_nm)&&r.rcept_dt>=root.rcept_dt)){
  const e=r.header_excerpt??''
  const m=[...e.matchAll(/정정대상\s*공시서류\s*의\s*최초제출일\s*[:：]\s*(\d{4}\s*(?:년|[.\/-])\s*\d{1,2}\s*(?:월|[.\/-])\s*\d{1,2}\s*일?)/g)]
  const n=[...e.matchAll(/정정대상\s*공시서류\s*[:：]\s*([^\r\n]+)/g)]
  const originalDate=m.length===1?normalizeDate(m[0][1]):null
  const common={receipt:r.rcept_no,originalDate,issueSequence:r.issue_sequence??null,sourceFile:r.source_file??null,sourceSha256:r.source_sha256??null,headerExcerpt:r.header_excerpt??null}
  if(!originalDate||n.length!==1||title(n[0][1])!==target||!r.source_file||originalDate>r.rcept_dt){unresolved.push({...common,reason:'HEADER_EVIDENCE_INCOMPLETE'});continue}
  if(originalDate!==root.rcept_dt){excluded.push({...common,reason:'DIFFERENT_ORIGINAL_SUBMISSION_DATE'});continue}
  if(!r.issue_sequence||r.issue_sequence!==root.issue_sequence||roots.length!==1||r.rcept_no<=root.rcept_no){unresolved.push({...common,reason:'ISSUE_OR_ROOT_AMBIGUITY'});continue}
  candidates.push({...common,reason:'MATCHING_SUPPLIED_ROOT_DATE_TITLE_ISSUE'})
 }
 candidates.sort((a,b)=>a.receipt.localeCompare(b.receipt))
 return {status:'SUPPLIED_LINEAGE_CANDIDATES_ONLY',issuerCode:p.issuer_code,instrument:p.instrument,rootReceipt:root.rcept_no,issueSequence:root.issue_sequence,asOf:p.as_of,rootDate:root.rcept_dt,candidates,excluded,unresolved,latestSuppliedCandidate:unresolved.length||roots.length!==1?null:candidates.at(-1)?.receipt??root.rcept_no,listingCompletenessVerified:false,issuerIdentityVerified:false,sourceAttested:false,lineageVerified:false,latestCorrectionVerified:false,complianceDetermined:false,note:'접수번호 순서만으로 정정 계보를 확정하지 않음. 동일일 복수 최초공시 및 미확인 정정은 보류. DART 목록·원문·회차 및 이후 정정을 별도 확인.'}
}
