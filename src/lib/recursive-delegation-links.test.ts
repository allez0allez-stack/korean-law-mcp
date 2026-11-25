import { describe, expect, it } from "vitest"
import { parseDelegatedLawLinks as parse } from "./admin-delegation-links.js"
const source={lawName:"시험법",mst:"123456",lawId:"000001",effectiveDate:"20260101"}
const meta={법령명:source.lawName,법령일련번호:source.mst,법령ID:1,시행일자:source.effectiveDate}
const entry={위임법령조문번호:"271",위임법령조문가지번호:"10",조항호목:"제249조의7제1항",라인텍스트:"대통령령으로 정하는"}
const edge={위임구분:"법령",위임법령일련번호:"654321",위임법령제목:"시험법 시행령",위임법령조문정보:entry}
const row=(links:unknown,branch="7")=>({조정보:{조문번호:"249",조문가지번호:branch},위임정보:links})
const root=(rows:unknown,md:unknown=meta)=>({lsDelegated:{법령:{법령정보:md,위임조문정보:rows}}})
const run=(rows:unknown)=>parse(root(rows),source,"제249조의7")
describe("recursive statutory linkage parser, observed official envelope",()=>{
  it("preserves exact target article branch and source clause",()=>expect(run(row(edge)).links).toEqual([{mst:"654321",name:"시험법 시행령",article:"제271조의10",location:"제249조의7제1항",wording:"대통령령으로 정하는"}]))
  it("supports arrays and numeric identifiers",()=>expect(run([row([{...edge,위임법령일련번호:654321,위임법령조문정보:[{...entry,위임법령조문번호:271,위임법령조문가지번호:10}]}])]).status).toBe("LINKS_FOUND"))
  it("does not traverse a neighboring source branch",()=>expect(run(row(edge,"8")).status).toBe("NOT_VERIFIED"))
  it("rejects wrong source effective slice",()=>expect(parse(root(row(edge),{...meta,시행일자:"20250101"}),source,"제249조의7").status).toBe("NOT_VERIFIED"))
  it("rejects missing source lineage ID",()=>expect(parse(root(row(edge),{...meta,법령ID:undefined}),source,"제249조의7").status).toBe("NOT_VERIFIED"))
  it("rejects a target with missing MST rather than guessing",()=>expect(run(row({...edge,위임법령일련번호:""}))).toMatchObject({status:"PARTIAL",links:[]}))
  it("rejects a conflicting source clause",()=>expect(run(row({...edge,위임법령조문정보:{...entry,조항호목:"제249조의8제1항"}}))).toMatchObject({status:"PARTIAL",links:[]}))
  it("does not infer target metadata from neighboring delegation rows",()=>expect(run(row([edge,{위임법령조문정보:{...entry,위임법령조문번호:"272"}}]))).toMatchObject({status:"PARTIAL",links:[{article:"제271조의10"}]}))
  it("deduplicates identical rows but keeps distinct source paragraphs",()=>expect(run(row({...edge,위임법령조문정보:[entry,entry,{...entry,조항호목:"제249조의7제2항"}]})).links).toHaveLength(2))
  it("rejects conflicting titles for one target MST",()=>expect(run(row([edge,{...edge,위임법령제목:"다른법 시행령"}])).status).toBe("NOT_VERIFIED"))
  it("never interprets an administrative or institution rule as a statute edge",()=>expect(run(row([{위임행정규칙조문정보:{}},{위임규정조문정보:{}}])).status).toBe("NO_LINK_IN_RESPONSE"))
  it("rejects mixed statutory and administrative record",()=>expect(run(row({...edge,위임행정규칙조문정보:{}})).status).toBe("PARTIAL"))
})
