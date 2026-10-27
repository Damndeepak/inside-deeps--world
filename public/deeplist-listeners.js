import {identityColor,identityLabel} from './chat-identity.js';
(()=>{
const box=document.getElementById('deeplistListeners');if(!box)return;let timer,loading=false,expiryTimers=[];
function clearExpiries(){expiryTimers.forEach(clearTimeout);expiryTimers=[];}
async function load(){
 clearTimeout(timer);if(document.hidden||loading)return;loading=true;const pollStarted=performance.now();
 try{
  const started=performance.now(),r=await fetch('/api/deeplist/listeners',{cache:'no-store',signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error();const d=await r.json();
  const count=document.getElementById('deeplistConnectionCount');if(count)count.textContent=Number.isInteger(d.totalConnected)?d.totalConnected+' music connections recorded':'';
  clearExpiries();box.replaceChildren();
  if(!d.listeners?.length){const empty=document.createElement('p');empty.className='world-note';empty.textContent='No other listeners are sharing right now. Connect your Deeplist to join.';box.append(empty);}
  for(const visitor of d.listeners||[]){
   const card=document.createElement('a');card.className='world-track deeplist-listener-card';card.href='/deeplist.html?user='+encodeURIComponent(visitor.channel);
   const cover=document.createElement('div');cover.className='deeplist-listener-cover';cover.textContent='d.';if(/^[A-Za-z0-9_-]{11}$/.test(visitor.id||'')){const img=document.createElement('img');img.src='https://i.ytimg.com/vi/'+visitor.id+'/hqdefault.jpg';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{cover.textContent='d.';};cover.replaceChildren(img);}
   const info=document.createElement('div');info.className='deeplist-listener-info';const name=document.createElement('strong'),song=document.createElement('span'),status=document.createElement('small');
   name.textContent=identityLabel(visitor.label,visitor.symbol);if(visitor.color)name.style.color=identityColor(visitor.color);song.textContent=visitor.title+' · '+visitor.artist;
   const lastShared='Last shared · '+new Date(visitor.lastPlayedAt).toLocaleDateString();
   const remaining=15000-Math.max(0,(d.serverNow??Date.now())-visitor.lastPlayedAt)-(performance.now()-started);
   const live=visitor.live===true&&remaining>0;
   if(live&&visitor.playing===true)name.className='deeplist-live-indicator';
   status.textContent=live?(visitor.playing?'Live · open synced lyrics':'Paused · open synced lyrics'):lastShared;
   if(live)expiryTimers.push(setTimeout(()=>{name.className='';status.textContent=lastShared;},remaining));
   info.append(name,song,status);card.append(cover,info);box.append(card);
  }
 }catch{clearExpiries();box.textContent='Connected listeners are unavailable right now.';}
 finally{loading=false;}
 timer=setTimeout(()=>{if((window.worldIsVisible||(()=>!document.hidden))(box.closest('section')))load();else timer=setTimeout(load,15000);},Math.max(0,750-(performance.now()-pollStarted)));
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);box.querySelectorAll('.deeplist-live-indicator').forEach(node=>node.classList.remove('deeplist-live-indicator'));}else load();});document.addEventListener('deeplist-identity-updated',load);
  load();
})();
