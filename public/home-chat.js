import {initChatMentions} from './chat-mentions.js?v=1';
import {identityColor,identityLabel} from './chat-identity.js';
import {initNicknameControls} from './nickname-controls.js';
(()=>{
"use strict";
const $=id=>document.getElementById(id);
const root=$("cxChat");
if(!root)return;
const E={list:$("cxList"),thread:$("cxThread"),more:$("cxMore"),empty:$("cxEmpty"),form:$("cxForm"),input:$("cxInput"),file:$("cxFile"),attach:$("cxAttach"),send:$("cxSend"),pill:$("cxPill"),reply:$("cxReply"),replyText:$("cxReplyText"),replyX:$("cxReplyX"),prev:$("cxPrev"),prevImg:$("cxPrevImg"),prevName:$("cxPrevName"),prevX:$("cxPrevX"),me:$("cxMe"),count:$("cxCount"),toast:$("cxToast"),admin:$("cxAdmin"),counter:$("cxCounter"),box:$("cxLightbox"),boxImg:$("cxLightImg")};
const MAX_IMG=8*1024*1024,MAX_PICK=40*1024*1024,MAX_TEXT=1000,TYPES=["image/jpeg","image/png","image/webp","image/gif"];
const calm=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse=window.matchMedia&&window.matchMedia("(pointer: coarse)").matches;
const S={me:null,msgs:[],pending:[],local:new Map(),hasMore:false,loading:false,replyTo:null,file:null,fileUrl:"",admin:false,adminKey:"",sig:"",unseen:0,ready:false,polling:false};
const nodes=new Map();
try{S.adminKey=sessionStorage.getItem("cxAdminKey")||""}catch(e){}

function h(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
const t2=iso=>new Date(iso).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
const dayKey=iso=>{const d=new Date(iso);return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate()};
function dayLabel(iso){const d=new Date(iso),n=new Date(),y=new Date(n);y.setDate(n.getDate()-1);if(dayKey(iso)===dayKey(n.toISOString()))return"Today";if(dayKey(iso)===dayKey(y.toISOString()))return"Yesterday";const o={day:"numeric",month:"short"};if(d.getFullYear()!==n.getFullYear())o.year="numeric";return d.toLocaleDateString([],o)}
function hue(name){let x=0;for(const c of String(name))x=(x*31+c.charCodeAt(0))%360;return x}
const tag=u=>/^User\d+$/.test(u)?u.slice(-2):String(u).slice(0,2).toUpperCase();
const fmtSize=n=>n>=1048576?(n/1048576).toFixed(1)+" MB":Math.max(1,Math.round(n/1024))+" KB";
const imgSrc=m=>m.localUrl||("/api/chat/image/"+encodeURIComponent(m.id));
const snip=m=>m.message?m.message.slice(0,80):(m.image?"photo":m.audio?"voice note":"");

function fill(node,text){
  const re=/(https?:\/\/[^\s<>"']+)/g;let last=0,m;
  while((m=re.exec(text))){
    let url=m[1],trail="";const mm=url.match(/[.,!?;:)\]]+$/);
    if(mm){trail=mm[0];url=url.slice(0,-trail.length)}
    if(m.index>last)node.append(text.slice(last,m.index));
    let ok=false;try{const u=new URL(url);ok=u.protocol==="http:"||u.protocol==="https:"}catch(e){}
    if(ok){const a=h("a","cx-link",url);a.href=url;a.target="_blank";a.rel="noopener noreferrer nofollow";node.append(a)}else node.append(url);
    if(trail)node.append(trail);
    last=m.index+m[1].length;
  }
  if(last<text.length)node.append(text.slice(last));
}

let toastTimer=0;
function toast(msg){E.toast.textContent=msg;E.toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{E.toast.hidden=true},3200)}

// AI stays in the existing conversation; no extra panel or send button.
const aiWatchers=new Set();
function paintAIWaiting(){const status=$("cxAiStatus");if(!status)return;status.hidden=!aiWatchers.size;status.textContent=aiWatchers.size?"@deepAi is thinking…":""}
function watchAI(messageId,ai){
  if(!ai)return;
  if(ai.state!=="pending"){
    if(ai.state==="limited")toast("DeepAI needs a breather. AI limits reached; your message was sent.");
    else if(ai.state!=="done")toast("DeepAI is unavailable right now. Your message was sent.");
    return;
  }
  aiWatchers.add(messageId);paintAIWaiting();const deadline=Date.now()+35000;
  async function tick(){
    let state="pending";
    try{
      if(!document.hidden){
        const r=await fetch("/api/chat/ai/status?message_id="+encodeURIComponent(messageId),{cache:"no-store",signal:AbortSignal.timeout(5000)});
        const d=await r.json();if(r.ok&&d.success)state=d.state;
      }
    }catch{}
    if(state==="done"||state==="failed"||state==="missing"||Date.now()>deadline){
      aiWatchers.delete(messageId);paintAIWaiting();
      if(state!=="done")toast("DeepAI couldn’t reply this time. Your message is still here.");
      try{await loadFeed()}catch{}
      return;
    }
    setTimeout(tick,1800);
  }
  setTimeout(tick,1200);
}

/* ---------- rendering ---------- */
function sigOf(m,w){return[m.username,m.ai?1:0,m.symbol||"",m.color||"",m.parent?(m.parent.deleted?"d":[m.parent.id,m.parent.username,m.parent.snippet,m.parent.image].join("~")):"",S.admin?1:0,m.pending||"",m.mine?1:0,m.created_at].join("|")}

function buildRow(m){
  const row=h("div","cx-row"+(m.mine?" mine":""));row.dataset.id=m.id;row.tabIndex=0;
  const av=h("div","cx-avatar",tag(m.username));av.style.cssText="background:hsl("+hue(m.username)+" 32% 20%);color:hsl("+hue(m.username)+" 55% 78%)";
  const bub=h("div","cx-bubble");
  const name=h("div","cx-name",identityLabel(m.username,m.symbol,"@"));
  const quote=h("button","cx-quote");quote.type="button";
  bub.append(name,quote);
  if(m.image){
    const media=h("div","cx-media");const img=h("img");img.alt="photo";img.loading="lazy";img.decoding="async";
    img.addEventListener("load",()=>img.classList.add("ok"));
    img.addEventListener("error",()=>{media.className="cx-media broken";media.textContent="image unavailable"});
    img.src=imgSrc(m);media.append(img);bub.append(media);
  }
  if(m.audio){const audio=h("audio","cx-voice-audio");audio.controls=true;audio.preload="none";audio.src="/api/chat/audio/"+encodeURIComponent(m.id);audio.setAttribute("aria-label","Voice note from "+m.username);bub.append(audio)}
  const text=h("div","cx-text");if(m.message)fill(text,m.message);else text.hidden=true;bub.append(text);
  const meta=h("div","cx-meta");const time=h("span","cx-time",t2(m.created_at));time.title=new Date(m.created_at).toLocaleString();
  const st=h("span","cx-st");const acts=h("span","cx-acts");meta.append(time,st,acts);bub.append(meta);bub.append(h("div","cx-reactions"));
  row.append(av,bub);
  row._av=av;row._name=name;row._quote=quote;row._time=time;row._st=st;row._acts=acts;
  return row;
}

function paint(row,w){
  const m=w.m,showName=w.first&&!m.mine;
  row.classList.toggle("ai",m.ai===true);
  row.classList.toggle("first",w.first);row.classList.toggle("last",w.last);
  row.classList.toggle("pending",m.pending==="sending");row.classList.toggle("failed",m.pending==="failed");
  row._name.style.display=showName?"":"none";row._av.style.visibility=showName?"visible":"hidden";
  const sig=sigOf(m,w);if(row._sig===sig)return;row._sig=sig;
  row._name.textContent=identityLabel(m.username,m.symbol,"@");
  if(m.ai){const badge=h("span","cx-ai-badge","AI");badge.title="AI assistant powered by Llama";row._name.append(badge)}
  row._name.style.color=m.color?identityColor(m.color):"";row._av.textContent=m.ai?"✦":tag(m.username);
  row._av.style.cssText="background:hsl("+hue(m.username)+" 32% 20%);color:hsl("+hue(m.username)+" 55% 78%)";
  if(m.color){row._av.style.background=identityColor(m.color)+"25";row._av.style.color=identityColor(m.color);}
  row._time.textContent=t2(m.created_at);
  const q=row._quote;q.textContent="";
  if(m.parent){
    q.hidden=false;
    if(m.parent.deleted){q.textContent="↩ deleted message";q.classList.add("gone");q.disabled=true;delete q.dataset.target}
    else{q.classList.remove("gone");q.disabled=false;q.dataset.target=m.parent.id;q.append("↩ ",h("b",null,"@"+m.parent.username)," "+(m.parent.snippet||(m.parent.image?"photo":"")))}
  }else q.hidden=true;
  row._st.textContent=m.pending==="sending"?"sending…":m.pending==="failed"?"failed to send":"";
  row._st.className="cx-st"+(m.pending==="failed"?" err":"");
  const a=row._acts;a.textContent="";
  const btn=(label,act)=>{const b=h("button","cx-act",label);b.type="button";b.dataset.a=act;a.append(b)};
  if(m.pending==="failed"){btn("retry","retry");btn("remove","discard")}
  else if(!m.pending){btn("reply","reply");if(m.mine||S.admin)btn(S.admin&&!m.mine?"delete (admin)":"delete","del")}
}

function removeNode(k,node){
  nodes.delete(k);
  if(calm){node.remove();return}
  node.classList.add("cx-removing");node.style.maxHeight=node.offsetHeight+"px";node.style.opacity="1";
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{node.style.maxHeight="0";node.style.opacity="0";node.style.marginTop="0"})});
  setTimeout(()=>node.remove(),340);
}

