(() => {
  if (globalThis.kiloceanMangaInstalled) return;
  globalThis.kiloceanMangaInstalled = true;
  const U = globalThis.DeepSeekTranslatorUtils;
  let generation=0, host, token, startNote;
  const hideOverlays=U.createMangaOverlayHider();
  const captureReleases=new Set();
  const send = async message => {
    const result=await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || "无法处理选区");
    return result;
  };
  function clear() {
    generation++;
    for (const release of captureReleases) release();
    captureReleases.clear();
    host?.remove(); host=null;
    startNote?.remove(); startNote=null;
    if (token) chrome.runtime.sendMessage({type:"MANGA_CANCEL",token}).catch(()=>{});
    token=null;
  }
  function imageFrom(url) {
    return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});
  }
  function showStartFailure(error) {
    clear();
    startNote=document.createElement("div");
    startNote.setAttribute("data-deepseek-translator-ui","true");
    startNote.style.cssText="position:fixed;top:16px;right:16px;z-index:2147483647;background:#fff;color:#111;padding:16px;border:1px solid #888;font:14px sans-serif;max-width:360px";
    startNote.textContent=`无法启动框选翻译：${error.message}；请重新打开扩展重试。`;
    const dismiss=document.createElement("button");dismiss.textContent="关闭";
    dismiss.onclick=()=>{startNote?.remove();startNote=null;};startNote.append(dismiss);
    document.documentElement.appendChild(startNote);
  }
  async function start() {
    clear();
    const run=generation;
    const begin=await send({type:"MANGA_BEGIN"});
    if (run!==generation) return;
    token=begin.token;
    const binding=token;
    host=document.createElement("div");
    host.setAttribute("data-deepseek-translator-ui","true");
    host.setAttribute("data-kilocean-manga", "true");
    host.style.cssText="position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const root=host.attachShadow({mode:"closed"});
    root.innerHTML=`<style>
      :host{all:initial} .select{pointer-events:auto;position:fixed;inset:0;cursor:crosshair;background:#0003;touch-action:none}
      .box{position:absolute;border:2px solid #69f;pointer-events:none;box-sizing:border-box}
      .bar{pointer-events:auto;position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:12px;background:#fff;color:#111;box-shadow:0 2px 12px #444;border-radius:8px;font:14px sans-serif;max-width:85vw}
      button{margin:4px;padding:8px;cursor:pointer} canvas{position:fixed;pointer-events:none} .preview{display:block;max-width:220px;max-height:150px}
    </style><div class="select"></div><div class="box"></div><div class="bar"><span>拖动框选当前可见漫画区域（仅支持白底气泡）</span><button class="cancel">取消</button></div>`;
    document.documentElement.appendChild(host);
    const select=root.querySelector('.select'),box=root.querySelector('.box'),bar=root.querySelector('.bar');
    root.querySelector('.cancel').onclick=clear;
    const alive=()=>run===generation && token===binding && host?.isConnected;
    const layout=()=>JSON.stringify([location.href,innerWidth,innerHeight,scrollX,scrollY,devicePixelRatio]);
    let anchor,rect;
    select.onpointerdown=e=>{if(!e.isTrusted)return;anchor=[e.clientX,e.clientY]; select.setPointerCapture(e.pointerId);};
    select.onpointermove=e=>{
      if(!anchor)return;
      const x=Math.max(0,Math.min(innerWidth,e.clientX)), y=Math.max(0,Math.min(innerHeight,e.clientY));
      rect={x:Math.min(anchor[0],x),y:Math.min(anchor[1],y),w:Math.abs(anchor[0]-x),h:Math.abs(anchor[1]-y)};
      Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});
    };
    select.onpointerup=async e=>{
      if(!anchor || !e.isTrusted)return;anchor=null;
      if(!rect || rect.w<16 || rect.h<16)return;
      select.onpointerdown=null;select.onpointermove=null;select.onpointerup=null;
      const selectedLayout=layout();
      bar.querySelector('span').textContent='正在本地截取选区…';
      // Shared ownership across overlapping generations prevents stale restores.
      const releaseOverlays=hideOverlays(Array.from(document.querySelectorAll('[data-deepseek-translator-ui],#kilocean-progress-host,#kilocean-selection-host,#deepseek-translator-toast-host'))
        .filter(el=>['fixed','absolute'].includes(getComputedStyle(el).position)));
      captureReleases.add(releaseOverlays);
      try {
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const capture=await send({type:"MANGA_CAPTURE",token:binding});
        if(!alive())return;
        const img=await imageFrom(capture.image);
        if(!alive())return;
        if(layout()!==selectedLayout)throw new Error('页面位置已变化，请重新框选');
        const sx=img.width/innerWidth,sy=img.height/innerHeight;
        const x=Math.floor(rect.x*sx),y=Math.floor(rect.y*sy),right=Math.min(img.width,Math.ceil((rect.x+rect.w)*sx)),bottom=Math.min(img.height,Math.ceil((rect.y+rect.h)*sy));
        const canvas=document.createElement('canvas');canvas.width=right-x;canvas.height=bottom-y;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(img,x,y,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
        const original=canvas.toDataURL('image/png');
        const {hash,layout:layoutHash}=await send({type:"MANGA_HASH",token:binding,image:original,layout:selectedLayout});
        if(!alive())return;
        select.remove();box.remove();bar.replaceChildren();
        const note=document.createElement('span');note.textContent='仅将选区发送至 DeepSeek 翻译';bar.append(note);
        const preview=document.createElement('img');preview.className='preview';preview.src=original;bar.append(preview);
        const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=fn;bar.append(b);return b;};
        button('取消',clear);
        const confirm=button('翻译选区',async event=>{
          if(!event.isTrusted || !alive() || confirm.disabled)return;
          if(layout()!==selectedLayout){note.textContent='页面位置已变化，请取消后重新框选';return;}
          confirm.disabled=true;note.textContent='DeepSeek 正在识别与翻译…';
          try {
            const result=await send({type:'MANGA_TRANSLATE',token:binding,confirmed:true,image:original,width:canvas.width,height:canvas.height,layout:layoutHash,hash});
            if(!alive() || result.hash!==hash)return;
            if(layout()!==selectedLayout)throw new Error('页面位置已变化，结果未显示，请重新框选');
            const drawn=U.mangaDraw(ctx,result.bubbles,canvas.width,canvas.height);
            note.textContent=U.mangaResultNote(drawn,result.bubbles.length);
            preview.remove();confirm.remove();
            if(!drawn.painted)return;
            Object.assign(canvas.style,{left:rect.x+'px',top:rect.y+'px',width:rect.w+'px',height:rect.h+'px'});
            root.prepend(canvas);
            button('原图 / 译图',()=>{canvas.hidden=!canvas.hidden;});
            const more=document.createElement('details'),summary=document.createElement('summary');summary.textContent='更多';more.append(summary);
            const download=document.createElement('a');download.textContent='下载译图';download.download='manga-translated.png';download.href=canvas.toDataURL('image/png');more.append(download);bar.append(more);
          } catch(error) {if(alive()){note.textContent=error.message+'；请取消后重试';confirm.remove();}}
        });
      } catch(error) {if(alive())bar.querySelector('span').textContent=error.message+'；请取消后重试';}
      finally {captureReleases.delete(releaseOverlays);releaseOverlays();}
    };
  }
  // Navigation clears bindings; reader-internal page flips cannot be reliably detected.
  addEventListener('pagehide',clear);
  addEventListener('popstate',clear);
  addEventListener('hashchange',clear);
  addEventListener('resize',clear);
  addEventListener('scroll',()=>{if(host)clear();},{passive:true,capture:true});
  addEventListener('keydown',e=>{if(e.key==='Escape')clear();});
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    // tabs.onUpdated reports detectable pushState/replaceState URL changes.
    if(message?.type==='MANGA_INVALIDATE') { if(message.token===token)clear(); return; }
    if(message?.type!=='MANGA_START')return;
    const run=generation+1;
    start().then(()=>reply({ok:true}),error=>{
      if (generation===run) showStartFailure(error);
      reply({ok:false,error:error.message});
    });
    return true;
  });
})();
