/** Offline inspection using the runtime's pinned kordoc dependency; not publisher verification. */
import {readFile, stat} from 'node:fs/promises';
import {basename, extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {parse, VERSION} from 'kordoc';

const MAX_BYTES=32*1024*1024, MAX_TEXT=2_000_000;
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={'.hwp':'hwp','.hwpx':'hwpx','.pdf':'pdf'};
export async function inspectAttachment(path){
  const result={filename:basename(path),status:'UNVERIFIED',sourceVerified:false,layoutVerified:false,legalEffectVerified:false,extractor:'kordoc',extractorVersion:VERSION};
  const fail=reason=>({...result,reason});
  try{
    const info=await stat(path);if(!info.isFile()||info.size>MAX_BYTES)return fail('missing file or byte limit');
    const raw=await readFile(path);if(raw.length>MAX_BYTES)return fail('byte limit');
    Object.assign(result,{bytes:raw.length,sha256:sha(raw)});
    const kind=expected[extname(path).toLowerCase()];if(!kind)return fail('unsupported extension');
    const signature=kind==='hwp'?raw.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')):kind==='hwpx'?raw.subarray(0,4).equals(Buffer.from('504b0304','hex')):raw.subarray(0,5).toString()==='%PDF-';
    if(!signature)return fail('signature mismatch');
    const parsed=await parse(raw,{ocr:false,images:false,layoutTables:'keep',keepTrailingEmptyCols:true,removeHeaderFooter:false,scriptTags:false});
    if(!parsed.success||parsed.fileType!==kind)return fail('parse failure or detected format mismatch');
    const text=parsed.markdown;
    if(typeof text!=='string'||!text.trim()||text.length>MAX_TEXT||parsed.isImageBased)return fail('empty, image-based or oversized text');
    if(/자세한\s*내용은[\s\S]{0,120}?(?:다운로드|주소창)/.test(text)&&text.length<600)return fail('possible download notice only');
    const tables=[];let blockCount=0;
    function visit(blocks,location,depth=0){
      if(depth>24)throw Error('block nesting limit');
      for(const [i,b] of (blocks??[]).entries()){
        if(++blockCount>100000)throw Error('block limit');
        const loc=location+'/'+i;
        if(b.table){
          const t=b.table;
          if(!Number.isInteger(t.rows)||!Number.isInteger(t.cols)||t.rows<1||t.cols<1||t.rows*t.cols>100000||!Array.isArray(t.cells))throw Error('table limit or invalid grid');
          tables.push({location:loc,page:b.pageNumber??null,rows:t.rows,cols:t.cols,cells:t.cells.map(row=>row.map(c=>({text:c.text,colSpan:c.colSpan,rowSpan:c.rowSpan}))) });
          for(const [ri,row] of t.cells.entries())for(const [ci,cell] of row.entries())visit(cell.blocks,loc+'/cell/'+ri+'/'+ci,depth+1);
          visit(t.captionBlocks,loc+'/caption',depth+1);
        }
        visit(b.children,loc+'/children',depth+1);visit(b.footnoteBlocks,loc+'/footnote',depth+1);
      }
    }
    visit(parsed.blocks,'blocks');
    const warnings=(parsed.warnings??[]).map(w=>({code:w.code??null,message:w.message,page:w.page??null}));
    if(JSON.stringify(tables).length>MAX_TEXT)return fail('table output limit');
    return {...result,status:warnings.length?'TEXT_EXTRACTED_LOCAL_WITH_WARNINGS':'TEXT_EXTRACTED_LOCAL',format:parsed.fileType,textChars:text.length,textSha256:sha(text),text,tables,pageCount:parsed.pageCount??null,pageMode:parsed.metadata?.pageMode??null,warnings,notice:'Local extraction only. Official version, visual layout, all cells/pages, and legal effect remain unverified.'};
  }catch(e){return fail('inspection failed: '+String(e).slice(0,200));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3)throw Error('Usage: node inspect-attachment.mjs FILE');
  const result=await inspectAttachment(process.argv[2]);console.log(JSON.stringify(result,null,2));if(result.status==='UNVERIFIED')process.exitCode=1;
}
