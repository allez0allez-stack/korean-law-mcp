import { describe, expect, it } from "vitest"
import { parseDelegatedAdminLinks as parse } from "./admin-delegation-links.js"
const source={lawName:"시험법 시행령",mst:"123456",lawId:"000001",effectiveDate:"20261101"}
const meta={"법령명":source.lawName,"법령일련번호":source.mst,"법령ID":1,"시행일자":source.effectiveDate}
const link={"위임행정규칙일련번호":"2100000000001","위임행정규칙제목":"시험기준","위임구분":"위임행정규칙","라인텍스트":"고시한다"}
const root=(rows:unknown[],md:Record<string,unknown>=meta)=>({lsDelegated:{법령:{법령정보:md,위임조문정보:rows}}})
const article=(no:string,links:unknown[],branch?:string)=>({조정보:{조문번호:no,...(branch===undefined?{}:{조문가지번호:branch})},위임정보:links.map(l=>({위임구분:"행정규칙",위임행정규칙조문정보:l}))})
describe("official lsDelegated fixtures using observed live envelope",()=>{
  it("matches exact branch scope, not the neighboring article",()=>{const r=parse(root([article("001102",[link]),article("001100",[{...link,위임행정규칙제목:"다른"}])]),source,"제11조의2");expect(r.status).toBe("LINKS_FOUND");expect(r.links.map(x=>x.name)).toEqual(["시험기준"])})
  it("rejects mismatched effective slice",()=>expect(parse(root([article("001102",[link])],{...meta,시행일자:"20270101"}),source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("rejects wrong law identity",()=>expect(parse(root([article("001102",[link])],{...meta,법령명:"다른법"}),source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("rejects missing source metadata",()=>expect(parse({rows:[article("001102",[link])]},source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("accepts a bare number without branch in the official 조정보",()=>expect(parse(root([article("11",[link])]),source,"제11조").status).toBe("LINKS_FOUND"))
  it("accepts an explicit branch field",()=>expect(parse(root([article("11",[link],"2")]),source,"제11조의2").status).toBe("LINKS_FOUND"))
  it("marks a differently classified link partial",()=>expect(parse(root([{조정보:{조문번호:"제11조"},위임정보:{위임행정규칙조문정보:link,위임법령조문정보:{}}}]),source,"제11조").status).toBe("PARTIAL"))
  it("marks missing serial partial",()=>expect(parse(root([article("제11조",[{...link,위임행정규칙일련번호:""}])]),source,"제11조").status).toBe("PARTIAL"))
  it("rejects conflicting names for the same serial",()=>expect(parse(root([article("제11조",[link,{...link,위임행정규칙제목:"다른기준"}])]),source,"제11조").status).toBe("NOT_VERIFIED"))
  it("reports no link only for an identified article in the response",()=>expect(parse(root([article("제11조",[])]),source,"제11조").status).toBe("NO_LINK_IN_RESPONSE"))
  it("does not claim absence when the source article is missing",()=>expect(parse(root([article("제12조",[link])]),source,"제11조").status).toBe("NOT_VERIFIED"))
  it("rejects metadata in an unrelated sibling envelope",()=>expect(parse({identity:{basic:meta},unrelated:{rows:[article("제11조",[link])]}},source,"제11조").status).toBe("NOT_VERIFIED"))
  it("rejects multiple independently identified envelopes",()=>expect(parse({first:{basic:meta,rows:[article("제11조",[link])]},second:{basic:meta,rows:[article("제11조",[link])]}},source,"제11조").status).toBe("NOT_VERIFIED"))
  it("keeps a valid source envelope isolated from an unrelated sibling",()=>{const r=parse({...root([article("제11조",[link])]),unrelated:{rows:[article("제11조",[{...link,위임행정규칙제목:"다른규칙"}])]}},source,"제11조");expect(r.links.map(l=>l.name)).toEqual(["시험기준"])})
  it("rejects a conflicting source location",()=>expect(parse(root([article("제11조",[{...link,조항호목:"제12조제1항"}])]),source,"제11조").status).toBe("PARTIAL"))
  it("keeps distinct source paragraphs for one serial",()=>expect(parse(root([article("제11조",[{...link,조항호목:"제11조제1항"},{...link,조항호목:"제11조제2항"}])]),source,"제11조").links).toHaveLength(2))
  it("deduplicates repeated rule links",()=>expect(parse(root([article("제11조",[link,link])]),source,"제11조").links).toHaveLength(1))
})