function reconcile(animate){
  const list=S.msgs.concat(S.pending),want=[];let lastDay="",prev=null;
  list.forEach((m,i)=>{
    const day=dayKey(m.created_at);
    if(day!==lastDay){want.push({key:"d:"+day,div:dayLabel(m.created_at)});lastDay=day;prev=null}
    const first=!prev||prev.username!==m.username||(new Date(m.created_at)-new Date(prev.created_at))>300000;
    const nx=list[i+1];
    const last=!nx||nx.username!==m.username||dayKey(nx.created_at)!==day||(new Date(nx.created_at)-new Date(m.created_at))>300000;
    want.push({key:"m:"+m.id,m,first,last});prev=m;
  });
  const keep=new Set(want.map(w=>w.key));
  for(const[k,n]of[...nodes])if(!keep.has(k))removeNode(k,n);
  const skip=n=>{while(n&&n.classList.contains("cx-removing"))n=n.nextElementSibling;return n};
  let ref=skip(E.list.firstElementChild);
  for(const w of want){
    let node=nodes.get(w.key),fresh=false;
    if(!node){
      fresh=true;
      node=w.div!=null?h("div","cx-day",w.div):buildRow(w.m);
      nodes.set(w.key,node);
      if(animate&&!calm)node.classList.add("cx-in");
    }
    if(w.m)paint(node,w);
    if(node===ref)ref=skip(ref.nextElementSibling);
    else E.list.insertBefore(node,ref);
  }
  E.empty.hidden=want.length>0;
  if(!want.length)E.empty.textContent="You’re first here. What song should we all hear?";
  E.more.hidden=!S.hasMore;E.more.textContent="load older messages";
  paintReactions();paintSeenBy();scheduleSeen();
}

const nearBottom=()=>E.thread.scrollHeight-E.thread.scrollTop-E.thread.clientHeight<90;
function toBottom(smooth){E.thread.scrollTo({top:E.thread.scrollHeight,behavior:smooth&&!calm?"smooth":"auto"});S.unseen=0;E.pill.hidden=true}
E.thread.addEventListener("scroll",()=>{if(nearBottom()){S.unseen=0;E.pill.hidden=true}},{passive:true});
E.pill.addEventListener("click",()=>toBottom(true));

/* ---------- data ---------- */
async function getState(){try{const r=await fetch("/api/chat/state",{cache:"no-store",signal:AbortSignal.timeout(10000)});const d=await r.json();if(d.success){E.count.textContent=d.count+(d.count===1?" message":" messages");return d.count+"|"+d.latest+"|"+(d.names_version||0)}}catch(e){}return null}

