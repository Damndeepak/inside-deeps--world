const $=id=>document.getElementById(id),dash=$('dashboard');let key='',epoch=0,busy=false,cursor=null,history=false;
try{key=sessionStorage.getItem('cxAdminKey')||''}catch{}
const date=n=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(n));
const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e};
function clear(){epoch++;key='';cursor=null;history=false;dash.hidden=true;$('login').hidden=false;for(const id of ['visitors','sessions','events'])$(id).replaceChildren();try{sessionStorage.removeItem('cxAdminKey')}catch{}}
function rows(id,values){const box=$(id);box.replaceChildren();for(const cells of values){const row=node('tr');for(const cell of cells)row.append(node('td',cell));box.append(row)}if(!values.length){const row=node('tr'),cell=node('td','No records yet.');cell.colSpan=5;row.append(cell);box.append(row)}}
const labels={page_view:'Opened page',message_sent:'Sent message',message_deleted:'Deleted message',reaction_added:'Added reaction',reaction_removed:'Removed reaction'};
async function load(older=false){
 if(!key||busy)return;busy=true;const version=epoch,current=key;$('older').disabled=true;
 try{
  const query=older&&cursor?'?before='+cursor.at+'&before_id='+encodeURIComponent(cursor.id):'';
  const r=await fetch('/api/admin/activity'+query,{headers:{'X-Admin-Key':current},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const d=await r.json();if(version!==epoch||key!==current)return;
  if(r.status===403){clear();throw Error('Incorrect admin key or access expired.')}
  if(!r.ok||!d.success)throw Error(d.error||'Could not load activity.');
  dash.hidden=false;$('login').hidden=true;$('key').value='';$('status').textContent='Updated '+date(Date.now());
  rows('visitors',d.visitors.map(v=>['@'+v.username+(Date.now()-v.last_seen<60000?' · online':''),date(v.first_seen),date(v.last_seen),String(v.views),String(v.sessions)]));
  rows('sessions',d.sessions.map(v=>['@'+v.username,v.page,date(v.first_seen),date(v.last_seen),[v.device,v.browser,v.os].join(' · ')]));
  if(!older)$('events').replaceChildren();
  for(const event of d.events){const item=node('li'),detail=event.details||{};item.append(node('time',date(event.at)),node('strong','@'+event.actor_name+' · '+(labels[event.action]||event.action)),node('div',[detail.page,detail.emoji,detail.type,detail.author?'Author: @'+detail.author:'',event.target_id?'Message: '+event.target_id:'',detail.by_admin?'Deleted by admin':''].filter(Boolean).join(' · ')));$('events').append(item)}
  if(!$('events').children.length)$('events').append(node('li','No events yet.'));
  if(d.events.length){const last=d.events.at(-1);cursor={at:last.at,id:last.id}}
  $('older').hidden=!d.has_more;if(older)history=true;
 }catch(e){if(version===epoch||!key)$('status').textContent=e.message}
 finally{busy=false;$('older').disabled=false}
}
$('login').addEventListener('submit',e=>{e.preventDefault();epoch++;key=$('key').value.trim();try{sessionStorage.setItem('cxAdminKey',key)}catch{}load()});
$('lock').addEventListener('click',()=>{clear();$('status').textContent='Dashboard locked.'});
$('refresh').addEventListener('click',()=>{history=false;load()});$('older').addEventListener('click',()=>load(true));
setInterval(()=>{if(!document.hidden&&!dash.hidden&&!history)load()},15000);if(key)load();
