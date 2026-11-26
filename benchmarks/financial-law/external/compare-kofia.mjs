import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function indexVersion(pages,version){
 if(!Array.isArray(pages)||!pages.length||!/^\d+$/.test(String(version)))throw Error("empty capture or invalid version");
 const f=pages[0],url="https://law.kofia.or.kr/service/law/lawFullScreenContent.do?historySeq="+version+"&seq=140";
 if(f.url!==url||!/^[a-f0-9]{64}$/.test(f.document_id)||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error("source mismatch");
 let next=0;const chunks=[];
 for(const [i,p] of pages.entries()){
  if(p.status!=="ok"||p.mode!=="FULL"||p.truncated!==false||p.url!==url||p.document_id!==f.document_id||p.sha256!==f.sha256||p.total_chunks!==f.total_chunks||!Array.isArray(p.chunks)||!p.chunks.length||!Number.isInteger(next)||p.chunks.some((c,k)=>c.id!==next+k||typeof c.text!=="string"))throw Error("page mismatch");
  chunks.push(...p.chunks);next=p.next_cursor;
  if(i===pages.length-1?(next!==null||p.selection_complete!==true):(next!==chunks.length||p.selection_complete!==false))throw Error("cursor mismatch");
 }
 if(chunks.length!==f.total_chunks||chunks[0].text!=="증권 인수업무 등에 관한 규정")throw Error("incomplete or wrong title");
 const start=chunks.findIndex(c=>/^\s*제1장\s+총칙/.test(c.text)),end=chunks.findIndex((c,i)=>i>start&&/^\s*부\s*칙(?:\s|\(|$)/.test(c.text)),attachment=chunks.findIndex((c,i)=>i>end&&c.text==="[별표/서식 파일]");
 if(start<0||end<0||attachment<0)throw Error("missing structure");
 const articles=[];
 for(let i=start+1;i<end;i++){
  const m=/^\s*(?:\|\s*)?(제\d+조(?:의\d+)?)\s*\(([^)\n]+)\)\s*(?:\|)?\s*$/.exec(chunks[i].text);
  if(m){if(articles.some(a=>a.article===m[1]))throw Error("duplicate article");articles.push({article:m[1],title:m[2],start:i,end:i});}
 }
 if(!articles.length||articles[0].article!=="제1조")throw Error("no articles");
 for(let i=0;i<articles.length;i++){const a=articles[i];a.end=(articles[i+1]?.start??end)-1;a.body=chunks.slice(a.start+1,a.end+1).map(c=>c.text).filter(t=>!/^제\d+장\s|^제\d+절\s/.test(t)).join("\n");}
 return {version:String(version),documentId:f.document_id,sourceHashReported:f.sha256,chunkCount:chunks.length,articles,addenda:{start:end,end:attachment-1},attachments:chunks.slice(attachment+1).map(c=>({id:c.id,name:c.text,verified:false})),lastAmendment:chunks.slice(0,start).filter(c=>/^개정\s+\d{4}/.test(c.text)).at(-1)?.text??null};
}
export function compareVersions(oldDoc,newDoc){
 const old=new Map(oldDoc.articles.map(a=>[a.article,a])),current=new Map(newDoc.articles.map(a=>[a.article,a])),norm=s=>s.normalize("NFC").replace(/\s+/g,"");
 const added=newDoc.articles.filter(a=>!old.has(a.article)).map(a=>({article:a.article,title:a.title,newRange:[a.start,a.end]}));
 const removed=oldDoc.articles.filter(a=>!current.has(a.article)).map(a=>({article:a.article,title:a.title,oldRange:[a.start,a.end]}));
 const changed=newDoc.articles.filter(a=>old.has(a.article)&&(norm(a.body)!==norm(old.get(a.article).body)||norm(a.title)!==norm(old.get(a.article).title))).map(a=>({article:a.article,title:a.title,oldRange:[old.get(a.article).start,old.get(a.article).end],newRange:[a.start,a.end]}));
 return {added,removed,changed,unchanged:newDoc.articles.length-added.length-changed.length,scope:"Literal extracted text comparison; whitespace normalized, chapter headings excluded, amendment annotations retained. Not legal interpretation. Attachments names only."};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const [oldId,newId,...files]=process.argv.slice(2);if(!oldId||!newId||files.length!==4)throw Error("Usage: node compare-kofia.mjs OLD_ID NEW_ID OLD_PAGE1 OLD_PAGE2 NEW_PAGE1 NEW_PAGE2");const p=files.map(f=>JSON.parse(readFileSync(f,"utf8")));const a=indexVersion(p.slice(0,2),oldId),b=indexVersion(p.slice(2),newId);console.log(JSON.stringify({old:a.version,new:b.version,oldCount:a.articles.length,newCount:b.articles.length,...compareVersions(a,b)},null,2));}