const messageOrder=(a,b)=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:a.id<b.id?-1:a.id>b.id?1:0;
function applyFeed(srv,hasMore,first){
  const before=new Set(S.msgs.map(m=>m.id)),atBottom=first||nearBottom();
  const cut=srv[0];
  const older=cut?S.msgs.filter(m=>messageOrder(m,cut)<0):[];
  const now=Date.now();
  srv.forEach(m=>{const l=S.local.get(m.id);if(l){if(l.localUrl)m.localUrl=l.localUrl;S.local.delete(m.id)}});
  const have=new Set(srv.map(m=>m.id)),extra=[];
  for(const[id,m]of S.local){if(now-m.localAt>15000){S.local.delete(id);continue}if(!have.has(id))extra.push(m)}
  const merged=older.concat(srv,extra).sort(messageOrder);
  if(!older.length)S.hasMore=hasMore;
  S.msgs=merged;
  const fresh=merged.filter(m=>!before.has(m.id)&&!m.mine).length;
  reconcile(!first);
  if(first||atBottom)toBottom(!first);
  else if(fresh>0){S.unseen+=fresh;E.pill.textContent="↓ "+S.unseen+" new message"+(S.unseen>1?"s":"");E.pill.hidden=false}
}

async function loadFeed(sig){
  const r=await fetch("/api/chat?limit=100",{cache:"no-store",signal:AbortSignal.timeout(10000)});const d=await r.json();
  if(!d.success)throw new Error("feed");
  const first=!S.ready;
  if(d.me){S.me=d.me;paintMyIdentity()}
  applyFeed(d.messages,d.has_more,first);S.ready=true;if(sig!=null)S.sig=sig;
}

async function poll(){
  if(document.hidden||S.polling||!S.ready||!(window.worldIsVisible||(()=>!document.hidden))(root))return;
  S.polling=true;
  try{const sig=await getState();if(sig&&sig!==S.sig)await loadFeed(sig)}catch(e){}finally{S.polling=false}
}

async function boot(){
  E.empty.hidden=false;E.empty.innerHTML='<span class="skeleton skeleton-line" role="status" aria-label="Loading conversation"></span>';
  try{const sig=await getState();await loadFeed(sig)}
  catch(e){E.empty.hidden=false;E.empty.textContent="Could not load the chat. Tap here to try again.";E.empty.style.cursor="pointer";E.empty.onclick=()=>{E.empty.onclick=null;E.empty.style.cursor="";boot()}}
}

E.more.addEventListener("click",async()=>{
  if(S.loading||!S.hasMore||!S.msgs.length)return;S.loading=true;E.more.textContent="loading…";
  try{
    const r=await fetch("/api/chat?limit=50&before="+encodeURIComponent(S.msgs[0].created_at)+"&before_id="+encodeURIComponent(S.msgs[0].id),{cache:"no-store",signal:AbortSignal.timeout(10000)});const d=await r.json();
    if(!d.success)throw new Error("older");
    const h0=E.thread.scrollHeight,t0=E.thread.scrollTop;
    S.msgs=d.messages.concat(S.msgs);S.hasMore=d.has_more;reconcile(false);
    E.thread.scrollTop=t0+(E.thread.scrollHeight-h0);
  }catch(e){toast("Couldn't load older messages")}finally{S.loading=false;E.more.textContent="load older messages"}
});

/* ---------- composer ---------- */
function updateSend(){E.send.disabled=!E.input.value.trim()&&!S.file}
function grow(){E.input.style.height="auto";E.input.style.height=Math.min(Math.max(E.input.scrollHeight,42),140)+"px";const n=E.input.value.length;E.counter.textContent=n>800?n+" / "+MAX_TEXT:""}
const mentionAutocomplete=initChatMentions(E.input,$("cxMentions"),$("cxMentionDeepAI"));
E.input.addEventListener("input",()=>{grow();updateSend()});
E.input.addEventListener("keydown",e=>{if(mentionAutocomplete?.handleKeydown(e))return;if(e.key==="Enter"&&!e.shiftKey&&!coarse&&!e.isComposing){e.preventDefault();submit()}});
/* ---------- mobile keyboard / visual viewport ---------- */
if(parseFloat(getComputedStyle(E.input).fontSize)<16)E.input.style.fontSize="16px";
(()=>{
  const vv=window.visualViewport;
  if(!vv)return;
  const mobile=()=>coarse||navigator.maxTouchPoints>0;
  const saved={height:E.thread.style.height,minHeight:E.thread.style.minHeight,paddingBottom:root.style.paddingBottom};
  const basePadding=parseFloat(getComputedStyle(root).paddingBottom)||0;
  let extraPadding=0;
  let baseline=vv.height,baseWidth=window.innerWidth,normalHeight=0;
  let active=false,resized=false,pinned=false,raf=0,settle=0,timers=[];
  let readingTop=0,ignoreScroll=false;
  const focused=()=>document.activeElement===E.input;
  function remember(){
    if(active||!mobile())return;
    baseline=vv.height;baseWidth=window.innerWidth;
    normalHeight=E.thread.getBoundingClientRect().height;
    pinned=nearBottom();readingTop=E.thread.scrollTop;
  }
  function holdScroll(){
    ignoreScroll=true;clearTimeout(settle);
    settle=setTimeout(()=>{ignoreScroll=false},100);
  }
  function restore(){
    if(!resized)return;
    holdScroll();
    E.thread.style.height=saved.height;E.thread.style.minHeight=saved.minHeight;
    root.style.paddingBottom=saved.paddingBottom;extraPadding=0;
    E.thread.scrollTop=pinned?E.thread.scrollHeight:readingTop;
    resized=false;
  }
  function fit(){
    raf=0;
    if(!focused()||!mobile()){
      restore();active=false;
      baseline=vv.height;baseWidth=window.innerWidth;
      return;
    }
    // Pinch zoom is not a keyboard opening; leave zoom/panning to the browser.
    if(Math.abs(vv.scale-1)>.05)return;
    if(Math.abs(window.innerWidth-baseWidth)>80){
      // Re-establish the baseline after rotation, without changing scroll intent.
      restore();baseWidth=window.innerWidth;
      baseline=Math.max(window.innerHeight,vv.height);
      normalHeight=E.thread.getBoundingClientRect().height;
    }
    // Estimate occlusion, not a guaranteed physical keyboard measurement.
    const keyboardHeight=Math.max(0,baseline-vv.height,window.innerHeight-vv.height);
    const keyboardOpen=keyboardHeight>100;
    if(keyboardOpen){
      const chrome=root.getBoundingClientRect().height-E.thread.getBoundingClientRect().height-extraPadding;
      const height=Math.max(0,Math.min(normalHeight,vv.height-chrome-16));
      holdScroll();
      E.thread.style.minHeight="0px";E.thread.style.height=height+"px";
      // Supply scroll room when only the visual viewport shrinks (e.g. Safari).
      extraPadding=Math.max(0,window.innerHeight-vv.height);
      root.style.paddingBottom=(basePadding+extraPadding)+"px";
      E.thread.scrollTop=pinned?E.thread.scrollHeight:readingTop;
      resized=true;
    }else restore();
    const form=E.form.getBoundingClientRect();
    const top=vv.offsetTop+8,bottom=vv.offsetTop+vv.height-8;
    const delta=keyboardOpen?form.bottom-bottom:
      (form.bottom>bottom?form.bottom-bottom:form.top<top?form.top-top:0);
    // Instant correction avoids fighting keyboard animation and global smooth scrolling.
    if(Math.abs(delta)>1)window.scrollTo({top:Math.max(0,window.scrollY+delta),behavior:"instant"});
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(fit)}
  function delayed(){
    timers.forEach(clearTimeout);
    timers=[80,300,600].map(ms=>setTimeout(schedule,ms));
  }
  E.input.addEventListener("pointerdown",remember,{passive:true});
  E.input.addEventListener("focus",()=>{
    if(!mobile())return;
    remember();active=true;delayed();
  });
  E.input.addEventListener("blur",delayed);
  E.input.addEventListener("input",()=>{if(active)schedule()});
  E.thread.addEventListener("scroll",()=>{
    if(active&&!ignoreScroll){pinned=nearBottom();readingTop=E.thread.scrollTop}
  },{passive:true});
  // A deliberate gesture must win even during a viewport adjustment.
  ["touchstart","wheel"].forEach(type=>E.thread.addEventListener(type,()=>{
    ignoreScroll=false;clearTimeout(settle);
  },{passive:true}));
  vv.addEventListener("resize",schedule,{passive:true});
  vv.addEventListener("scroll",schedule,{passive:true});
  window.addEventListener("resize",schedule,{passive:true});
  if("ResizeObserver" in window){
    const observer=new ResizeObserver(()=>{if(active)schedule()});
    [E.form,E.reply,E.prev,$("cxVoicePanel")].filter(Boolean).forEach(el=>observer.observe(el));
  }
})();
E.form.addEventListener("submit",e=>{e.preventDefault();submit()});

