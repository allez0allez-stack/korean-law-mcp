import { describe, expect, it } from "vitest"
import { classifyReferenceTail, listedRelationNote } from "./relation-wording.js"

describe("literal legal relation evidence",()=>{
  it.each([
    ["를 준용한다.","JUNYONG_WORDING"],
    ["을 준용할 수 있다.","JUNYONG_WORDING"],
    ["에도 불구하고 예외로 한다.","EXCEPTION_WORDING"],
    ["을 적용하지 아니한다.","EXCEPTION_WORDING"],
    ["를 준용할 수 없다.","EXCEPTION_WORDING"],
    ["에서 정의한 용어", "DEFINITION_WORDING"],
    ["에 따른 신고를 한다.","PROCEDURE_WORDING"],
    ["에 따른 보고 의무", "PROCEDURE_WORDING"],
    ["을 적용한다.","APPLICATION_WORDING"],
  ])("recognizes only an immediate literal phrase %s",(tail,kind)=>expect(classifyReferenceTail(tail)?.kind).toBe(kind))
  it.each(["에 따른 신청서식", "에 따른 거래 후 다른 규정을 준용한다", " 및 제3조를 준용한다", "\n다른 규정을 적용한다", "을 준용한다는 의견", "에 따른 자산"])("does not infer a relation from distant or incomplete wording %s",tail=>expect(classifyReferenceTail(tail)).toBeUndefined())
  it("completes an immediately following delegation phrase from verified source",()=>expect(listedRelationNote("사항은 대통령령으로 정한다.","사항은 대통령령으로","법률","대통령령")).toContain("DELEGATION_WORDING (대통령령으로정한다"))
  it("recognizes subordinate rule and notice wording, without deciding authority",()=>{
    expect(listedRelationNote("재정경제부령으로 정하는 요건을 갖춘다.","재정경제부령으로 정하는","대통령령","부령")).toContain("REDELEGATION_WORDING")
    expect(listedRelationNote("세부적인 사항은 고용노동부장관이 정하여 고시한다.","고용노동부장관이 정하여 고시한다","부령","행정규칙")).toContain("REDELEGATION_WORDING")
  })
  it.each([
    ["다른 내용", "대통령령으로 정한다", "법률", "대통령령"],
    ["대통령령으로 정한다. 대통령령으로 정한다.","대통령령으로 정한다","법률","대통령령"],
    ["대통령령으로 정한다.","대통령령으로 정한다","법률","부령"],
    ["대통령령으로 정한다.","대통령령으로 정한다","대통령령","대통령령"],
    ["대통령령으로 정하는 사항은 제외한다.","대통령령으로 정하는","법률","대통령령"],
    ["대통령령으로 정하지 않는다.","대통령령으로","법률","대통령령"],
    ["사항은 별도로 대통령령으로 정한다.","사항은 별도로","법률","대통령령"],
    ["재정경제부령으로 정한다.","재정경제부령으로 정한다","법률","총리령"],
  ])("abstains on unsupported or ambiguous list evidence %s",(body,word,source,target)=>expect(listedRelationNote(body,word,source,target)).toContain("UNRESOLVED"))
})


describe("official ministry-specific law type metadata",()=>{
  it("recognizes the actual corporate tax rule type returned by the law API",()=>expect(listedRelationNote("재정경제부령으로 정하는 임차사택을 포함한다.","재정경제부령으로 정하는 임차사택을","대통령령","재정경제부령")).toContain("REDELEGATION_WORDING"))
  it("recognizes a ministry-specific source rule delegating to a notice",()=>expect(listedRelationNote("고용노동부장관이 정하여 고시한다.","고용노동부장관이 정하여 고시한다","고용노동부령","행정규칙")).toContain("REDELEGATION_WORDING"))
  it("does not substitute another ministry authority",()=>expect(listedRelationNote("기획재정부령으로 정하는 요건을 갖춘다.","기획재정부령으로 정하는 요건","대통령령","재정경제부령")).toContain("UNRESOLVED"))
  it("does not infer same-level delegation from a named ministry rule",()=>expect(listedRelationNote("재정경제부령으로 정하는 요건을 갖춘다.","재정경제부령으로 정하는 요건","고용노동부령","재정경제부령")).toContain("UNRESOLVED"))
})
