import {describe,it,expect} from 'vitest'
import type {LawApiClient} from '../lib/api-client.js'
import '../tool-registry.js'
import {discoverTools,executeTool} from './meta-tools.js'
import {fssDisclosureForm} from './fss-disclosure-form.js'
import {FSS_FORMS} from './fss-form-corpus.js'
const api={} as LawApiClient
const form=async(instrument:'CB'|'BW'|'EB',keyword?:string,start_line=1)=>JSON.parse((await fssDisclosureForm(api,{mode:'form',version:'20260930',instrument,keyword,start_line})).content[0].text)
describe('FSS source snapshot',()=>{
 it.each([['CB','38-24'],['BW','38-25'],['EB','38-26']] as const)('returns exact source identity %s',async(k,n)=>expect(await form(k)).toMatchObject({formNo:n,currentnessVerified:false,applicabilityVerified:false,parserOutput:true}))
 it.each(['CB','BW','EB'] as const)('paginates all lines without losing text %s',async(k)=>{let page=await form(k),rows=[...page.lines];while(page.nextStartLine!==null){page=await form(k,undefined,page.nextStartLine);rows.push(...page.lines)}expect(rows.map(r=>r.text)).toEqual(FSS_FORMS[k].lines);expect(rows.map(r=>r.line)).toEqual(rows.map((_,i)=>i+1))})
 it('distinguishes CB/BW/EB terms',async()=>{expect((await form('CB','전환가액 조정')).matchCount).toBeGreaterThan(0);expect((await form('BW','행사가액 조정')).matchCount).toBeGreaterThan(0);expect((await form('EB','교환가액 조정')).matchCount).toBeGreaterThan(0);expect((await form('EB','최저 조정가액')).matchCount).toBe(0)})
 it('finds options and EB treasury share note',async()=>{expect((await form('CB','call option')).matchCount).toBeGreaterThan(0);expect((await form('EB','교환대상이 자기주식')).matchCount).toBeGreaterThan(0)})
 it('keeps amendment scope separate',async()=>{const d=JSON.parse((await fssDisclosureForm(api,{mode:'amendment_scope',version:'20261113'})).content[0].text);expect(d.changedArticles).toHaveLength(6);expect(d.currentnessVerified).toBe(false)})
 it('rejects out of range',async()=>expect((await fssDisclosureForm(api,{mode:'form',version:'20260930',instrument:'CB',start_line:10000})).isError).toBe(true))
 it('registers and discovers through meta tool',async()=>{expect((await discoverTools(api,{intent:'금감원공시서식'})).content[0].text).toContain('fss_disclosure_form');expect((await executeTool(api,{tool_name:'fss_disclosure_form',params:{mode:'form',version:'20260930',instrument:'EB'}})).isError).toBeFalsy()})
})
