import { describe, expect, it } from "vitest"
import { parseThreeTierDelegation } from "./three-tier-parser.js"
const rule = (name: string, serial?: string | number, jo: string | number = "0001") => ({위임행정규칙명:name,위임행정규칙일련번호:serial,위임행정규칙조번호:jo})
function parse(rules: ReturnType<typeof rule>[], source: string | number = "0001") {
  return parseThreeTierDelegation({LspttnThdCmpLawXService:{기본정보:{법령명:"시험법"},위임조문삼단비교:{법률조문:{조번호:source,조가지번호:"00",위임행정규칙목록:{위임행정규칙:rules}}}}}).articles[0].delegations
}
describe("three-tier administrative-rule identity",()=>{
  it("keeps different rules with identical article numbers",()=>expect(parse([rule("A고시","2100000000001"),rule("B고시","2100000000002")]).map(r=>r.lawName)).toEqual(["A고시","B고시"]))
  it("keeps different revisions of the same rule separate",()=>expect(parse([rule("A고시","2100000000001"),rule("A고시","2100000000002")]).map(r=>r.adminRuleSerial)).toEqual(["2100000000001","2100000000002"]))
  it("deduplicates exact duplicate links",()=>expect(parse([rule("A고시","2100000000001"),rule("A고시","2100000000001")])).toHaveLength(1))
  it("keeps named rules distinct when IDs are missing",()=>expect(parse([rule("A고시"),rule("B고시")])).toHaveLength(2))
  it("handles documented numeric identifiers and article numbers",()=>expect(parse([rule("A고시",2100000000001,2)],1)[0]).toMatchObject({adminRuleSerial:"2100000000001",jo:"000200",joNum:"제2조"}))
  it("does not manufacture a serial for malformed values",()=>expect(parse([rule("A고시","bad")])[0].adminRuleSerial).toBeUndefined())
  it("does not merge contradictory official names on the same serial",()=>expect(parse([rule("A고시","2100000000001"),rule("B고시","2100000000001")])).toHaveLength(2))
})
