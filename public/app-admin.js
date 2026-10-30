const $=s=>document.querySelector(s),status=$('#status');
let users=[],next=null,busy=false,key='',unlocked=false,epoch=0;
const text=(tag,value)=>{const el=document.createElement(tag);el.textContent=value;return el};
function lock(message='Dashboard locked.'){
 epoch++;unlocked=false;key='';users=[];next=null;
 $('#adminKey').value='';$('#login').hidden=false;$('#dashboard').hidden=true;$('#refresh').hidden=true;
 for(const id of ['users','shared','audit','stats'])$('#'+id).replaceChildren();
 try{sessionStorage.removeItem('cxAdminKey')}catch{}
 status.textContent=message;
}
async function api(path,options={}){
 const r=await fetch('/api/app/'+path,{...options,headers:{'Content-Type':'application/json',...(key&&path.startsWith('admin/')?{'X-Admin-Key':key}:{}),...options.headers},cache:'no-store',signal:AbortSignal.timeout(8000)});
 const data=await r.json();if(!r.ok){const e=new Error(data.error||'Request failed');e.status=r.status;throw e}return data;
}
function render(){
 const root=$('#users');root.replaceChildren();const term=$('#filter').value.toLowerCase();
 if(!users.length){root.append(text('p','No updated-app accounts yet. Users appear after signing in with Google or Guest in the new APK. Older app versions do not send this account activity.'));}
 for(const u of users.filter(u=>(u.name+' '+u.username).toLowerCase().includes(term))){
  const row=document.createElement('article');row.className='user';const info=document.createElement('div');
  info.append(text('strong',u.name),text('p','@'+u.username+' · '+u.provider),text('p','Approx location: '+([u.city,u.country].filter(Boolean).join(', ')||'unavailable')),text('small',(Date.now()-u.last_active<600000?'Active recently':'Last active '+new Date(u.last_active).toLocaleString())+' · '+(u.app_version||'Version unknown')+' · '+u.opens+' recorded opens'));
  const button=text('button',u.blocked?'Unblock':'Block');
  button.onclick=async()=>{
   if(busy||!confirm((u.blocked?'Unblock ':'Block ')+u.name+'?'))return;
   const version=epoch;busy=true;button.disabled=true;
   try{await api('admin/access',{method:'POST',body:JSON.stringify({id:u.id,blocked:!u.blocked})});if(version!==epoch)return;u.blocked=!u.blocked;render();await audit(version)}
   catch(e){if(version===epoch){if(e.status===401||e.status===403)lock(e.message);else{status.textContent=e.message;button.disabled=false}}}
   finally{busy=false}
  };
  row.append(info,button);root.append(row);
 }
 $('#stats').textContent=users.length+' loaded app users · '+users.filter(u=>Date.now()-u.last_active<600000).length+' active recently · '+users.filter(u=>u.blocked).length+' blocked';$('#more').hidden=!next;
}
async function audit(version){
 const {events}=await api('admin/audit');if(version!==epoch)return;
 $('#audit').replaceChildren(...events.map(e=>text('p',e.action+' · '+(users.find(u=>u.id===e.target)?.name||e.target)+' · '+new Date(e.at).toLocaleString())));
 if(!events.length)$('#audit').append(text('p','No block/unblock actions yet.'));
}
async function shared(version){
 try{
  const r=await fetch('/api/deeplist/listeners',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('unavailable');
  const {listeners=[]}=await r.json();if(version!==epoch)return;
  const root=$('#shared');root.replaceChildren();
  for(const item of listeners){const row=document.createElement('article');row.className='user';const info=document.createElement('div');
   info.append(text('strong',item.label),text('p',(item.live?(item.playing?'Playing: ':'Paused: '):'Last shared: ')+(item.title||'Unknown song')+' · '+(item.artist||'Unknown artist')));
   if(!item.live&&item.lastPlayedAt)info.append(text('small',new Date(item.lastPlayedAt).toLocaleString()));
   const link=text('a','Open shared player');link.href='/deeplist.html?user='+encodeURIComponent(item.channel);row.append(info,link);root.append(row);
  }
  if(!listeners.length)root.append(text('p','No shared playback connections yet.'));
 }catch{if(version===epoch)$('#shared').replaceChildren(text('p','Shared playback is unavailable. App user records above are separate.'))}
}
async function load(append=false){
 if(busy||!unlocked)return;busy=true;const version=epoch;status.textContent='Loading app users…';
 try{
  const query=append&&next?'?'+new URLSearchParams(next):'';
  const data=await api('admin/users'+query);if(version!==epoch)return;
  users=append?[...users,...data.users]:data.users;next=data.next;render();
  await Promise.all([audit(version),shared(version)]);if(version===epoch)status.textContent='';
 }catch(e){if(version===epoch){if(e.status===401||e.status===403)lock(e.message);else status.textContent=e.message}}
 finally{busy=false}
}
async function unlock(){
 const version=epoch;
 try{await api('admin/status');if(version!==epoch)return;
  unlocked=true;$('#adminKey').value='';$('#login').hidden=true;$('#dashboard').hidden=false;$('#refresh').hidden=false;
  if(key)try{sessionStorage.setItem('cxAdminKey',key)}catch{}
  await load();
 }catch(e){if(version===epoch)lock(e.message)}
}
$('#adminLogin').onsubmit=async e=>{e.preventDefault();if(busy)return;key=$('#adminKey').value;$('#unlock').disabled=true;status.textContent='Checking admin access…';try{await unlock()}finally{$('#unlock').disabled=false}};
$('#filter').oninput=render;$('#more').onclick=()=>load(true);$('#refresh').onclick=()=>load();
$('#logout').onclick=async()=>{const google=!key;lock();if(google)try{await api('session',{method:'DELETE'})}catch{}};
try{key=sessionStorage.getItem('cxAdminKey')||''}catch{}
if(key)await unlock();
else try{const {user}=await api('me');if(user.admin&&!user.blocked)await unlock()}catch{}
try{const config=await api('config');$('#googleLogin').hidden=!config.googleConfigured}catch{}
setInterval(()=>{if(unlocked&&!document.hidden)load()},60000);
document.addEventListener('visibilitychange',()=>{if(unlocked&&!document.hidden)load()});
