import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
export async function checkMangaMvp(root) {
  const U=createRequire(import.meta.url)(root+'/shared.js');
  const good={bbox:[10,10,50,50],confidence:.98,translation:'你好'};
  assert.deepEqual(U.mangaBox(good,100,100),good.bbox);
  for(const bbox of [[0,0,100,100],[-20,0,20,20],[20,20,10,30],[NaN,0,20,20]])assert.equal(U.mangaBox({...good,bbox},100,100),null);
  assert.equal(U.mangaBox({...good,confidence:.6},100,100),null);
  const pixels=new Uint8ClampedArray(40*40*4).fill(255);
  assert.equal(U.mangaWhiteRegion(pixels,40,40),true);
  pixels[0]=0;assert.equal(U.mangaWhiteRegion(pixels,40,40),false);
  const paint=[];
  const ctx={getImageData:()=>({data:new Uint8ClampedArray(40*40*4).fill(255)}),measureText:t=>({width:t.length*10}),fillRect:(...a)=>paint.push(a),fillText:()=>{}};
  assert.equal(U.mangaDraw(ctx,[good,{...good,confidence:.1}],100,100),1);
  assert.equal(paint.length,1);
  let requests=0, responder=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({bubbles:[good]})}}]})});
  // Isolate the real worker handler with inert browser hooks; no network/keys.
  const source=fs.readFileSync(root+'/background.js','utf8');
  const section=source.slice(source.indexOf('const mangaSessions'),source.indexOf('chrome.runtime.onMessage.addListener'));
  const sandbox={crypto:webcrypto,TextEncoder,AbortController,setTimeout,clearTimeout,
    DeepSeekTranslatorUtils:{...U,fetchWithTimeout:(...args)=>sandbox.fetch(...args),mangaHash:async s=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex')},
    loadSettings:async()=>({deepseekApiKey:'fixture-only',targetLanguage:'zh-CN'}),
    fetch:async(...args)=>{requests++;return responder(...args);},
    chrome:{tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}},query:async()=>[{id:1}],captureVisibleTab:async()=> 'data:image/png;base64,AA=='}}};
  vm.createContext(sandbox);vm.runInContext(section+'\nglobalThis.handler=mangaMessage;globalThis.cache=mangaCache;',sandbox);
  const sender={tab:{id:1,windowId:2},frameId:0};
  const call=m=>sandbox.handler(m,sender);
  const begin=()=>call({type:'MANGA_BEGIN'});
  const image='data:image/png;base64,AA==',layout='fixture';
  const hash=await sandbox.DeepSeekTranslatorUtils.mangaHash(image+layout);
  const message=token=>({type:'MANGA_TRANSLATE',token,confirmed:true,image,width:100,height:100,layout,hash});
  let {token}=await begin();
  await call({type:'MANGA_CAPTURE',token});assert.equal(requests,0,'capture never uploads');
  await assert.rejects(call({...message(token),confirmed:false}));assert.equal(requests,0,'no consent, no upload');
  await call({type:'MANGA_CANCEL',token});await assert.rejects(call(message(token)));assert.equal(requests,0);
  ({token}=await begin());await assert.rejects(call({...message(token),hash:'wrong'}));assert.equal(requests,0);
  ({token}=await begin());await assert.rejects(sandbox.handler(message(token),{tab:{id:1},frameId:1}));
  await call(message(token));assert.equal(requests,1);assert.equal(sandbox.cache.size,1);
  ({token}=await begin());await call(message(token));assert.equal(requests,1,'successful crop cached');
  sandbox.cache.clear();
  responder=async()=>({ok:false,status:503});({token}=await begin());await assert.rejects(call(message(token)));assert.equal(sandbox.cache.size,0,'failure not cached');
  let release;responder=()=>new Promise(r=>{release=r;});({token}=await begin());
  const pending=call(message(token));
  while(!release)await new Promise(r=>setTimeout(r,0));
  await begin();release({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({bubbles:[good]})}}]})});
  await assert.rejects(pending,/失效/);assert.equal(sandbox.cache.size,0,'late response not cached');
  responder=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({bubbles:[good]})}}]})});
  for(let i=0;i<10;i++){
    ({token}=await begin());const m={...message(token),layout:'layout'+i};m.hash=await sandbox.DeepSeekTranslatorUtils.mangaHash(image+m.layout);await call(m);
  }
  assert.equal(sandbox.cache.size,8,'bounded cache');
  const content=fs.readFileSync(root+'/manga-content.js','utf8');
  assert.match(content,/if\(!event.isTrusted/);
  assert.match(content,/result.hash!==hash/);
  assert.match(content,/ctx.drawImage\(img,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height\)/);
  console.log('OK: manga bbox/pixel rendering, local capture/cancel privacy, consent/hash/frame validation, stale response rejection, bounded success-only cache (offline; no vision API called)');
}
