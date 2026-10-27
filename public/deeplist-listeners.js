import {identityColor,identityLabel} from './chat-identity.js';
(()=>{
const box=document.getElementById('deeplistListeners');if(!box)return;let timer,loading=false,expiryTimers=[],failures=0;
const cards=new Map();
function clearExpiries(){expiryTimers.forEach(clearTimeout);expiryTimers=[];}
async function load(){
 clearTimeout(timer);if(document.hidden||loading)return;loading=true;const pollStarted=performance.now();
 try{
  const started=performance.now(),r=await fetch('/api/deeplist/listeners',{cache:'no-store',signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error();const d=await r.json();
  const count=document.getElementById('deeplistConnectionCount');if(count)count.textContent=Number.isInteger(d.totalConnected)?d.totalConnected+' music connections recorded':'';
  clearExpiries();
  const wanted=new Set((d.listeners||[]).map(v=>v.channel));
  for(const [channel,card] of cards)if(!wanted.has(channel)){card.remove();cards.delete(channel)}
  if(!cards.size&&d.listeners?.length)box.replaceChildren();
  if(!d.listeners?.length){const message='No other listeners are sharing right now. Connect your Deeplist to join.';if(box.textContent!==message){const empty=document.createElement('p');empty.className='world-note';empty.textContent=message;box.replaceChildren(empty);}}
  let index=0;
  for(const visitor of d.listeners||[]){
   let card=cards.get(visitor.channel);
   if(!card){
   card=document.createElement('a');card.className='world-track deeplist-listener-card';card.href='/deeplist.html?user='+encodeURIComponent(visitor.channel);
   const cover=document.createElement('div');cover.className='deeplist-listener-cover';cover.textContent='d.';
   const info=document.createElement('div');info.className='deeplist-listener-info';const name=document.createElement('strong'),song=document.createElement('span'),status=document.createElement('small');
   info.append(name,song,status);card.append(cover,info);card._parts={cover,name,song,status};cards.set(visitor.channel,card);
   }
   const {cover,name,song,status}=card._parts;
   if(card._coverId!==visitor.id){
    card._coverId=visitor.id;cover.textContent='d.';
    if(/^[A-Za-z0-9_-]{11}$/.test(visitor.id||'')){const img=document.createElement('img');img.src='https://i.ytimg.com/vi/'+visitor.id+'/hqdefault.jpg';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>{cover.textContent='d.'};cover.replaceChildren(img)}
   }
   const label=identityLabel(visitor.label,visitor.symbol),track=visitor.title+' · '+visitor.artist;
   if(name.textContent!==label)name.textContent=label;
   name.style.color=visitor.color?identityColor(visitor.color):'';
   if(song.textContent!==track)song.textContent=track;
   const lastShared='Last shared · '+new Date(visitor.lastPlayedAt).toLocaleDateString();
   const remaining=15000-Math.max(0,(d.serverNow??Date.now())-visitor.lastPlayedAt)-(performance.now()-started);
   const live=visitor.live===true&&remaining>0;
   name.className=live&&visitor.playing===true?'deeplist-live-indicator':'';
   status.textContent=live?(visitor.playing?'Live · open synced lyrics':'Paused · open synced lyrics'):lastShared;
   if(live)expiryTimers.push(setTimeout(()=>{name.className='';status.textContent=lastShared;},remaining));
   if(box.children[index]!==card)box.insertBefore(card,box.children[index]||null);
   index++;
  }
 failures=0;
 }catch{failures++;clearExpiries();cards.clear();const message='Connected listeners are unavailable right now.';if(box.textContent!==message)box.textContent=message;}
 finally{loading=false;}
 timer=setTimeout(()=>{if((window.worldIsVisible||(()=>!document.hidden))(box.closest('section')))load();else timer=setTimeout(load,15000);},failures?Math.min(10000,1000*2**(failures-1)):Math.max(0,750-(performance.now()-pollStarted)));
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);box.querySelectorAll('.deeplist-live-indicator').forEach(node=>node.classList.remove('deeplist-live-indicator'));}else load();});document.addEventListener('deeplist-identity-updated',load);
  load();
})();