function setReply(m){
  S.replyTo={id:m.id,username:m.username,snippet:snip(m),image:!!m.image};
  E.replyText.textContent="";E.replyText.append("Replying to ",h("b",null,"@"+m.username)," · "+(snip(m)||"photo"));
  E.reply.hidden=false;E.input.focus();
}
function clearReply(){S.replyTo=null;E.reply.hidden=true}
E.replyX.addEventListener("click",clearReply);

function clearFile(keepUrl){if(S.fileUrl&&!keepUrl)URL.revokeObjectURL(S.fileUrl);S.file=null;S.fileUrl="";E.prev.hidden=true;E.prevImg.removeAttribute("src");E.file.value="";updateSend()}
E.prevX.addEventListener("click",()=>clearFile(false));
E.attach.addEventListener("click",()=>E.file.click());

async function shrink(file){
  if(file.type==="image/gif")return{blob:file,name:"image.gif"};
  let bmp=null;
  try{bmp=await createImageBitmap(file)}catch(e){}
  if(!bmp){
    bmp=await new Promise((res,rej)=>{const i=new Image();const u=URL.createObjectURL(file);i.onload=()=>{URL.revokeObjectURL(u);res(i)};i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("decode"))};i.src=u});
  }
  const w0=bmp.width||bmp.naturalWidth,h0=bmp.height||bmp.naturalHeight,k=Math.min(1,1600/Math.max(w0,h0));
  const c=document.createElement("canvas");c.width=Math.max(1,Math.round(w0*k));c.height=Math.max(1,Math.round(h0*k));
  const x=c.getContext("2d");
  const toBlob=(type,q)=>new Promise(res=>c.toBlob(res,type,q));
  let blob=null,name="image.jpg";
  if(file.type==="image/png"||file.type==="image/webp"){
    x.drawImage(bmp,0,0,c.width,c.height);
    const wb=await toBlob("image/webp",.86);
    if(wb&&wb.type==="image/webp"){blob=wb;name="image.webp"}
  }
  if(!blob){x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.drawImage(bmp,0,0,c.width,c.height);blob=await toBlob("image/jpeg",.85);name="image.jpg"}
  if(bmp.close)bmp.close();
  if(!blob)throw new Error("encode");
  if(k===1&&blob.size>=file.size&&file.size<=MAX_IMG&&TYPES.includes(file.type))return{blob:file,name:"image."+(file.type.split("/")[1]==="jpeg"?"jpg":file.type.split("/")[1])};
  return{blob,name};
}

E.file.addEventListener("change",async()=>{
  const f=E.file.files&&E.file.files[0];if(!f)return;
  if(!TYPES.includes(f.type)){toast("Only JPG, PNG, WebP or GIF images");E.file.value="";return}
  if(f.size>MAX_PICK){toast("That image is too large");E.file.value="";return}
  E.attach.disabled=true;
  try{
    const out=await shrink(f);
    if(out.blob.size>MAX_IMG){toast("Image is too large (max 8 MB)");E.file.value="";return}
    clearFile(false);
    const named=out.blob instanceof File?out.blob:new File([out.blob],out.name,{type:out.blob.type});
    S.file=named;S.fileUrl=URL.createObjectURL(named);E.prevImg.src=S.fileUrl;E.prevName.textContent=out.name+" · "+fmtSize(named.size);E.prev.hidden=false;updateSend();
  }catch(e){toast("Couldn't read that image")}finally{E.attach.disabled=false;E.file.value=""}
});

async function submit(){
  const text=E.input.value.trim(),file=S.file;
  if(!text&&!file)return;
  if(text.length>MAX_TEXT){toast("Message is too long");return}
  const parent=S.replyTo?{id:S.replyTo.id,username:S.replyTo.username,snippet:S.replyTo.snippet,image:S.replyTo.image,deleted:false}:null;
  const p={id:"tmp-"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),message:text,created_at:new Date().toISOString(),username:S.me?S.me.username:"you",mine:true,image:!!file,localUrl:file?S.fileUrl:"",parent,pending:"sending",_file:file,_parent:parent?parent.id:null};
  mentionAutocomplete?.close();
  E.input.value="";grow();clearReply();clearFile(true);updateSend();
  S.pending.push(p);reconcile(true);toBottom(true);
  await post(p);
}

