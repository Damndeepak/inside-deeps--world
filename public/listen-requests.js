const button=document.getElementById('listenRequest'),status=document.getElementById('listenRequestStatus');
let generation=0,timer,accepted=false;
const channel=()=>new URL(location.href).searchParams.get('user')||'owner';
function reset(){generation++;clearTimeout(timer);accepted=false;button.disabled=false;button.textContent='Listen together';status.textContent='Send a request to this listener’s Deeplist app.';}
async function api(path,options={}){
 const r=await fetch(path,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000),...options});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Could not send request. Try again.');return data;
}
async function poll(id,version,deadline){
 if(version!==generation)return;
 if(Date.now()>deadline){reset();status.textContent='Request expired. You can send another.';return;}
 if(document.hidden){timer=setTimeout(()=>poll(id,version,deadline),5000);return;}
 try{
  const result=await api('/api/deeplist/listen-request?id='+encodeURIComponent(id),{headers:{'X-Deeplist-Action':'listen-request'}});
  if(version!==generation)return;
  if(result.status==='pending'){timer=setTimeout(()=>poll(id,version,deadline),3000);return;}
  if(result.status==='accepted'){accepted=true;button.disabled=false;button.textContent='Accepted · Listen now';status.textContent='Tap Listen now to start the synced website player.';return;}
  reset();status.textContent=result.status==='rejected'?'Request declined.':'Request expired.';
 }catch(e){if(version===generation){reset();status.textContent=e.message;}}
}
button.addEventListener('click',async()=>{
 if(accepted){document.getElementById('listen').click();return;}
 const version=++generation,target=channel();button.disabled=true;status.textContent='Sending…';
 try{
  await api('/api/deeplist/me',{headers:{'X-Deeplist-Action':'session'}});
  const data=await api('/api/deeplist/listen-request',{method:'POST',headers:{'Content-Type':'application/json','X-Deeplist-Action':'listen-request'},body:JSON.stringify({channel:target})});
  if(version!==generation)return;
  button.textContent='Waiting for reply';status.textContent='Accept or reject will appear in their app. Request expires in two minutes.';
  poll(data.id,version,Date.now()+120000);
 }catch(e){if(version===generation){reset();status.textContent=e.message;}}
});
document.addEventListener('deeplist-channel-changed',reset);reset();
