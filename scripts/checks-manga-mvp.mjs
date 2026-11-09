import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixturePixels} from './manga-fixture-pixels.mjs';
export async function checkMangaMvp(root) {
  const U=createRequire(import.meta.url)(root+'/shared.js');
  const good={bbox:[10,10,50,50],confidence:.98,translation:'你好'};
  assert.deepEqual(U.mangaBox(good,100,100),good.bbox);
  for(const bbox of [[0,0,100,100],[-20,0,20,20],[20,20,10,30],[NaN,0,20,20]])assert.equal(U.mangaBox({...good,bbox},100,100),null);
  assert.equal(U.mangaBox({...good,confidence:.6},100,100),null);
  const pixels=new Uint8ClampedArray(40*40*4).fill(255);
  const dark=(data,x,y,w=40,color=[0,0,0])=>data.set([...color,255],(y*w+x)*4);
  assert.equal(U.mangaWhiteRegion(pixels,40,40),true);
  dark(pixels,0,0);
  assert.equal(U.mangaWhiteRegion(pixels,40,40),true,'isolated edge ink no longer rejects tight boxes');
  // Sparse glyph strokes touch the top edge: the former 100% perimeter gate failed.
  for(let y=0;y<14;y++)for(const x of [10,20,30])dark(pixels,x,y);
  assert.equal(U.mangaWhiteRegion(pixels,40,40),true,'tight synthetic text box passes mostly-white perimeter');
  const before=new Uint8ClampedArray(pixels);
  const paint=[],text=[];
  const ctx={getImageData:()=>({data:new Uint8ClampedArray(pixels)}),measureText:t=>({width:t.length*10}),
    putImageData:region=>paint.push(region.data),fillRect:()=>assert.fail('whole-box erasure is forbidden'),fillText:t=>text.push(t)};
  assert.equal(U.mangaDraw(ctx,[good],100,100).painted,1,'tight box paints');
  assert.equal(paint.length,1);assert.ok(text.length>0);
  assert.equal(before[(5*40+10)*4],0);
  assert.equal(paint[0][(5*40+10)*4],255,'supported dark glyph stroke selectively erased');
  assert.deepEqual(pixels,before,'selective erase reads original immutable neighborhoods');
  const outlined=new Uint8ClampedArray(40*40*4).fill(255);
  for(let x=0;x<40;x++)dark(outlined,x,0);
  assert.equal(U.mangaWhiteRegion(outlined,40,40),false,'outline-heavy perimeter remains unsafe');
  const dense=new Uint8ClampedArray(40*40*4).fill(255);
  for(let y=8;y<32;y++)for(let x=8;x<32;x++)dark(dense,x,y);
  assert.equal(U.mangaWhiteRegion(dense,40,40),false,'white perimeter cannot excuse a dark interior');
  const art=new Uint8ClampedArray(80*80*4).fill(255);
  // A long outline, a colored detail, and a large dark patch must survive.
  for(let x=5;x<75;x++)dark(art,x,10,80);
  dark(art,20,25,80,[180,20,20]);
  for(let y=40;y<65;y++)for(let x=40;x<65;x++)dark(art,x,y,80);
  dark(art,20,30,80,[245,245,245]);
  const erased=U.mangaEraseInk(art,80,80);
  for(const [x,y] of [[30,10],[20,25],[50,50],[20,30]]) {
    const i=(y*80+x)*4;
    assert.deepEqual(erased.slice(i,i+4),art.slice(i,i+4),'preserve outline, color, unsupported dark interior and near-white background');
  }
  const corner=new Uint8ClampedArray(40*40*4).fill(255);
  for(let x=0;x<6;x++)dark(corner,x,5-x);
  // Diagonal pixels connect only through orthogonal neighbors in this model.
  for(let x=0;x<5;x++)dark(corner,x,4-x);
  assert.deepEqual(U.mangaEraseInk(corner,40,40),corner,'preserve clipped outline crossing two edges');
  const surface=new Uint8ClampedArray(100*100*4).fill(255);
  for(let x=14;x<=42;x+=4)for(let dx=0;dx<2;dx++)for(let y=10;y<12;y++)dark(surface,x+dx,y,100);
  const reads=[],writes=[];
  const crop=(x,y,w,h)=>{
    assert.ok(x>=0 && y>=0 && x+w<=100 && y+h<=100,'expanded crop stays in image bounds');
    reads.push([x,y,w,h]);
    const data=new Uint8ClampedArray(w*h*4);
    for(let row=0;row<h;row++)data.set(surface.slice(((y+row)*100+x)*4,((y+row)*100+x+w)*4),row*w*4);
    return {data};
  };
  const expandedCtx={...ctx,getImageData:crop,putImageData:(region,x,y)=>writes.push([x,y,region.data.length])};
  assert.equal(U.mangaWhiteRegion(crop(10,10,40,40).data,40,40),false);
  assert.equal(U.mangaDraw(expandedCtx,[good],100,100).painted,1,'small safe expansion rescues clipped glyphs');
  assert.deepEqual(writes,[[8,8,44*44*4]],'choose first safe improved perimeter');
  // Already-safe boxes retain their original bounds.
  U.mangaDraw(ctx,[good],100,100);
  assert.equal(paint.at(-1).length,40*40*4,'safe original retains original bounds');
  const priorWrites=paint.length;
  for(const pair of [[good,{...good,bbox:[30,10,60,50]}],[{...good,bbox:[30,10,60,50]},good]]) {
    const overlap=U.mangaDraw(ctx,pair,100,100);
    assert.equal(overlap.painted,0,'reject ALL involved overlap boxes before painting');
    assert.deepEqual(overlap.skipped.map(s=>s.reason),['overlap','overlap']);
  }
  assert.equal(paint.length,priorWrites,'overlap never writes even first box');
  const unreliable=U.mangaDraw(ctx,[{...good,confidence:.5}],100,100);
  assert.equal(unreliable.skipped[0].reason,'invalid-box-or-confidence');
  assert.match(U.mangaResultNote(unreliable,1),/保留完整原图/);
  assert.match(U.mangaResultNote({painted:1,skipped:[{reason:'unsafe-background'}]},2),/1\/2.*1 处/);
  const noFit=U.mangaDraw(ctx,[{...good,translation:'W'.repeat(300)}],100,100);
  assert.equal(noFit.painted,0);
  assert.equal(noFit.skipped[0].reason,'text-does-not-fit');
  const darkCtx={...ctx,getImageData:(x,y,w,h)=>{
    const data=new Uint8ClampedArray(w*h*4).fill(200);
    for(let i=3;i<data.length;i+=4)data[i]=255;
    return {data};
  }};
  const unsafe=U.mangaDraw(darkCtx,[good],100,100);
  assert.equal(unsafe.painted,0);
  assert.equal(unsafe.skipped[0].reason,'unsafe-background','expansion never buys success by loosening thresholds');
  assert.equal(paint.length,priorWrites,'zero-result paths preserve all original pixels');
  const fixture=fixturePixels(root+'/testdata/manga/sample-page-ja.png');
  const top={text:'こんにちは',translation:'你好',confidence:.99,bbox:[82,103,260,152]};
  const bottom={text:'元気？',translation:'你好吗？',confidence:.99,bbox:[242,344,380,393]};
  const [tx,ty,tr,tb]=top.bbox;
  const stats=U.mangaWhiteStats(fixture.crop(tx,ty,tr-tx,tb-ty).data,tr-tx,tb-ty);
  assert.equal(stats.perimeter,1);
  assert.ok(stats.white>=.88 && stats.interior<.88,'real fixture interior-only rejection reproduces root cause');
  const fixtureWrites=[];
  const fixtureCtx={...ctx,getImageData:fixture.crop,putImageData:(image,x,y)=>fixtureWrites.push([x,y,image.data.length])};
  const rescued=U.mangaDraw(fixtureCtx,[top,bottom],fixture.width,fixture.height);
  assert.equal(rescued.painted,2,'fixture pad rescues top despite already-perfect perimeter');
  assert.deepEqual(rescued.skipped,[]);
  assert.ok(fixtureWrites[0][0]<tx,'top used expanded region');
  const hide=U.createMangaOverlayHider(),overlay={style:{visibility:'visible'}};
  const releaseA=hide([overlay]),releaseB=hide([overlay]);
  releaseA();releaseA();assert.equal(overlay.style.visibility,'hidden','another capture still owns hide');
  releaseB();assert.equal(overlay.style.visibility,'visible','last capture restores true original value');
  const releaseC=hide([overlay]),releaseD=hide([overlay]);releaseD();releaseC();
  assert.equal(overlay.style.visibility,'visible','reverse completion order restores too');
  console.log('OK: synthetic tight box paints 1; fixture interior-only failure + pad paints 2; all overlaps rejected, skipped reasons visible, selective erase and refcount hide ownership');
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
  const longLayout='http://reader.test/'+ 'page'.repeat(5000);
  const bound=await call({type:'MANGA_HASH',token,image,layout:longLayout});
  assert.equal(bound.layout.length,64,'long HTTP layout bounded in secure worker');
  assert.equal(bound.hash,await sandbox.DeepSeekTranslatorUtils.mangaHash(image+bound.layout));
  assert.equal(requests,0,'hashing stays local and needs no content crypto.subtle');

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
  const notifications=[];
  sandbox.chrome={tabs:{sendMessage:async(id,message)=>notifications.push({id,message})}};
  sandbox.tabId=1; sandbox.changeInfo={url:'http://reader.test/next'};
  ({token}=await begin());
  // Execute the real worker URL-change branch, including its invalidation notice.
  const navStart=source.indexOf('  if (changeInfo.status === "loading" || changeInfo.url)');
  const navEnd=source.indexOf('  // Same-tab navigation',navStart);
  vm.runInContext(source.slice(navStart,navEnd),sandbox);
  assert.equal(notifications[0].message.token,token);
  assert.equal(notifications[0].message.type,'MANGA_INVALIDATE');
  await assert.rejects(call(message(token)),/失效/);
  const priorCache=sandbox.cache.size;
  responder=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({bubbles:[{...good,confidence:.4}]})}}]})});
  ({token}=await begin());
  const invalid=await call({...message(token),layout:'uncertain',hash:await sandbox.DeepSeekTranslatorUtils.mangaHash(image+'uncertain')});
  assert.equal(invalid.bubbles.length,1,'uncertain OCR entries reach UI for skip reporting');
  assert.equal(sandbox.cache.size,priorCache,'all-uncertain responses are not cached');
  const content=fs.readFileSync(root+'/manga-content.js','utf8');
  assert.match(content,/if\(!event.isTrusted/);
  assert.doesNotMatch(content,/U\.mangaHash/,'HTTP content does not hash with subtle');
  assert.match(content,/layout:layoutHash/);
  assert.match(content,/scroll[\s\S]*capture:true/);
  assert.match(content,/MANGA_INVALIDATE/);
  assert.match(source,/tabs\.sendMessage\(tabId,\{type:"MANGA_INVALIDATE",token\}/);
  assert.match(content,/U\.mangaResultNote/);

  assert.match(content,/result.hash!==hash/);
  assert.match(content,/ctx.drawImage\(img,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height\)/);
  console.log('OK: manga bbox/pixel rendering, local capture/cancel privacy, consent/hash/frame validation, stale response rejection, bounded success-only cache (offline; no vision API called)');
}