async function post(p){
  p.pending="sending";reconcile(false);
  const fd=new FormData();fd.append("message",p.message);if(p._parent)fd.append("parent_id",p._parent);if(p._file)fd.append("image",p._file,p._file.name||"image.jpg");
  try{
    const r=await fetch("/api/chat/send",{method:"POST",body:fd});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.success){const e=new Error(d.warning ? d.error+". "+d.warning : d.error||"send failed");e.status=r.status;throw e}
    const real={id:d.message_id,message:p.message,created_at:d.created_at,username:p.username,mine:true,image:p.image,localUrl:p.localUrl,parent:p.parent,localAt:Date.now()};
    S.pending=S.pending.filter(x=>x!==p);
    const old=nodes.get("m:"+p.id);if(old){nodes.delete("m:"+p.id);nodes.set("m:"+real.id,old);old.dataset.id=real.id;old._sig=""}
    S.msgs.push(real);S.msgs.sort(messageOrder);S.local.set(real.id,real);
    reconcile(false);toBottom(false);
    watchAI(real.id,d.ai);
    loadFeed().catch(()=>{});
  }catch(e){
    p.pending="failed";p.error=e.message;reconcile(false);
    const msg={413:"Image is too large",415:"Only JPG, PNG, WebP or GIF images",429:e.message,503:"Images aren't enabled yet",401:"Reload the page and try again"}[e.status];
    toast(msg||"Couldn't send. Tap retry.");
  }
}

/* ---------- row actions ---------- */
function findMsg(id){return S.msgs.find(m=>m.id===id)||S.pending.find(m=>m.id===id)}
function jumpTo(id){
  const n=nodes.get("m:"+id);if(!n)return;
  E.thread.scrollTo({top:Math.max(0,n.offsetTop-E.thread.clientHeight/3),behavior:calm?"auto":"smooth"});
  n.classList.remove("cx-flash");void n.offsetWidth;n.classList.add("cx-flash");setTimeout(()=>n.classList.remove("cx-flash"),1300);
}
async function del(id){
  const headers={};if(S.admin&&S.adminKey)headers["X-Admin-Key"]=S.adminKey;
  try{
    const r=await fetch("/api/chat/message/"+encodeURIComponent(id),{method:"DELETE",headers});const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.success)throw new Error(d.error||"delete");
    const m=findMsg(id);if(m&&m.localUrl&&m.localUrl.startsWith("blob:"))URL.revokeObjectURL(m.localUrl);
    S.msgs=S.msgs.filter(x=>x.id!==id);S.local.delete(id);
    S.msgs.forEach(x=>{if(x.parent&&x.parent.id===id)x.parent={id,deleted:true}});
    reconcile(false);getState().then(sig=>{if(sig)S.sig=sig});
  }catch(e){toast("Couldn't delete that message")}
}

E.list.addEventListener("click",e=>{
  const row=e.target.closest(".cx-row");
  const q=e.target.closest(".cx-quote");if(q&&q.dataset.target){jumpTo(q.dataset.target);return}
  const media=e.target.closest(".cx-media");
  if(media&&!media.classList.contains("broken")&&row){const img=media.querySelector("img");if(img){E.boxImg.src=img.src;E.box.hidden=false}return}
  const b=e.target.closest(".cx-act");
  if(b&&row){
    const id=row.dataset.id,a=b.dataset.a;
    if(a==="reply"){const m=findMsg(id);if(m)setReply(m);row.classList.remove("cx-sel")}
    else if(a==="del"){
      if(b.classList.contains("confirm")){del(id)}
      else{b.classList.add("confirm");b.textContent="sure?";setTimeout(()=>{if(b.isConnected){b.classList.remove("confirm");b.textContent=S.admin&&!findMsg(id)?.mine?"delete (admin)":"delete"}},3000)}
    }
    else if(a==="retry"){const p=S.pending.find(x=>x.id===id);if(p)post(p)}
    else if(a==="discard"){S.pending=S.pending.filter(x=>x.id!==id);reconcile(false)}
    return;
  }
  if(e.target.closest("a,audio,.cx-react"))return;
  if(row){const was=row.classList.contains("cx-sel");E.list.querySelectorAll(".cx-sel").forEach(n=>n.classList.remove("cx-sel"));if(!was)row.classList.add("cx-sel")}
});

/* ---------- lightbox ---------- */
E.box.addEventListener("click",()=>{E.box.hidden=true;E.boxImg.removeAttribute("src")});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!E.box.hidden){E.box.hidden=true;E.boxImg.removeAttribute("src")}});

/* ---------- admin ---------- */
function paintAdmin(){if($('cxAuditLink'))$('cxAuditLink').hidden=!S.admin;E.admin.textContent=S.admin?"admin mode · exit":"admin";E.admin.classList.toggle("on",S.admin);reconcile(false);refreshSeenAdmin();refreshAdminOnline()}
let adminOnlineBusy=false;
async function refreshAdminOnline(){
  const panel=$('cxAdminOnline'),list=$('cxAdminOnlineList');if(!panel||!list)return;
  panel.hidden=!S.admin;
  if(!S.admin){list.replaceChildren();return}
  if(adminOnlineBusy)return;adminOnlineBusy=true;const key=S.adminKey;
  try{
    const r=await fetch('/api/chat/admin/presence',{headers:{'X-Admin-Key':key},cache:'no-store',signal:AbortSignal.timeout(5000)});
    const d=await r.json();if(!S.admin||S.adminKey!==key)return;
    list.replaceChildren();
    if(!r.ok||!d.success){list.append(h('li',null,'Online list unavailable.'));return}
    if(!d.online.length)list.append(h('li',null,'No active visitors right now.'));
    for(const visitor of d.online)list.append(h('li',null,'@'+visitor.username));
  }catch{if(S.admin&&S.adminKey===key)list.replaceChildren(h('li',null,'Online list unavailable.'))}
  finally{adminOnlineBusy=false}
}
async function checkAdmin(key){
  try{const r=await fetch("/api/chat/admin/check",{headers:{"X-Admin-Key":key},cache:"no-store"});const d=await r.json();return!!d.admin}catch(e){return false}
}
E.admin.addEventListener("click",async()=>{
  if(S.admin){S.admin=false;S.adminKey="";try{sessionStorage.removeItem("cxAdminKey")}catch(e){}paintAdmin();window.dispatchEvent(new CustomEvent("world-admin-change"));return}
  const key=window.prompt("Admin key");if(!key)return;
  if(await checkAdmin(key.trim())){S.admin=true;S.adminKey=key.trim();try{sessionStorage.setItem("cxAdminKey",S.adminKey)}catch(e){}paintAdmin();window.dispatchEvent(new CustomEvent("world-admin-change"));toast("Admin mode on")}
  else toast("Wrong key");
});

