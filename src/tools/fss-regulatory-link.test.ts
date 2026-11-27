import {describe,it,expect,vi} from 'vitest'
import type {LawApiClient} from '../lib/api-client.js'
import type {GetAdminRuleInput} from './admin-rule.js'
import type {GetLawTextInput} from './law-text.js'
import {fssRegulatoryLink} from './fss-regulatory-link.js'
import {FssDisclosureFormSchema} from './fss-disclosure-form.js'
const api={} as LawApiClient
const rule='증권의 발행 및 공시 등에 관한 규정',law='자본시장과 금융투자업에 관한 법률'
const searchText=`1. ${rule}\n   - 행정규칙일련번호: 2100000287734 (get_admin_rule의 id)\n   - 발령일: 20261103 / 시행일: 20261113\n   - 구분: 고시\n   - 소관부처: 금융위원회\n\n2. ${rule} 시행세칙\n   - 행정규칙일련번호: 2200000107389\n   - 구분: 세칙\n   - 소관부처: 금융감독원`
const reply=(text:string)=>({content:[{type:'text',text}]})
const deps=()=>({today:()=> '20261126',search:vi.fn(async()=>reply(searchText)),read:vi.fn(async(_a:LawApiClient,q:GetAdminRuleInput)=>reply(`행정규칙명: ${rule}\n시행일: 2026.11.13\n소관부처: 금융위원회\n${q.jo}(검토 항목)\n① 본문`)),law:vi.fn(async(_a:LawApiClient,q:GetLawTextInput)=>reply(`법령명: ${law}${q.lawId==='010817'?' 시행령':''}\n시행일: 20261113\n${q.jo}(주요사항보고서)\n① 본문`))})
const data=(r:Awaited<ReturnType<typeof fssRegulatoryLink>>)=>JSON.parse(r.content[0].text)
describe('FSS live regulatory basis',()=>{
 it.each(['CB','BW','EB'] as const)('retrieves common filing law for %s',async instrument=>{const d=deps();expect(data(await fssRegulatoryLink(api,{instrument,topic:'filing'},d))).toMatchObject({status:'OFFICIAL_ARTICLE_RETRIEVED',lawId:'010513',applicabilityVerified:false,formCurrentnessVerified:false});expect(d.law).toHaveBeenCalledWith(api,{lawId:'010513',jo:'제161조'});expect(d.search).not.toHaveBeenCalled()})
 it('retrieves attachments decree',async()=>{const d=deps();expect(data(await fssRegulatoryLink(api,{instrument:'EB',topic:'attachments'},d)).lawId).toBe('010817');expect(d.law).toHaveBeenCalledWith(api,{lawId:'010817',jo:'제171조'})})
 it('resolves exact live serial and CB refixing article',async()=>{const d=deps();const r=data(await fssRegulatoryLink(api,{instrument:'CB',topic:'refixing_up'},d));expect(r.status).toBe('OFFICIAL_ARTICLE_RETRIEVED');expect(d.read).toHaveBeenCalledWith(api,{id:'2100000287734',jo:'제5-23조의2'})})
 it('includes BW limited application rule',async()=>{const d=deps();const r=data(await fssRegulatoryLink(api,{instrument:'BW',topic:'pricing'},d));expect(r.evidence.map((e:{article:string})=>e.article)).toEqual(['제5-24조','제5-22조']);expect(r.note).toContain('제1항만')})
 it('does not duplicate BW option disclosure article',async()=>{const d=deps();await fssRegulatoryLink(api,{instrument:'BW',topic:'option_disclosure'},d);expect(d.read).toHaveBeenCalledTimes(1)})
 it('does not map EB to CB special rules',async()=>{const d=deps();expect(data(await fssRegulatoryLink(api,{instrument:'EB',topic:'pricing'},d)).status).toBe('NO_VERIFIED_MAPPING');expect(d.search).not.toHaveBeenCalled()})
 it('rejects wrong agency/duplicate exact rule/future version',async()=>{for(const text of [searchText.replace('금융위원회','금융감독원'),searchText+'\n'+searchText,searchText.replace('20261113','20261213')]){const d=deps();d.search.mockResolvedValue(reply(text));expect((await fssRegulatoryLink(api,{instrument:'CB',topic:'pricing'},d)).isError).toBe(true);expect(d.read).not.toHaveBeenCalled()}})
 it('rejects merely cited article and adjacent heading',async()=>{const d=deps();d.read.mockResolvedValue(reply(`행정규칙명: ${rule}\n시행일: 2026.11.13\n소관부처: 금융위원회\n제5-23조의2(다른 조문)\n제5-23조에 따른 기준`));expect(data(await fssRegulatoryLink(api,{instrument:'CB',topic:'refixing_down'},d)).status).toBe('PARTIAL')})
 it('rejects mismatched effective date and wrong title',async()=>{const d=deps();d.read.mockResolvedValue(reply(`행정규칙명: ${rule}\n시행일: 2026.09.30\n소관부처: 금융위원회\n제5-22조(가격)`));expect((await fssRegulatoryLink(api,{instrument:'CB',topic:'pricing'},d)).isError).toBe(true);d.law.mockResolvedValue(reply(`법령명: 상법\n시행일: 20261113\n제161조(본문)`));expect((await fssRegulatoryLink(api,{instrument:'CB',topic:'filing'},d)).isError).toBe(true)})
 it('preserves partial BW evidence',async()=>{const d=deps();d.read.mockResolvedValueOnce(reply(`행정규칙명: ${rule}\n시행일: 2026.11.13\n소관부처: 금융위원회\n제5-24조(준용)`)).mockResolvedValueOnce(reply('[NOT_FOUND]'));expect(data(await fssRegulatoryLink(api,{instrument:'BW',topic:'pricing'},d))).toMatchObject({status:'PARTIAL',missingArticles:['제5-22조']})})
 it('validates mode without allowing arbitrary URLs or dates',()=>{expect(FssDisclosureFormSchema.safeParse({mode:'regulatory_basis',instrument:'CB',topic:'pricing'}).success).toBe(true);expect(FssDisclosureFormSchema.safeParse({mode:'regulatory_basis',instrument:'CB',topic:'pricing',url:'https://example.com'}).success).toBe(false)})
})
