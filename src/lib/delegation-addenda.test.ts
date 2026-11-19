import {describe,expect,it} from "vitest"
import {reviewHistoricalAddenda,findHistoricalStagingRisks} from "./delegation-addenda.js"
import type {HistoricalVersion} from "./historical-utils.js"

const raw = {법령:{부칙:{부칙단위:[
 {부칙공포번호:"21066",부칙공포일자:"20251001",부칙내용:["제1조(시행일) 이 법은 공포한 날부터 시행한다.","제2조(적용례) 제249조의7제1항은 계약 이후 적용한다."]},
 {부칙공포번호:"20000",부칙공포일자:"20241119",부칙내용:["제3조(경과조치) 제249조의70의 종전 규정에 따른다."]},
 {부칙공포번호:"19000",부칙공포일자:"20231201",부칙내용:["제5조(경과조치) 기존 제249조의7 규정에 관한 사항은 종전 규정에 따른다."]},
]}}}

describe("historical addenda audit",()=>{
 it("retains exact article signals, excludes branch-prefix false positives",()=>{
  const r=reviewHistoricalAddenda(raw,"제249조의7","21066")
  expect(r.status).toBe("evidence_found")
  expect(r.totalUnits).toBe(3)
  expect(r.articleMentions).toBe(2)
  expect(r.excerpts.some(v=>v.excerpt.includes("제249조의70"))).toBe(false)
  expect(r.excerpts.some(v=>v.excerpt.includes("제249조의7"))).toBe(true)
 })
 it("does not claim there are no transitional provisions when direct mentions are absent",()=>{
  const r=reviewHistoricalAddenda(raw,"제271조의10","21066")
  expect(r.articleMentions).toBe(0)
  expect(r.status).toBe("evidence_found")
  expect(r.excerpts[0].signal).toBe("selected_promulgation")
 })
 it("returns explicitly unverified for absent addenda structure",()=>{
  expect(reviewHistoricalAddenda({법령:{}},"제249조의7","21066").status).toBe("not_verified")
  expect(reviewHistoricalAddenda(null,"제249조의7","21066").status).toBe("not_verified")
 })
 it("bounds evidence excerpts and counts omitted relevant candidates",()=>{
  const many={법령:{부칙:{부칙단위:Array.from({length:17},(_,i)=>({
   부칙공포번호:String(100+i),부칙내용:["제1조의2 제249조의7 적용례","제3조 제249조의7 경과조치"],
  }))}}}
  const r=reviewHistoricalAddenda(many,"제249조의7","100",3)
  expect(r.excerpts).toHaveLength(3)
  expect(r.omitted).toBeGreaterThan(0)
 })
})
const base:HistoricalVersion={mst:"277365",efYd:"20251001",ancNo:"21066",ancYd:"20251001",lawNm:"Test",rrCls:"일부개정"}
describe("staged effective slice risks",()=>{
 it("detects same MST different dates and promulgated-but-future slices",()=>{
  const history=[base,{...base,efYd:"20251201"},{...base,mst:"290000",efYd:"20260101",ancYd:"20250910"}]
  const r=findHistoricalStagingRisks(history,base,"20251021")
  expect(r.some(v=>v.kind==="same_mst_slices")).toBe(true)
  expect(r.some(v=>v.kind==="published_future_change")).toBe(true)
 })
 it("does not manufacture a staging issue in a single-version record",()=>{
  expect(findHistoricalStagingRisks([base],base,"20251021")).toEqual([])
 })
})