/* ---------- reactions, presence and voice notes ---------- */
const REACTIONS=['😡','😂','🥺','😒'];
let reactionState={},reactionBusy=false,communityStarted=false;
function paintReactions(){
  E.list.querySelectorAll('.cx-row').forEach(row=>{
    const m=findMsg(row.dataset.id),box=row.querySelector('.cx-reactions');if(!box||!m)return;
    box.hidden=!!m.pending;if(m.pending)return;
    const values=reactionState[m.id]||[];
    const signature=JSON.stringify(values);if(box.dataset.sig===signature)return;box.dataset.sig=signature;
    box.replaceChildren();
    const counts=h('div','cx-reaction-counts'),picker=h('div','cx-reaction-picker');
    picker.setAttribute('role','group');picker.setAttribute('aria-label','Choose a reaction');
    function button(emoji,r,label){const b=h('button','cx-react',label);b.type='button';b.dataset.emoji=emoji;b.setAttribute('aria-label',(r?.mine?'Remove reaction ':'React ')+emoji);b.setAttribute('aria-pressed',String(!!r?.mine));return b}
    values.filter(r=>r.count>0).forEach(r=>{const b=button(r.emoji,r,r.emoji+' '+r.count);if(!REACTIONS.includes(r.emoji)&&!r.mine)b.disabled=true;counts.append(b)});
    REACTIONS.forEach(emoji=>picker.append(button(emoji,values.find(r=>r.emoji===emoji),emoji)));
    box.append(counts,picker);
  });
}
async function loadReactions(){
  if(document.hidden||reactionBusy||!S.ready||!(window.worldIsVisible||(()=>!document.hidden))(root))return;reactionBusy=true;
  try{
    // Prioritize the messages visible in the conversation, including loaded history.
    const rect=E.thread.getBoundingClientRect();
    const visible=[...E.list.querySelectorAll('.cx-row')].filter(n=>{const r=n.getBoundingClientRect();return r.bottom>=rect.top&&r.top<=rect.bottom}).map(n=>n.dataset.id);
    const ids=[...new Set(visible.concat(S.msgs.slice(-100).map(m=>m.id)))].filter(id=>!id.startsWith('tmp-')).slice(0,100);
    if(!ids.length)return;
    const r=await fetch('/api/chat/reactions?ids='+encodeURIComponent(ids.join(',')),{cache:'no-store'}),d=await r.json();if(!d.success)return;
    ids.forEach(id=>reactionState[id]=d.reactions[id]||[]);paintReactions();
  }catch{}finally{reactionBusy=false}
}
E.list.addEventListener('click',async e=>{
  const b=e.target.closest('.cx-react');if(!b)return;const row=b.closest('.cx-row');if(!row)return;
  b.disabled=true;const active=b.getAttribute('aria-pressed')!=='true';
  try{const r=await fetch('/api/chat/reactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_id:row.dataset.id,emoji:b.dataset.emoji,active})});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.error||'Reaction failed');await loadReactions()}catch(e){toast(e.message)}finally{b.disabled=false}
});
document.addEventListener('click',e=>{if(!e.target.closest('.cx-row'))E.list.querySelectorAll('.cx-sel').forEach(row=>row.classList.remove('cx-sel'))});
let reactionScroll=0;E.thread.addEventListener('scroll',()=>{clearTimeout(reactionScroll);reactionScroll=setTimeout(loadReactions,250)},{passive:true});
const online=$('cxOnline'),typing=$('cxTyping');
let lastTyping=0,typingTimer=0,presenceBusy=false;
function paintPresence(d){if(!d.success)return;online.textContent=d.online+' online';online.title='Active in the last minute, including you';typing.textContent=d.typing.length?d.typing.map(n=>'@'+n).join(', ')+(d.typing.length===1?' is typing…':' are typing…'):''}
async function presence(write=false,isTyping=false,active=true){
  if(!write)refreshAdminOnline();
  if(!S.me)return;
  if(!write&&presenceBusy)return;if(!write)presenceBusy=true;
  try{const r=await fetch('/api/chat/presence',write?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({typing:isTyping,active}),keepalive:!active}:{cache:'no-store'});const d=await r.json();if(r.ok)paintPresence(d);else if(online)online.textContent=''}catch{if(online)online.textContent=''}finally{if(!write)presenceBusy=false}
}
E.input.addEventListener('input',()=>{
  if(document.hidden)return;
  const hasText=!!E.input.value.trim();clearTimeout(typingTimer);
  if(!hasText){presence(true,false);return}
  if(Date.now()-lastTyping>4000){lastTyping=Date.now();presence(true,true)}
  typingTimer=setTimeout(()=>presence(true,false),4500);
});
E.input.addEventListener('blur',()=>{clearTimeout(typingTimer);presence(true,false)});
E.form.addEventListener('submit',()=>{clearTimeout(typingTimer);presence(true,false)});
function startCommunity(){
  if(communityStarted)return;communityStarted=true;loadReactions();presence(true);
  setInterval(()=>{if((window.worldIsVisible||(()=>!document.hidden))(root))presence()},6000);
  setInterval(()=>{if((window.worldIsVisible||(()=>!document.hidden))(root))loadReactions()},15000);
  setInterval(()=>{if(!document.hidden)presence(true,document.activeElement===E.input&&!!E.input.value.trim()&&Date.now()-lastTyping<5000)},20000);
  document.addEventListener('visibilitychange',()=>{presence(true,false,!document.hidden);if(!document.hidden)loadReactions()});
  window.addEventListener('pagehide',()=>presence(true,false,false));
}
window.addEventListener('world-admin-change',async()=>{
  try{S.adminKey=sessionStorage.getItem('cxAdminKey')||''}catch{S.adminKey=''}
  S.admin=!!S.adminKey&&await checkAdmin(S.adminKey);paintAdmin();
});
(()=>{
  const mic=$('cxRecord'),panel=$('cxVoicePanel'),label=$('cxVoiceStatus'),preview=$('cxVoicePreview'),send=$('cxVoiceSend'),cancel=$('cxVoiceCancel');
  if(!mic)return;
  const supported=!!(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder);
  if(!supported){mic.disabled=true;mic.title='Voice recording is not supported in this browser';return}
  let recorder=null,stream=null,chunks=[],blob=null,objectURL='',started=0,ticker=0,stopTimer=0,discard=false,opening=false,uploading=false;
  function stopTracks(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;clearInterval(ticker);clearTimeout(stopTimer)}
  function reset(){if(objectURL)URL.revokeObjectURL(objectURL);objectURL='';blob=null;chunks=[];preview.pause();preview.removeAttribute('src');preview.hidden=true;panel.hidden=true;mic.classList.remove('recording');mic.textContent='🎙';mic.setAttribute('aria-label','Record voice note');send.disabled=true;mic.disabled=false}
  function stop(drop=false){discard=drop;if(recorder&&recorder.state!=='inactive')recorder.stop();else{stopTracks();reset()}}
  mic.addEventListener('click',async()=>{
    if(opening||uploading)return;
    if(recorder&&recorder.state==='recording'){stop();return}
    if(blob){toast('Send or discard the current voice note first');return}
    if(S.file){toast('Send or remove the attached image first');return}
    opening=true;mic.disabled=true;discard=false;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(document.hidden||discard){stopTracks();reset();return}
      const type=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      if(!type)throw new Error('This browser cannot record a supported audio format');
      recorder=new MediaRecorder(stream,{mimeType:type,audioBitsPerSecond:64000});chunks=[];started=Date.now();
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      recorder.onerror=()=>{discard=true;stopTracks();reset();toast('Recording failed. Please try again')};
      recorder.onstop=()=>{
        stopTracks();mic.classList.remove('recording');mic.textContent='🎙';mic.setAttribute('aria-label','Record voice note');
        if(discard){reset();return}
        blob=new Blob(chunks,{type:recorder.mimeType});
        if(!blob.size||blob.size>8*1024*1024){reset();toast('Recording is empty or too large');return}
        objectURL=URL.createObjectURL(blob);preview.src=objectURL;preview.hidden=false;label.textContent='Preview your voice note before sending';send.disabled=false;mic.disabled=true;
      };
      recorder.start(250);panel.hidden=false;preview.hidden=true;send.disabled=true;label.textContent='Recording · 0:00 / 1:00';mic.textContent='■';mic.setAttribute('aria-label','Stop recording');mic.classList.add('recording');
      ticker=setInterval(()=>{const s=Math.min(60,Math.floor((Date.now()-started)/1000));label.textContent='Recording · '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0')+' / 1:00'},250);
      stopTimer=setTimeout(()=>stop(),60000);
    }catch(e){stopTracks();reset();toast(e.name==='NotAllowedError'?'Microphone permission is needed to record':e.message||'Could not start recording')}
    finally{opening=false;if(!blob)mic.disabled=false}
  });
  cancel.addEventListener('click',()=>{if(!uploading){if(recorder?.state==='recording')stop(true);else reset()}});
  send.addEventListener('click',async()=>{
    if(!blob||uploading)return;
    if(S.file){toast('Remove the attached image before sending a voice note');return}
    uploading=true;send.disabled=true;cancel.disabled=true;label.textContent='Sending voice note…';
    const caption=E.input.value.trim(),reply=S.replyTo?.id||'';
    const fd=new FormData();fd.append('audio',blob,'voice.'+(blob.type.includes('mp4')?'m4a':blob.type.includes('ogg')?'ogg':'webm'));fd.append('message',caption);if(reply)fd.append('parent_id',reply);
    try{const r=await fetch('/api/chat/voice',{method:'POST',body:fd});const d=await r.json();if(!r.ok||!d.success)throw new Error(d.warning ? d.error+'. '+d.warning : d.error||'Voice note could not be sent');if(E.input.value.trim()===caption){E.input.value='';grow();updateSend()}if(S.replyTo?.id===reply)clearReply();reset();toast('Voice note sent');await loadFeed(await getState());toBottom(false)}catch(e){label.textContent='Not sent. Your recording is still here.';toast(e.message)}finally{uploading=false;send.disabled=!blob;cancel.disabled=false}
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(opening||recorder?.state==='recording'))stop(true)});
  window.addEventListener('pagehide',()=>{stop(true);stopTracks()});
})();

/* ---------- admin-only read receipts ---------- */
let seenReaders=[],seenEpoch=0,seenFetching=false,seenTimer=0,seenSending=false,seenSent="",seenAttempt=0;
function paintSeenBy(){
  E.list.querySelectorAll(".cx-row").forEach(row=>{
    const m=findMsg(row.dataset.id);let label=row.querySelector(".cx-seen");
    if(!S.admin||!m||m.pending){if(label)label.remove();return}
    const names=[...new Set(seenReaders.filter(r=>r.username!==m.username&&r.last_seen_at>=m.created_at).map(r=>"@"+r.username))];
    if(!names.length){if(label)label.remove();return}
    if(!label){label=h("div","cx-seen");label.style.cssText="font:10px/1.5 system-ui;color:var(--world-muted);margin-top:6px";row.querySelector(".cx-bubble").append(label)}
    label.textContent="Seen by "+names.join(", ");
  });
}
async function loadSeenAdmin(){
  if(!S.admin||!S.adminKey||seenFetching||document.visibilityState!=="visible"||!(window.worldIsVisible||(()=>!document.hidden))(root))return;
  const epoch=seenEpoch,key=S.adminKey;seenFetching=true;
  try{
    const r=await fetch("/api/chat/admin/seen",{headers:{"X-Admin-Key":key},cache:"no-store"});
    const d=await r.json();
    if(epoch!==seenEpoch||!S.admin||key!==S.adminKey)return;
    seenReaders=r.ok&&d.success&&Array.isArray(d.readers)?d.readers:[];paintSeenBy();
  }catch{if(epoch===seenEpoch){seenReaders=[];paintSeenBy()}}
  finally{seenFetching=false}
}
function refreshSeenAdmin(){
  seenEpoch++;seenReaders=[];paintSeenBy();
  if(S.admin)loadSeenAdmin();
}
function visibleSeenTimestamp(){
  if(document.visibilityState!=="visible"||!S.ready)return "";
  const vv=window.visualViewport,top=vv?vv.offsetTop:0,bottom=top+(vv?vv.height:window.innerHeight);
  const thread=E.thread.getBoundingClientRect(),card=root.getBoundingClientRect();
  const lo=Math.max(top,thread.top,card.top),hi=Math.min(bottom,thread.bottom,card.bottom);
  if(hi<=lo||thread.width<=0)return "";
  let upto="";
  E.list.querySelectorAll(".cx-row").forEach(row=>{
    const m=findMsg(row.dataset.id);if(!m||m.pending)return;
    const rect=row.getBoundingClientRect();
    if(rect.bottom>lo&&rect.top<hi&&m.created_at>upto)upto=m.created_at;
  });
  return upto;
}
function scheduleSeen(){
  clearTimeout(seenTimer);
  seenTimer=setTimeout(sendSeen,Math.max(250,3000-(Date.now()-seenAttempt)));
}
async function sendSeen(){
  if(seenSending)return;
  const upto=visibleSeenTimestamp();if(!upto||upto<=seenSent)return;
  seenSending=true;seenAttempt=Date.now();
  try{
    const r=await fetch("/api/chat/seen",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({upto})});
    if(r.ok){const d=await r.json();if(d.success)seenSent=upto}
  }catch{}
  finally{
    seenSending=false;
    if(document.visibilityState==="visible"&&visibleSeenTimestamp()>seenSent)scheduleSeen();
  }
}
E.thread.addEventListener("scroll",scheduleSeen,{passive:true});
window.addEventListener("scroll",scheduleSeen,{passive:true});
window.addEventListener("resize",scheduleSeen,{passive:true});
window.visualViewport?.addEventListener("resize",scheduleSeen,{passive:true});
window.visualViewport?.addEventListener("scroll",scheduleSeen,{passive:true});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){scheduleSeen();loadSeenAdmin()}else clearTimeout(seenTimer);
});
if("IntersectionObserver" in window)new IntersectionObserver(scheduleSeen,{threshold:[0,.1,1]}).observe(root);
if("ResizeObserver" in window)new ResizeObserver(scheduleSeen).observe(E.list);
E.list.addEventListener("load",scheduleSeen,true);
setInterval(loadSeenAdmin,30000);

