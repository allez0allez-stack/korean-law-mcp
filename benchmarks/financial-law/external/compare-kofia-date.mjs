import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
export function validDate(d){if(typeof d!=="string"||!/^\d{8}$/.test(d))return false;const y=+d.slice(0,4),m=+d.slice(4,6),day=+d.slice(6,8),dt=new Date(Date.UTC(y,m-1,day));return y>=1900&&dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===day}
export function validateSource(g,pages){
 const c=pages.flatMap(p=>p.chunks);
 if(pages.length!==2||pages.some(p=>p.status!=="ok"||p.mode!=="FULL"||p.truncated!==false||p.url!==g.source||p.document_id!==g.documentId||p.sha256!==g.sourceHashReported||p.total_chunks!==c.length)||pages[0].next_cursor!==pages[0].chunks.length||pages[1].next_cursor!==null||!pages[1].selection_complete||c.length!==774||c.some((x,i)=>x.id!==i))throw Error("source capture mismatch");
 const seen=new Set();
 for(const i of g.items){if(seen.has(i.id)||!i.required.length||!i.required.every(v=>c[i.chunk]?.text.includes(v))||!c[i.headingChunk]?.text.startsWith("제")||!["lte","gte"].includes(i.operator)||!validDate(i.boundary)||!["first_securities_registration","kosdaq_listing"].includes(i.event))throw Error("predicate evidence mismatch "+i.id);seen.add(i.id)}
 return c;
}
export function compareDate(item,event,date){
 const base={id:item.id,chunk:item.chunk,scope:"DATE_PREDICATE_ONLY",legalEffectVerified:false,additionalConditionsResolved:false,caveat:item.caveat};
 if(event!==item.event||!validDate(date))return {...base,status:"UNRESOLVED",reason:"event mismatch or invalid date"};
 if(!validDate(item.boundary)||!["lte","gte"].includes(item.operator))throw Error("invalid predicate");
 return {...base,status:(item.operator==="lte"?date<=item.boundary:date>=item.boundary)?"DATE_MATCH":"DATE_NOT_MATCH",event,date,boundary:item.boundary,operator:item.operator};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [gold,page1,page2,id,event,date]=process.argv.slice(2);if(!date)throw Error("Usage: node compare-kofia-date.mjs GOLD PAGE1 PAGE2 ID EVENT YYYYMMDD");const read=p=>JSON.parse(readFileSync(p,"utf8"));const g=read(gold);const c=validateSource(g,[read(page1),read(page2)]);const item=g.items.find(x=>x.id===id);if(!item)throw Error("unknown predicate");console.log(JSON.stringify({...compareDate(item,event,date),source:g.source,evidence:c[item.chunk].text},null,2));}
