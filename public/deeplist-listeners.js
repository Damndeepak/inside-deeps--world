(()=>{
const box=document.getElementById('deeplistListeners');if(!box)return;let timer,loading=false,expiryTimers=[];
function clearExpiries(){expiryTimers.forEach(clearTimeout);expiryTimers=[];}
async function load(){
 clearTimeout(timer);if(document.hidden||loading)return;loading=true;
 try{
  const started=performance.now(),r=await fetch('/api/deeplist/listeners',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();
  const count=document.getElementById('deeplistConnectionCount');if(count)count.textContent=Number.isInteger(d.totalConnected)?d.totalConnected+' music connections recorded':'';
  clearExpiries();box.replaceChildren();
  if(!d.listeners?.length){const empty=document.createElement('p');empty.className='world-note';empty.textContent='No other listeners are sharing right now. Connect your Deeplist to join.';box.append(empty);}
  for(const visitor of d.listeners||[]){
   const card=document.createElement('a');card.className='world-track';card.style.padding='12px';card.style.border='1px solid rgba(127,127,127,.18)';card.style.borderRadius='14px';card.style.flex='0 0 210px';card.href='/deeplist.html?user='+encodeURIComponent(visitor.channel);
   const info=document.createElement('div'),name=document.createElement('strong'),song=document.createElement('span'),status=document.createElement('small');
   name.textContent=visitor.label;song.textContent=visitor.title+' · '+visitor.artist;
   const lastShared='Last shared · '+new Date(visitor.lastPlayedAt).toLocaleDateString();
   const remaining=15000-Math.max(0,(d.serverNow??Date.now())-visitor.lastPlayedAt)-(performance.now()-started);
   const live=visitor.live===true&&remaining>0;
   if(live&&visitor.playing===true)name.className='deeplist-live-indicator';
   status.textContent=live?(visitor.playing?'Live · open synced lyrics':'Paused · open synced lyrics'):lastShared;
   if(live)expiryTimers.push(setTimeout(()=>{name.className='';status.textContent=lastShared;},remaining));
   info.append(name,song,status);card.append(info);box.append(card);
  }
 }catch{clearExpiries();box.textContent='Connected listeners are unavailable right now.';}
 finally{loading=false;}
 timer=setTimeout(()=>{if((window.worldIsVisible||(()=>!document.hidden))(box.closest('section')))load();else timer=setTimeout(load,15000);},10000);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);box.querySelectorAll('.deeplist-live-indicator').forEach(node=>node.classList.remove('deeplist-live-indicator'));}else load();});load();
})();
