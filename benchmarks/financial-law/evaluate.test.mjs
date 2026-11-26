import test from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./evaluate.mjs";

const positive={id:"valid",kind:"positive",prefix:"✓ ",all:["상법 제513조","실존"]};
const reject={id:"reject",kind:"negative",prefix:"✗ ",all:["상법 제9999조","[NOT_FOUND]"]};
const noFalse={id:"no-false",kind:"negative",prefix:"✓ ",all:["상법 제9999조"],absent:true};
const gold=(checks=[positive])=>({schemaVersion:1,asOf:"2026-11-26",baseline:"base",cases:[{id:"C1",topic:"test",checks}]});
const cap=(text,status="ok")=>({baseline:"base",results:[{id:"C1",status,elapsedMs:100,text}]});
const valid="✓ 상법 제513조(전환사채의 발행) 실존";
const invalid="✗ 상법 제9999조 — [NOT_FOUND] 해당 조문 없음";
const mixed="[HALLUCINATION_DETECTED]\n"+valid+"\n"+invalid;

test("passes exact selected evidence and preserves partial/truncated flags",()=>{
  const r=evaluate(gold(),[cap(valid+"\n[PARTIAL]\n응답이 너무 길어 1,000자로 잘렸습니다.")]);
  assert.equal(r.metrics.checksPassed,1);assert.equal(r.metrics.partialCases,1);assert.equal(r.metrics.truncatedCases,1);
});
test("does not match evidence spanning distinct lines or unverified markers",()=>{
  for(const s of ["✓ 상법 제513조\n실존","[NOT_VERIFIED] 상법 제513조 실존"]){
    assert.equal(evaluate(gold(),[cap(s)]).metrics.checksPassed,0);
  }
});
test("scores an explicit mixed citation rejection, including a connector error envelope",()=>{
  for(const c of [cap(mixed),cap(mixed.replaceAll("\n","\\n"),"tool_error")]){
    const r=evaluate(gold([positive,reject,noFalse]),[c]);assert.equal(r.metrics.checksPassed,3);
  }
});
test("generic connector errors cannot pass rejection or absence assertions",()=>{
  const r=evaluate(gold([positive,reject,noFalse]),[cap("HTTP 429", "tool_error")]);
  assert.equal(r.metrics.checksPassed,0);assert.equal(r.metrics.usableCaptures,0);
});
test("missing rejection or wrongly promoted invalid article fails",()=>{
  const a=evaluate(gold([positive,reject,noFalse]),[cap("[HALLUCINATION_DETECTED]\n"+valid)]);
  assert.equal(a.metrics.negativeMatched,0);
  const b=evaluate(gold([positive,reject,noFalse]),[cap(mixed+"\n✓ 상법 제9999조 실존")]);
  assert.equal(b.metrics.casesPassed,0);assert.equal(b.metrics.negativeMatched,1);
});
test("missing capture is not a pass",()=>{
  const r=evaluate(gold(),[]);assert.equal(r.metrics.casesPassed,0);assert.equal(r.metrics.captures,0);
});
test("rejects wrong baseline, duplicate and unexpected captures",()=>{
  assert.throws(()=>evaluate(gold(),[{...cap(valid),baseline:"other"}]),/baseline/);
  assert.throws(()=>evaluate(gold(),[cap(valid),cap(valid)]),/Duplicate capture/);
  assert.throws(()=>evaluate(gold(),[{...cap(valid),results:[{...cap(valid).results[0],id:"unknown"}]}]),/Unexpected capture/);
});
test("rejects malformed expectations and capture metadata",()=>{
  assert.throws(()=>evaluate(gold([{...positive,all:[]}]),[cap(valid)]),/Invalid check/);
  assert.throws(()=>evaluate(gold([positive,positive]),[cap(valid)]),/Invalid check/);
  assert.throws(()=>evaluate(gold(),[{baseline:"base",results:[{...cap(valid).results[0],elapsedMs:-1}]}]),/Invalid capture/);
});

test("detects an abbreviated applicable-law article even when selected checks pass",()=>{
  const r=evaluate(gold(),[cap(valid+"\n…(생략)")]);
  assert.equal(r.metrics.checksPassed,1);assert.equal(r.metrics.truncatedCases,1);
});
