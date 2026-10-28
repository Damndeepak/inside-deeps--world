const $=id=>document.getElementById(id);
const toggle=$('playerAdminToggle'),panel=$('playerAdminPanel'),login=$('playerAdminLogin'),keyInput=$('playerAdminKey'),tools=$('playerAdminTools'),list=$('playerAdminList'),status=$('playerAdminStatus');
let key='',epoch=0,busy=false;
function lock(){epoch++;key='';keyInput.value='';tools.hidden=true;login.hidden=false;list.replaceChildren();try{sessionStorage.removeItem('cxAdminKey');}catch{}status.textContent='Admin locked.';}
async function api(method='GET',channel,body){
 const r=await fetch('/api/deeplist/admin/players'+(channel?'?channel='+encodeURIComponent(channel):''),{method,cache:'no-store',headers:{'X-Admin-Key':key,'X-Deeplist-Action':'admin',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok){if(r.status===403){lock();throw Error('Admin key is incorrect.');}throw Error(data.error||'Could not update players.');}return data;
}
function changed(deleted){document.dispatchEvent(new CustomEvent('deeplist-players-updated',{detail:{deleted}}));}
function render(players){
 list.replaceChildren();
 for(const player of players){
  const row=document.createElement('form');row.className='player-admin-row';
  const label=document.createElement('label');label.textContent=player.owner?'Main player':(player.paired?'Connected player':'Unused connection');
  const input=document.createElement('input');input.value=player.label;input.maxLength=32;input.required=true;input.setAttribute('aria-label','Name for '+player.label);label.append(input);
  const note=document.createElement('p');note.className='note';note.textContent=player.owner?'Your main music player':player.lastPlayedAt?'Last shared: '+new Date(player.lastPlayedAt).toLocaleString():'No music shared yet';
  const save=document.createElement('button');save.type='submit';save.textContent='Save name';row.append(label,note,save);
  row.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;save.disabled=true;try{await api('PATCH',player.channel,{name:input.value});status.textContent='Player name saved.';changed();await load();}catch(e){status.textContent=e.message;}finally{busy=false;save.disabled=false;}};
  if(!player.owner){const remove=document.createElement('button');remove.type='button';remove.className='player-admin-delete';remove.textContent='Delete player';remove.onclick=async()=>{if(busy||!confirm('Delete '+player.label+'? Its app will be disconnected and it will disappear from the public player list.'))return;busy=true;remove.disabled=true;try{await api('DELETE',player.channel);status.textContent='Player deleted and app disconnected.';changed(player.channel);await load();}catch(e){status.textContent=e.message;}finally{busy=false;remove.disabled=false;}};row.append(remove);}
  list.append(row);
 }
}
async function load(){const version=epoch;const data=await api();if(version!==epoch)return;tools.hidden=false;login.hidden=true;keyInput.value='';render(data.players);}
toggle.onclick=async()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden)return;panel.scrollIntoView({behavior:'smooth',block:'start'});if(!key){try{key=sessionStorage.getItem('cxAdminKey')||'';}catch{}}if(key)try{await load();}catch(e){status.textContent=e.message;}else keyInput.focus();};
login.onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;key=keyInput.value;status.textContent='Checking admin access…';try{await load();try{sessionStorage.setItem('cxAdminKey',key);}catch{}status.textContent='Admin unlocked. Choose a player below.';}catch(e){status.textContent=e.message;}finally{busy=false;}};
$('playerAdminRefresh').onclick=async()=>{try{await load();status.textContent='Players refreshed.';}catch(e){status.textContent=e.message;}};
$('playerAdminLock').onclick=lock;
if(location.hash==='#admin')toggle.click();
