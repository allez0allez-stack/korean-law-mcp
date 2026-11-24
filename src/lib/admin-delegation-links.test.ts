import { describe, expect, it } from "vitest"
import { parseDelegatedAdminLinks as parse } from "./admin-delegation-links.js"
const source={lawName:"시험법 시행령",mst:"123456",lawId:"000001",effectiveDate:"20261101"}
const meta={"법령명":source.lawName,"법령일련번호":source.mst,"법령ID":1,"시행일자":source.effectiveDate}
const link={"위임행정규칙일련번호":"2100000000001","위임행정규칙제목":"시험기준","위임구분":"위임행정규칙","라인텍스트":"고시한다"}
const root=(rows:unknown[],md:Record<string,unknown>=meta)=>({service:{basic:md,rows}})
const article=(no:string,links:unknown[],branch?:string)=>({조문번호:no,...(branch===undefined?{}:{조문가지번호:branch}),links})
describe("official lsDelegated documented-field fixtures (not live envelopes)",()=>{
  it("matches exact branch scope, not the neighboring article",()=>{const r=parse(root([article("001102",[link]),article("001100",[{...link,위임행정규칙제목:"다른"}])]),source,"제11조의2");expect(r.status).toBe("LINKS_FOUND");expect(r.links.map(x=>x.name)).toEqual(["시험기준"])})
  it("rejects mismatched effective slice",()=>expect(parse(root([article("001102",[link])],{...meta,시행일자:"20270101"}),source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("rejects wrong law identity",()=>expect(parse(root([article("001102",[link])],{...meta,법령명:"다른법"}),source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("rejects missing source metadata",()=>expect(parse({rows:[article("001102",[link])]},source,"제11조의2").status).toBe("NOT_VERIFIED"))
  it("does not infer an ambiguous bare number",()=>expect(parse(root([article("11",[link])]),source,"제11조").status).toBe("NOT_VERIFIED"))
  it("accepts an explicit branch field",()=>expect(parse(root([article("11",[link],"2")]),source,"제11조의2").status).toBe("LINKS_FOUND"))
  it("marks a differently classified link partial",()=>expect(parse(root([article("제11조",[{...link,위임구분:"인용법령"}])]),source,"제11조").status).toBe("PARTIAL"))
  it("marks missing serial partial",()=>expect(parse(root([article("제11조",[{...link,위임행정규칙일련번호:""}])]),source,"제11조").status).toBe("PARTIAL"))
  it("rejects conflicting names for the same serial",()=>expect(parse(root([article("제11조",[link,{...link,위임행정규칙제목:"다른기준"}])]),source,"제11조").status).toBe("NOT_VERIFIED"))
  it("reports no link only for an identified article in the response",()=>expect(parse(root([article("제11조",[])]),source,"제11조").status).toBe("NO_LINK_IN_RESPONSE"))
  it("does not claim absence when the source article is missing",()=>expect(parse(root([article("제12조",[link])]),source,"제11조").status).toBe("NOT_VERIFIED"))
  it("deduplicates repeated rule links",()=>expect(parse(root([article("제11조",[link,link])]),source,"제11조").links).toHaveLength(1))
})
