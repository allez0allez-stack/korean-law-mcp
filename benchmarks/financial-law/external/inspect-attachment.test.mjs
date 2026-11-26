import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {markdownToHwpx} from 'kordoc';
import CFB from 'cfb';
import {inspectAttachment} from './inspect-attachment.mjs';

async function withFile(name,bytes,fn){const dir=await mkdtemp(join(tmpdir(),'annex-'));try{const path=join(dir,name);await writeFile(path,bytes);await fn(path)}finally{await rm(dir,{recursive:true,force:true})}}
function syntheticHwp(){const c=CFB.utils.cfb_new(),header=Buffer.alloc(256);header.write('HWP Document File');header[35]=5;CFB.utils.cfb_add(c,'FileHeader',header);function rec(tag,level,data){const h=Buffer.alloc(4);h.writeUInt32LE(tag|(level<<10)|(data.length<<20));return Buffer.concat([h,data])}const txt=Buffer.from('합성 검증용 본문 123\r','utf16le'),para=Buffer.alloc(22);para.writeUInt32LE(txt.length/2);CFB.utils.cfb_add(c,'BodyText/Section0',Buffer.concat([rec(66,0,para),rec(67,1,txt)]));return CFB.write(c,{type:'buffer'})}
function minimalPdf(){const stream='BT /F1 12 Tf 72 720 Td (Synthetic PDF annex 456) Tj ET\n';const objs=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,obj] of objs.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`}const x=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;return Buffer.from(pdf)}
const extracted=r=>assert.ok(r.status.startsWith('TEXT_EXTRACTED_LOCAL'),JSON.stringify(r));
test('real parser reads synthetic OLE HWP5 Korean text',async()=>{const bytes=syntheticHwp();await withFile('test.hwp',bytes,async p=>{const r=await inspectAttachment(p);extracted(r);assert.equal(r.format,'hwp');assert.match(r.text,/합성 검증용 본문 123/);assert.equal(r.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(r.sourceVerified,false);assert.equal(r.legalEffectVerified,false)})});
test('real HWPX parser preserves synthetic table coordinates and text',async()=>{const b=Buffer.from(await markdownToHwpx('# 합성 검증\n\n| 항목 | 값 |\n| --- | --- |\n| 기준 | 123 |'));await withFile('table.hwpx',b,async p=>{const r=await inspectAttachment(p);extracted(r);assert.equal(r.format,'hwpx');assert.equal(r.tables.length,1);assert.equal(r.tables[0].rows,2);assert.equal(r.tables[0].cols,2);assert.equal(r.tables[0].cells[1][1].text,'123');assert.equal(r.layoutVerified,false)})});
test('real parser reads synthetic PDF',async()=>{await withFile('test.pdf',minimalPdf(),async p=>{const r=await inspectAttachment(p);extracted(r);assert.match(r.text,/Synthetic PDF annex 456/);assert.equal(r.format,'pdf')})});
test('rejects HTML disguised as HWP',async()=>withFile('error.hwp',Buffer.from('<html>502</html>'),async p=>assert.equal((await inspectAttachment(p)).status,'UNVERIFIED')));
test('rejects corrupt OLE despite correct signature',async()=>withFile('fake.hwp',Buffer.from('d0cf11e0a1b11ae1','hex'),async p=>assert.equal((await inspectAttachment(p)).status,'UNVERIFIED')));
test('rejects corrupt PDF',async()=>withFile('bad.pdf',Buffer.from('%PDF-1.4\nbroken'),async p=>assert.equal((await inspectAttachment(p)).status,'UNVERIFIED')));
test('rejects HWPX renamed to PDF',async()=>withFile('fake.pdf',Buffer.from(await markdownToHwpx('테스트')),async p=>assert.equal((await inspectAttachment(p)).status,'UNVERIFIED')));
test('rejects unsupported extension',async()=>withFile('fake.txt',Buffer.from('sample'),async p=>assert.equal((await inspectAttachment(p)).status,'UNVERIFIED')));