/* ---------- listener identity ---------- */
function paintMyIdentity(){E.me.textContent=S.me?identityLabel(S.me.username,S.me.symbol,'@'):'Guest';E.me.closest('.identity-pill')?.style.setProperty('--identity-accent',identityColor(S.me?.color));}
const nicknameControls=initNicknameControls({
 headers:()=>({'Content-Type':'application/json',...(S.admin&&S.adminKey?{'X-Admin-Key':S.adminKey}:{})}),
 onSaved:user=>{S.me=user;paintMyIdentity();for(const m of S.msgs.concat(S.pending,...S.local.values()))if(m.mine){m.username=user.username;m.symbol=user.symbol;m.color=user.color;}reconcile(false);}
});

/* ---------- start ---------- */
(async()=>{
  grow();updateSend();
  try{const r=await fetch("/api/user",{signal:AbortSignal.timeout(10000)});const d=await r.json();if(d.success&&d.user)S.me=d.user}catch(e){}
  paintMyIdentity();
  if(S.me)nicknameControls.load();
  await boot();
  startCommunity();scheduleSeen();
  if(S.adminKey&&await checkAdmin(S.adminKey)){S.admin=true;paintAdmin()}else{S.adminKey="";try{sessionStorage.removeItem("cxAdminKey")}catch(e){}}
  root.addEventListener("world-visible",()=>{poll();loadReactions();presence()});
  setInterval(poll,5000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll()});
  window.addEventListener("online",poll);
})();
})();

