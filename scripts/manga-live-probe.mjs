// Node/canvas fixture probe. Explicit opt-in: RUN_MANGA_LIVE=1 node scripts/manga-live-probe.mjs
// One call per fixture, no retries. Without opt-in, replay existing review JSON only.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require('/tmp/manga-node-canvas/node_modules/canvas');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const U=require(root+'/shared.js');
if (!globalThis.crypto) globalThis.crypto=webcrypto;
const live=process.env.RUN_MANGA_LIVE==='1';
const output='/workspace/kt-manga-review';fs.mkdirSync(output,{recursive:true});
// Never read credentials on the default, offline path.
const key=live ? fs.readFileSync('/home/box/.secrets/deepseek_api_key','utf8').trim() : '';
const worker=fs.readFileSync(root+'/background.js','utf8');
const sandbox={crypto:webcrypto,AbortController,setTimeout,clearTimeout,DeepSeekTranslatorUtils:U,
  loadSettings:async()=>({deepseekApiKey:key,targetLanguage:'zh-CN'})};
vm.createContext(sandbox);
vm.runInContext(worker.slice(worker.indexOf('const mangaSessions'),worker.indexOf('chrome.runtime.onMessage.addListener'))+'\nglobalThis.handle=mangaMessage;',sandbox);
const sender={tab:{id:1},frameId:0};
let calls=0;
const fixtures=['sample-page-ja','fixture-vertical-ja','fixture-small-dual-ja','fixture-complex-bg-ja'];
const reports=[];
for (const name of fixtures) {
  const filename=path.join(root,'testdata/manga',name+'.png');
  const img=await loadImage(filename), canvas=createCanvas(img.width,img.height),ctx=canvas.getContext('2d');
  ctx.drawImage(img,0,0);
  const before=ctx.getImageData(0,0,img.width,img.height);
  let bubbles;
  if (live) {
    const {token}=await sandbox.handle({type:'MANGA_BEGIN'},sender);
    const image='data:image/png;base64,'+fs.readFileSync(filename).toString('base64');
    const {layout,hash}=await sandbox.handle({type:'MANGA_HASH',token,image,layout:name},sender);
    calls++;
    const response=await sandbox.handle({type:'MANGA_TRANSLATE',confirmed:true,token,image,layout,hash,width:img.width,height:img.height},sender);
    bubbles=response.bubbles;
    fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify({bubbles},null,2));
  } else {
    bubbles=JSON.parse(fs.readFileSync(path.join(output,name+'.json'),'utf8')).bubbles;
  }
  const result=U.mangaDraw(ctx,bubbles,img.width,img.height);
  fs.writeFileSync(path.join(output,name+'-translated.png'),canvas.toBuffer('image/png'));
  const after=ctx.getImageData(0,0,img.width,img.height);
  let darkBefore=0,darkAfter=0,changed=0;
  // Whole lower art band: require exact preservation, not just a similar mass.
  if(name==='sample-page-ja') {
    for(let y=Math.floor(img.height*.72);y<img.height;y++)for(let x=0;x<img.width;x++) {
      const i=(y*img.width+x)*4;
      if(Math.max(...before.data.slice(i,i+3))<100)darkBefore++;
      if(Math.max(...after.data.slice(i,i+3))<100)darkAfter++;
      if(before.data.slice(i,i+4).some((v,n)=>v!==after.data[i+n]))changed++;
    }
    assert.ok(darkBefore>100,'fixture contains lower stick figure/art');
    assert.equal(changed,0,'lower stick figure/art band preserved pixel-for-pixel');
  }
  const report={fixture:name,...result,darkBefore,darkAfter,artPixelsChanged:changed};
  reports.push(report);
  console.log(JSON.stringify({fixture:name,painted:result.painted,skipped:result.skipped.map(s=>s.reason),darkBefore,darkAfter,artPixelsChanged:changed}));
  if(name==='sample-page-ja')assert.equal(result.painted,2,'sample page must paint both bubbles');
}
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({mode:live?'live':'offline replay',calls,reports},null,2));
console.log(`OK: ${live?'live':'offline replay'}; provider calls=${calls}; review PNGs: ${output}`);
