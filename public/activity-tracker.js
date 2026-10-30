(()=>{
'use strict';
// Browser identity is pseudonymous. No fingerprint, raw IP, query string or referrer is stored. The server records approximate city/state/country from Cloudflare metadata.
if(location.pathname==='/admin-activity.html')return;
let session,busy=false,ready=false,pendingView=true;
try{session=sessionStorage.getItem('deepVisitSession');if(!session){session=crypto.randomUUID();sessionStorage.setItem('deepVisitSession',session)}}catch{session=crypto.randomUUID()}
async function track(kind){
 if(busy||document.hidden||!ready)return;busy=true;kind=pendingView?'view':kind;
 try{const response=await fetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,page:location.pathname,kind}),keepalive:true});if(response.ok)pendingView=false}catch{}finally{busy=false}
}
async function start(){
 try{
  // Reuse the homepage's identity initialization, avoiding competing first-visit cookies.
  if(document.getElementById('cxChat')){
   for(let i=0;i<30&&!document.getElementById('cxMe')?.textContent.startsWith('@');i++)await new Promise(resolve=>setTimeout(resolve,400));
  }else{const r=await fetch('/api/user');if(!r.ok)return;}
  ready=true;track('view');
 }catch{}
}
if(!document.body.textContent.includes('Visits and action metadata are logged')){const note=document.createElement('p');note.textContent='Visits and action metadata are logged for site administration. Deleted message text is retained for admin-only moderation for 30 days.';note.style.cssText='color:#aaa;font:11px/1.6 system-ui;max-width:1100px;margin:24px auto;padding:0 20px';(document.querySelector('footer')||document.body).append(note)}
const locationNote=' Approximate city, state and country from your IP are recorded for admin-only visit analytics; this is not GPS location.';
const existingNote=document.querySelector('.public-note');
if(existingNote)existingNote.append(document.createTextNode(locationNote));
else {const note=document.createElement('p');note.textContent=locationNote.trim();note.style.cssText='color:#aaa;font:11px/1.6 system-ui;max-width:1100px;margin:12px auto;padding:0 20px';(document.querySelector('footer')||document.body).append(note)}
start();setInterval(()=>track('heartbeat'),30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)track('heartbeat')});
})();
