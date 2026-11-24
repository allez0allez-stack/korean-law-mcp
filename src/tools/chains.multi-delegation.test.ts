import { beforeEach, describe, expect, it, vi } from "vitest"
import { chainLawSystem } from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"
const cases = [
  { name:"소득세법", a:"제12조", b:"제20조", id:"1801" },
  { name:"도로교통법", a:"제43조", b:"제44조", id:"1802" },
  { name:"건축법", a:"제11조", b:"제14조", id:"1803" },
  { name:"민법", a:"제750조", b:"제751조", id:"1804", empty:true },
]
describe("law_system general multi-article delegation integration", () => {
  beforeEach(() => lawCache.clear())
  for (const c of cases) {
    it(`handles ${c.name} without an industry-specific branch`, async () => {
      const nums = [c.a,c.b].map(x=>x.replace(/\D/g,""))
      const rows = c.empty ? [] : nums.map(n=>({조번호:n,조가지번호:"00",조제목:"원조문",시행령조문:{조번호:n,조내용:`법 제${n}조에 따른 시행령`}}))
      const getThreeTier = vi.fn(async()=>JSON.stringify({LspttnThdCmpLawXService:{기본정보:{법령명:c.name,시행령명:c.name+" 시행령"},위임조문삼단비교:{법률조문:rows}}}))
      const client = {searchLaw:async()=>`<LawSearch><totalCnt>1</totalCnt><law><법령명한글>${c.name}</법령명한글><법령일련번호>${c.id}</법령일련번호><법령ID>${c.id}</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`,getThreeTier,
        getLawText:async()=>JSON.stringify({법령:{기본정보:{법령명_한글:c.name},조문:{조문단위:nums.map(n=>({조문여부:"조문",조문번호:n,조문제목:"원조문",조문내용:`제${n}조(원조문) 본문`}))}}})} as unknown as LawApiClient
      const r=await chainLawSystem(client,{query:c.name,articles:[c.a,c.b]})
      const s=r.content[0].text
      expect(r.isError).not.toBe(true)
      expect(getThreeTier).toHaveBeenCalledTimes(1)
      expect(s).toContain("▶ 지정 조문 위임관계")
      for (const jo of [c.a,c.b]) expect(s).toContain((c.empty?"[NOT_FOUND] ":"▶ 위임관계 ")+jo)
      expect(s).not.toContain("협회 자율규정")
    })
  }
})
