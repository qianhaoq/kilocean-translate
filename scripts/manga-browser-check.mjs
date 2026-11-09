// Optional offline browser integration + rendering demo. No API/network calls.
// npm install --prefix /tmp/manga-browser-tools playwright-core
// PLAYWRIGHT_MODULE=/tmp/manga-browser-tools/node_modules/playwright-core/index.mjs node scripts/manga-browser-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:900,height:700}});
  await page.goto(pathToFileURL(root+'/popup.html').href);
  await page.setContent('<body style="margin:0;background:white;height:1000px">Original fixture test surface</body>');
  const fixture='data:image/png;base64,'+fs.readFileSync(root+'/testdata/manga/sample-page-ja.png').toString('base64');
  await page.evaluate(async fixture=>{
    // Keep a test-only reference to closed roots; production retains closed isolation.
    const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=attach.call(this,options);globalThis.testRoot=shadow;return shadow;};
    globalThis.calls=[];
    const c=document.createElement('canvas');c.width=900;c.height=700;
    const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,700);
    ctx.fillStyle='black';ctx.font='18px sans-serif';ctx.fillText('original',130,145);
    const capture=c.toDataURL();
    globalThis.chrome={runtime:{id:'offline',onMessage:{addListener:f=>globalThis.listener=f},sendMessage:async message=>{
      calls.push(message);
      if(message.type==='MANGA_BEGIN')return {ok:true,token:'fixture-session'};
      if(message.type==='MANGA_CAPTURE'){
        if(document.querySelector('[data-kilocean-manga]').style.visibility!=='hidden')throw new Error('overlay visible during capture');
        return {ok:true,image:capture};
      }
      if(message.type==='MANGA_TRANSLATE') { if(globalThis.holdResult) await new Promise(r=>globalThis.releaseResult=r);return {ok:true,hash:message.hash,bubbles:[{text:'original',translation:'译文',confidence:.99,bbox:[20,20,150,90]}]}; }
      return {ok:true};
    }}};
    globalThis.fixture=fixture;
  },fixture);
  await page.addScriptTag({path:root+'/shared.js'});await page.addScriptTag({path:root+'/manga-content.js'});
  const start=()=>page.evaluate(()=>listener({type:'MANGA_START'},{id:'offline'},()=>{}));
  const clickButton=async text=>{
    const box=await page.evaluate(text=>{const b=[...testRoot.querySelectorAll('button')].find(b=>b.textContent===text);const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},text);
    await page.mouse.click(box.x,box.y);
  };
  const select=async()=>{
    await page.mouse.move(100,100);await page.mouse.down();await page.mouse.move(400,400);await page.mouse.up();
    await page.waitForFunction(()=>testRoot.querySelector('.preview'));
  };
  await start();await select();
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='MANGA_TRANSLATE').length),0);
  await clickButton('取消');
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='MANGA_TRANSLATE').length),0);
  await start();await select();
  await clickButton('翻译选区');
  await page.waitForFunction(()=>[...testRoot.querySelectorAll('button')].some(b=>b.textContent==='原图 / 译图'));
  const sent=await page.evaluate(()=>calls.find(c=>c.type==='MANGA_TRANSLATE'));
  assert.equal(sent.width,300);assert.equal(sent.height,300);
  await clickButton('原图 / 译图');assert.equal(await page.evaluate(()=>testRoot.querySelector('canvas').hidden),true);
  await clickButton('原图 / 译图');assert.equal(await page.evaluate(()=>testRoot.querySelector('canvas').hidden),false);
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.type==='MANGA_TRANSLATE').length),1);
  await start();assert.equal(await page.evaluate(()=>testRoot.querySelector('canvas')),null);
  await select();
  await page.evaluate(()=>{globalThis.holdResult=true;});
  await clickButton('翻译选区');
  await page.waitForFunction(()=>typeof globalThis.releaseResult==='function');
  await start();
  await page.evaluate(()=>{releaseResult();globalThis.holdResult=false;});
  await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>testRoot.querySelector('canvas')),null,'late result cannot overwrite a new selection');
  // Hand-annotated bubbles in the original synthetic Japanese fixture.
  // Uses production pixel safety/layout functions; this tests rendering, not OCR accuracy.
  const demo=await page.evaluate(async()=>{
    const img=new Image();img.src=fixture;await img.decode();
    const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
    const before=c.toDataURL();
    const painted=DeepSeekTranslatorUtils.mangaDraw(ctx,[
      {text:'こんにちは',translation:'你好',bbox:[82,104,254,146],confidence:.99},
      {text:'元気？',translation:'你好吗？',bbox:[242,347,397,400],confidence:.99}
    ],c.width,c.height);
    return {before,after:c.toDataURL(),painted};
  });
  assert.equal(demo.painted,2);
  for(const name of ['before','after'])fs.writeFileSync(root+`/testdata/manga/out-${name}.png`,Buffer.from(demo[name].split(',')[1],'base64'));
  console.log('OK: real browser drag/crop, hidden overlays, zero upload on cancel, one confirmation, render, reversible toggle, retrigger; offline fixture renderer demo (mock bubbles; vision API NOT called)');
} finally {await browser.close();}
