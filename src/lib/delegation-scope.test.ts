import { describe, expect, it } from "vitest"
import { classifyNoticeScope } from "./delegation-scope.js"

const decree = [
  "① 법 제249조의7에 따른 비율을 정한다.",
  "② 법 제249조의7제1항의 실질적인 차입금 범위를 정한다.",
  "⑬ 법 제249조의7제3항제4호에 따른 사항: 4. 금융위원회가 정하여 고시하는 사항",
  "⑭ 법 제249조의7제4항의 사유를 정한다.",
  "⑮ 법 제249조의7제5항에 따라 금융위원회가 정하여 고시하는 회사를 정한다.",
  "<18> 그 밖의 세부사항은 금융위원회가 정하여 고시한다.",
].join(" ")

describe("decree-notice paragraph-level scope evidence", () => {
  it("grades matching parent paragraph and notice gazette language as candidate only", () => {
    const text = "⑧ 영 제271조의10제13항제4호에서 금융위원회가 정하여 고시하는 사항이란 X를 말한다. ⑩ 영 제271조의10제15항제6호에서 금융위원회가 정하여 고시하는 회사란 Y를 말한다."
    const result = classifyNoticeScope("제271조의10", decree, text)
    expect(result.map(x => x.status)).toEqual(["wording_candidate","wording_candidate"])
    expect(result[0].cite).toContain("제13항제4호")
    expect(result[1].cite).toContain("제15항제6호")
  })
  it("requires substantive wording on both sides instead of treating any citation as delegated authority", () => {
    const text = "⑤ 법 제249조의7 및 영 제271조의10제2항에 따라 자기자본을 산정한다. ⑨ 영 제271조의10제13항 및 제14항에 따른 서식은 금융감독원장이 정한다."
    const result = classifyNoticeScope("제271조의10", decree, text)
    expect(result.map(x => x.status)).toEqual(["review_required","review_required"])
  })
  it("fail-closes when the decree paragraph cannot be located", () => {
    const r = classifyNoticeScope("제271조의10","① 첫째 항","영 제271조의10제19항에서 금융위원회가 정하여 고시한다.")
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe("not_verified")
  })
  it("does not confuse the main article with the branch or neighboring branch", () => {
    const t = "영 제271조의100제13항에서 정한다. 영 제271조제13항에서 정한다. 법 제271조의10제13항에서 정한다."
    expect(classifyNoticeScope("제271조의10",decree,t)).toHaveLength(0)
  })
  it("does not use an administrative search header as evidence, and keeps output bounded", () => {
    expect(classifyNoticeScope("제271조의10",decree,"[본문 검색: 제271조의10]")).toHaveLength(0)
    const t = Array.from({length:20},()=> "영 제271조의10제13항에서 금융위원회가 정하여 고시한다.").join(" ")
    expect(classifyNoticeScope("제271조의10",decree,t)).toHaveLength(8)
  })
})