/* ---------- install + notifications ---------- */
(()=>{
const inst=document.getElementById("cxInstall"),bell=document.getElementById("cxNotify");
if(!inst||!bell)return;
const say=m=>{const t=document.getElementById("cxToast");if(!t)return;t.textContent=m;t.hidden=false;setTimeout(()=>{t.hidden=true},3500)};
const standalone=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true;
const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
let deferred=null;
if(!standalone){
  if(ios)inst.hidden=false;
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferred=e;inst.hidden=false});
  window.addEventListener("appinstalled",()=>{deferred=null;inst.hidden=true;say("App installed")});
  inst.addEventListener("click",async()=>{
    if(deferred){deferred.prompt();try{await deferred.userChoice}catch(e){}deferred=null;inst.hidden=true}
    else say(ios?"Share button → Add to Home Screen":"Chrome menu ⋮ → Install app");
  });
}
const can="serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
let reg=null;
const paint=on=>{bell.classList.toggle("on",on);bell.textContent=on?"🔔 Notifications: on":"🔔 Notifications: off"};
async function key(){const r=await fetch("/api/push/key",{cache:"no-store"});const d=await r.json();if(!d.success)throw 0;const p=d.key.replace(/-/g,"+").replace(/_/g,"/");const b=atob(p+"===".slice((p.length+3)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))}
async function save(sub){const r=await fetch("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(sub.toJSON())});return r.ok}
(async()=>{
  if(!("serviceWorker" in navigator))return;
  try{reg=await navigator.serviceWorker.register("/sw.js")}catch(e){return}
  if(!can){if(ios&&!standalone){bell.hidden=false;bell.addEventListener("click",()=>say("iPhone: pehle Add to Home Screen karo, phir app se on karo"))}return}
  bell.hidden=false;
  try{
    await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.getSubscription();
    if(sub&&Notification.permission==="granted"){paint(true);save(sub)}else paint(false);
  }catch(e){paint(false)}
  bell.addEventListener("click",async()=>{
    bell.disabled=true;
    try{
      await navigator.serviceWorker.ready;
      const cur=await reg.pushManager.getSubscription();
      if(cur){
        fetch("/api/push/unsubscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:cur.endpoint})}).catch(()=>{});
        await cur.unsubscribe();paint(false);say("Notifications off");
      }else{
        const perm=await Notification.requestPermission();
        if(perm!=="granted"){say("Notifications blocked in browser settings");return}
        const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:await key()});
        if(await save(sub)){paint(true);say("Notifications on")}
        else{await sub.unsubscribe();say("Could not turn on, try again")}
      }
    }catch(e){say("Could not change notifications")}
    finally{bell.disabled=false}
  });
})();
})();
