import { describe,expect,it } from "vitest"
import { reviewNoticeAddenda,findNoticeFutureIssueRisks } from "./delegation-notice-addenda.js"

describe("historical notice original addenda audit",()=>{
  it("requires exact dashed and branch article numbers",()=>{
    const data=[
      "부칙 제2025-26호\n제2조(적용례) 제7-41조의7제8항은 2025년 10월 1일부터 적용한다.\n제3조(경과조치) 제7-41조의70에 대해서는 종전 규정",
      "부칙 제2021-42호\n제3조(특례) 영 제271조의10제13항과 관련한 보고절차를 따른다.\n제4조(경과조치) 영 제271조의100에 따른다.",
    ]
    const r=reviewNoticeAddenda(data,"제7-41조의7","제271조의10")
    expect(r.status).toBe("evidence_found")
    expect(r.noticeMentions).toBe(1)
    expect(r.decreeMentions).toBe(1)
    expect(r.excerpts.some(v=>v.signal==="notice_article")).toBe(true)
    expect(r.excerpts.some(v=>v.signal==="decree_article")).toBe(true)
  })
  it("reports transitional wording without claiming a specific article or applicability",()=>{
    const r=reviewNoticeAddenda(["부칙\n제1조(시행일) 이 고시는 2025년 10월 1일부터 시행한다.\n제2조(경과조치) 시행 당시의 계약은 종전의 규정에 따른다."],"제7-41조의7","제271조의10")
    expect(r.noticeMentions).toBe(0)
    expect(r.decreeMentions).toBe(0)
    expect(r.transitionLines).toBe(2)
    expect(r.excerpts).toHaveLength(2)
    expect(r.excerpts.every(x=>x.signal==="transition_phrase")).toBe(true)
  })
  it("keeps missing original addenda fail-closed and empty text inconclusive",()=>{
    expect(reviewNoticeAddenda(null,"제7-41조의7","제271조의10").status).toBe("not_verified")
    expect(reviewNoticeAddenda([],"제7-41조의7","제271조의10").status).toBe("not_verified")
    expect(reviewNoticeAddenda(["  "],"제7-41조의7","제271조의10").status).toBe("not_verified")
    expect(reviewNoticeAddenda(["부칙, 내용 없음"],"제7-41조의7","제271조의10").status).toBe("no_direct_match")
  })
  it("bounds the number of extracts without losing total occurrence counts",()=>{
    const contents=[Array.from({length:14},(_,i)=>"제"+(i+1)+"조(적용례) 제7-41조의7 시행 당시 계약에 관한 경과조치").join("\n")]
    const r=reviewNoticeAddenda(contents,"제7-41조의7","제271조의10",3)
    expect(r.excerpts).toHaveLength(3)
    expect(r.noticeMentions).toBe(14)
    expect(r.omitted).toBe(11)
  })
  it("flags a plain effective-day clause without 시행일 or 경과조치 words",()=>{
    const result=reviewNoticeAddenda([
      "부칙 제2025-40호\\n이 고시는 공포한 날부터 시행한다.",
      "부칙 제2025-39호\\n이 고시는 2025년 10월 1일부터 시행한다.",
    ],"제7-41조의7","제271조의10")
    expect(result.transitionLines).toBe(2)
    expect(result.excerpts).toHaveLength(2)
    expect(result.excerpts.every(v=>v.signal==="transition_phrase")).toBe(true)
  })
  it("shows the earliest future effective change first instead of history search order",()=>{
    const versions=[
      {serial:"selected",issuedYd:"20251001",efYd:"20251001",issuedNo:"2025-26"},
      {serial:"late",issuedYd:"20251015",efYd:"20270101",issuedNo:"2025-30"},
      {serial:"early",issuedYd:"20251010",efYd:"20251101",issuedNo:"2025-29"},
    ]
    const result=findNoticeFutureIssueRisks(versions,versions[0],"20251021",1)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain("20251101")
  })
  it("flags only already-issued but future-effective changes in same genealogy",()=>{
    const v=[
      {serial:"a",issuedYd:"20251001",efYd:"20251001",issuedNo:"2025-26"},
      {serial:"b",issuedYd:"20251020",efYd:"20251125",issuedNo:"2025-35"},
      {serial:"c",issuedYd:"20251130",efYd:"20260101",issuedNo:"2026-1"},
    ]
    const r=findNoticeFutureIssueRisks(v,v[0],"20251021")
    expect(r).toHaveLength(1)
    expect(r[0]).toContain("20251125")
    expect(findNoticeFutureIssueRisks(v,v[0],"20250901")).toHaveLength(0)
  })
})
