import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function evaluate(gold, captures) {
  if (gold.schemaVersion !== 1 || !Array.isArray(gold.cases) || !gold.cases.length) throw new Error("Unsupported or empty gold dataset");
  const rows = new Map();
  for (const cap of captures) {
    if (cap.baseline !== gold.baseline) throw new Error("Capture baseline does not match gold");
    for (const row of cap.results) {
      if (rows.has(row.id)) throw new Error("Duplicate capture: "+row.id);
      if (!["ok","tool_error"].includes(row.status) || typeof row.text!=="string" || !Number.isFinite(row.elapsedMs) || row.elapsedMs<0) throw new Error("Invalid capture: "+row.id);
      rows.set(row.id,row);
    }
  }
  const ids = new Set();
  const cases = gold.cases.map(c=>{
    if(ids.has(c.id)||!c.checks.length)throw new Error("Duplicate or empty case: "+c.id);
    ids.add(c.id);
    const row=rows.get(c.id);
    const negative=c.checks.some(x=>x.kind==="negative");
    const body=row?.status==="tool_error"?row.text.replaceAll("\\n","\n"):row?.text??"";
    const lines=body.normalize("NFC").split(/\r?\n/).map(l=>l.trimStart());
    const usable=!!row&&body.length>0&&(negative?body.includes("[HALLUCINATION_DETECTED]"):row.status==="ok");
    const keys=new Set();
    const checks=c.checks.map(ch=>{
      if(keys.has(ch.id)||!["positive","negative"].includes(ch.kind)||!Array.isArray(ch.all)||!ch.all.length||ch.all.some(v=>typeof v!=="string"||!v.length)||ch.absent&&ch.kind!=="negative")throw new Error("Invalid check "+c.id+"/"+ch.id);
      keys.add(ch.id);
      const prefixes=Array.isArray(ch.prefix)?ch.prefix:[ch.prefix];
      if(!prefixes.length||prefixes.some(v=>typeof v!=="string"))throw new Error("Invalid prefix "+c.id+"/"+ch.id);
      const line=lines.find(l=>prefixes.some(p=>l.startsWith(p))&&ch.all.every(v=>l.includes(v.normalize("NFC"))));
      return {id:ch.id,kind:ch.kind,absent:!!ch.absent,pass:usable&&!ch.absent&&!!line,evidence:line??null};
    });
    const rejectConfirmed=checks.some(ch=>ch.kind==="negative"&&!ch.absent&&ch.pass);
    const positiveConfirmed=checks.filter(ch=>ch.kind==="positive").every(ch=>ch.pass);
    for(const ch of checks)if(ch.absent)ch.pass=usable&&rejectConfirmed&&positiveConfirmed&&!ch.evidence;
    return {id:c.id,topic:c.topic,status:row?.status??"missing",elapsedMs:row?.elapsedMs??null,usable,pass:checks.every(ch=>ch.pass),partial:body.includes("[PARTIAL]"),truncated:/응답이 너무 길어|응답이 잘렸|자로 잘렸|…\(생략\)/.test(body),checks};
  });
  for(const id of rows.keys())if(!ids.has(id))throw new Error("Unexpected capture: "+id);
  const checks=cases.flatMap(c=>c.checks), pos=checks.filter(c=>c.kind==="positive"),neg=checks.filter(c=>c.kind==="negative");
  const elapsed=cases.map(c=>c.elapsedMs).filter(x=>x!==null).sort((a,b)=>a-b), totalMs=elapsed.reduce((a,b)=>a+b,0);
  return {schemaVersion:1,asOf:gold.asOf,baseline:gold.baseline,metrics:{cases:cases.length,casesPassed:cases.filter(c=>c.pass).length,captures:elapsed.length,usableCaptures:cases.filter(c=>c.usable).length,checks:checks.length,checksPassed:checks.filter(c=>c.pass).length,positiveExpected:pos.length,positiveMatched:pos.filter(c=>c.pass).length,negativeExpected:neg.length,negativeMatched:neg.filter(c=>c.pass).length,partialCases:cases.filter(c=>c.partial).length,truncatedCases:cases.filter(c=>c.truncated).length,totalMs,medianMs:elapsed.length?(elapsed[Math.floor((elapsed.length-1)/2)]+elapsed[Math.floor(elapsed.length/2)])/2:null},limitations:["Fixed selected assertions, not exhaustive precision/recall or legal validity.","Same official provider, separately fetched direct source excerpts; no independent expert adjudication.","Partial/truncation flags do not disappear when selected assertions pass.","Latency is one sequential live sample, not a controlled or cold-cache comparison."],cases};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [goldPath, ...capturePaths] = process.argv.slice(2);
  if (!goldPath || !capturePaths.length) throw new Error("Usage: node evaluate.mjs GOLD CAPTURE [CAPTURE...]");
  const read = path => JSON.parse(readFileSync(path, "utf8"));
  const report = evaluate(read(goldPath), capturePaths.map(read));
  console.log(JSON.stringify(report, null, 2));
  if (report.metrics.casesPassed !== report.metrics.cases) process.exitCode = 1;
}
