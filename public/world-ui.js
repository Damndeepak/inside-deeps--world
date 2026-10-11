(()=>{
'use strict';
const $=id=>document.getElementById(id);
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
const safeURL=u=>{try{const a=new URL(u);return a.protocol==='https:'?a.href:''}catch{return''}};
const stamp=iso=>new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
function status(node,msg,error=false){if(!node)return;node.textContent=msg;node.classList.toggle('error',error)}
async function api(path,options={}){const r=await fetch(path,{cache:'no-store',...options});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||'Please try again');return d}
function art(track){const box=el('div','world-art','♪'),src=safeURL(track.image);if(src&&!src.includes('2a96cbd8b46e442fc41c2b86b821562f')){const img=el('img');img.src=src;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>box.replaceChildren(document.createTextNode('♪'));box.textContent='';box.append(img)}return box}
function trackLink(t,cls){const href=safeURL(t.url),a=el(href?'a':'div',cls);if(href){a.href=href;a.target='_blank';a.rel='noopener noreferrer'}return a}
async function history(){
  const box=$('worldHistory');if(!box)return;
  try{const d=await api('/api/lastfm/history');box.replaceChildren();if(!d.tracks.length){box.append(el('p','world-note',d.configured?'No recent tracks yet.':'Last.fm is not configured yet.'));return}
    for(const t of d.tracks){const a=trackLink(t,'world-track');a.append(art(t),el('strong','',t.name),el('span','',t.artist));if(t.played_at)a.append(el('small','',stamp(t.played_at*1000)));box.append(a)}
  }catch(e){box.replaceChildren(el('p','world-note',e.message))}
}
history();if($('worldHistory'))setInterval(()=>{if(!document.hidden)history()},60000);
async function repeat(){
  const box=$('worldRepeat');if(!box)return;
  try{const d=await api('/api/lastfm/on-repeat');box.replaceChildren();if(!d.tracks.length){box.append(el('p','world-empty',d.configured?'Your week is still quiet. Tracks will appear as you listen.':'Connect the owner’s Last.fm configuration to fill this page.'));return}
    d.tracks.forEach((t,i)=>{const a=trackLink(t,'world-rank'),info=el('div');info.append(el('strong','',t.name),el('span','',t.artist));a.append(el('small','',String(i+1).padStart(2,'0')),art(t),info,el('span','plays',t.plays+' plays'));box.append(a)});
  }catch(e){box.replaceChildren(el('p','world-empty',e.message));const b=el('button','world-button','Retry');b.onclick=repeat;box.append(b)}
}repeat();
let identity=null;
async function ensureUser(){if(!identity)identity=api('/api/user').catch(e=>{identity=null;throw e});return identity}
let adminKey='';try{adminKey=sessionStorage.getItem('cxAdminKey')||''}catch{}
let isAdmin=false;
async function checkAdmin(){if(!adminKey)return false;try{return!!(await api('/api/chat/admin/check',{headers:{'X-Admin-Key':adminKey}})).admin}catch{return false}}
const adminHeaders=()=>isAdmin?{'X-Admin-Key':adminKey}:{};
async function guests(){
  const box=$('worldGuests');if(!box)return;
  try{const d=await api('/api/guestbook');box.replaceChildren();if(!d.entries.length)box.append(el('p','world-note','No notes yet. Leave the first little trace.'));
    d.entries.forEach(g=>{const card=el('article','world-entry'),head=el('header');head.append(el('span','',g.name),el('time','',stamp(g.created_at)));card.append(head,el('p','',g.message));if(g.mine||isAdmin){const b=el('button','world-delete','Delete');b.onclick=async()=>{if(!confirm('Delete this guestbook note?'))return;b.disabled=true;try{await api('/api/guestbook/'+g.id,{method:'DELETE',headers:adminHeaders()});await guests()}catch(e){status($('worldGuestStatus'),e.message,true);b.disabled=false}};card.append(b)}box.append(card)});
  }catch(e){status($('worldGuestStatus'),e.message,true)}
}
if($('worldGuestForm')){
  guests();
  $('worldGuestForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('worldGuestSend');b.disabled=true;status($('worldGuestStatus'),'Saving your note…');
    try{await ensureUser();await api('/api/guestbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('worldGuestName').value,message:$('worldGuestText').value})});$('worldGuestText').value='';status($('worldGuestStatus'),'You left a little trace.');await guests()}catch(e){status($('worldGuestStatus'),e.message,true)}finally{b.disabled=false}
  });
}
async function memories(){
  const box=$('worldMemories');if(!box)return;
  try{const d=await api('/api/memories');box.replaceChildren();if(!d.memories.length){box.append(el('p','world-empty','No memories on the wall yet. Deep can add the first one using admin mode.'));return}
    d.memories.forEach(m=>{const card=el('figure','world-memory'),a=el('a'),img=el('img');a.href='/api/memories/'+m.id+'/image';a.target='_blank';a.rel='noopener';img.src=a.href;img.alt=m.caption||'Memory photo';img.loading='lazy';a.append(img);const cap=el('figcaption');cap.append(el('time','',stamp(m.memory_date+'T12:00:00')),el('span','',m.caption));if(isAdmin){const b=el('button','world-delete','Delete memory');b.onclick=async()=>{if(!confirm('Delete this photo and caption?'))return;b.disabled=true;try{await api('/api/memories/'+m.id,{method:'DELETE',headers:adminHeaders()});await memories()}catch(e){status($('worldMemoryStatus'),e.message,true);b.disabled=false}};cap.append(document.createElement('br'),b)}card.append(a,cap);box.append(card)});
  }catch(e){status($('worldMemoryStatus'),e.message,true)}
}
// Record one Memory Wall opening using the existing chat identity.
if($('worldMemories'))ensureUser().then(()=>api('/api/memories/visits',{method:'POST'})).catch(()=>{});
let visitorEpoch=0;
async function memoryVisitors(){
  const panel=$('worldMemoryVisitors'),box=$('worldMemoryVisitorList');if(!panel||!box)return;
  const epoch=++visitorEpoch,key=adminKey;
  panel.hidden=!isAdmin;box.replaceChildren();if(!isAdmin)return;
  box.append(el('p','world-note','Loading visitors…'));
  try{
    const d=await api('/api/memories/visits',{headers:adminHeaders()});
    if(epoch!==visitorEpoch||!isAdmin||key!==adminKey)return;
    box.replaceChildren();
    if(!d.visitors.length)box.append(el('p','world-note','No recorded visitors yet.'));
    d.visitors.forEach(v=>{const row=el('div','world-entry'),head=el('header'),time=el('time');time.dateTime=v.last_seen_at;time.textContent='Last visit · '+new Date(v.last_seen_at).toLocaleString();head.append(el('span','','@'+v.username),time);row.append(head);box.append(row)});
  }catch(e){if(epoch===visitorEpoch&&isAdmin)box.replaceChildren(el('p','world-note',e.message))}
}
if($('worldMemoryVisitors'))setInterval(()=>{if(isAdmin&&!document.hidden)memoryVisitors()},30000);
function paintAdmin(){visitorEpoch++;if($('worldMemoryVisitors')){$('worldMemoryVisitors').hidden=!isAdmin;if(!isAdmin)$('worldMemoryVisitorList').replaceChildren()}document.querySelectorAll('[data-world-admin]').forEach(b=>b.textContent=isAdmin?'Exit admin':'Admin');if($('worldMemoryForm'))$('worldMemoryForm').hidden=!isAdmin}
async function toggleAdmin(){
  if(isAdmin){isAdmin=false;adminKey='';try{sessionStorage.removeItem('cxAdminKey')}catch{}}
  else{const key=prompt('Admin key');if(!key)return;adminKey=key.trim();isAdmin=await checkAdmin();if(!isAdmin){alert('Could not verify admin access');adminKey='';return}try{sessionStorage.setItem('cxAdminKey',adminKey)}catch{}}
  paintAdmin();guests();memories();memoryVisitors();window.dispatchEvent(new CustomEvent('world-admin-change'));
}
document.querySelectorAll('[data-world-admin]').forEach(b=>b.addEventListener('click',toggleAdmin));
window.addEventListener('world-admin-change',async()=>{try{adminKey=sessionStorage.getItem('cxAdminKey')||''}catch{}isAdmin=await checkAdmin();paintAdmin();guests();memories();memoryVisitors()});
(async()=>{isAdmin=await checkAdmin();paintAdmin();if(isAdmin)guests();memories();memoryVisitors()})();
if($('worldMemoryForm')){
  $('worldMemoryDate').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  $('worldMemoryForm').addEventListener('submit',async e=>{e.preventDefault();const b=$('worldMemorySend');b.disabled=true;status($('worldMemoryStatus'),'Uploading photo…');try{const f=$('worldMemoryFile').files[0];if(!f||f.size>8*1024*1024)throw new Error('Choose a JPG, PNG, WebP or GIF under 8 MB');const form=new FormData();form.append('image',f);form.append('date',$('worldMemoryDate').value);form.append('caption',$('worldMemoryCaption').value);await api('/api/memories',{method:'POST',headers:adminHeaders(),body:form});$('worldMemoryFile').value='';$('worldMemoryCaption').value='';status($('worldMemoryStatus'),'Memory added.');await memories()}catch(e){status($('worldMemoryStatus'),e.message,true)}finally{b.disabled=false}});
}
})();
