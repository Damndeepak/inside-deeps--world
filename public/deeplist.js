const $ = id => document.getElementById(id);
const E = Object.fromEntries(['liveStatus','trackTitle','trackArtist','previousLine','currentLine','nextLine','progressFill','positionLabel','durationLabel','listen','audioStatus','videoWrap','pairToggle','pairPanel','createPair','revokePair','pairResult','pairUrl','pairToken','copyPair','pairStatus','channelSelect','channelLabel','myPlayer','pairPlayerLink','createOwnerPair','revokeOwnerPair'].map(id=>[id,$(id)]));
let snapshot = null, received = 0, trackId = '', lineIndex = -2, words = [], timer, frame = 0, lastFrame = 0, listening = false, player, playerReady = false, playerVideo = '', apiPromise;
let channel=new URLSearchParams(location.search).get('user')||'', channelEpoch=0, directoryTimer, mySessionPromise;
const time = ms => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function position() { if (!snapshot) return 0; return Math.min(snapshot.duration||86400000, snapshot.position + (snapshot.playing ? performance.now()-received : 0)); }
function renderLine(index) {
  if (index === lineIndex) return; lineIndex = index;
  const lines=snapshot?.lines||[], line=lines[index];
  E.previousLine.textContent=lines[index-1]?.text||''; E.nextLine.textContent=lines[index+1]?.text||'';
  E.currentLine.replaceChildren();words=[];
  if (!line) { E.currentLine.textContent=snapshot?.title||'The room is quiet.'; return; }
  function append(text, stamp){const span=document.createElement('span');span.className='word';span.textContent=text;E.currentLine.append(span);words.push({span,stamp});}
  let cursor=0;
  for(const stamp of line.words||[]){const at=line.text.indexOf(stamp.text,cursor);if(at<0||!stamp.text)continue;if(at>cursor)append(line.text.slice(cursor,at));append(stamp.text,stamp);cursor=at+stamp.text.length;}
  if(cursor<line.text.length)append(line.text.slice(cursor));
  E.currentLine.classList.remove('enter'); requestAnimationFrame(()=>E.currentLine.classList.add('enter'));
}
function paint() {
  if (!snapshot) return;
  const p=position(), lyricTime=p+(snapshot.offset||0), lines=snapshot.lines||[];
  let index=-1;for(let i=0;i<lines.length&&lines[i].time<=lyricTime;i++)index=i;
  renderLine(index);
  words.forEach(({span,stamp})=>span.classList.toggle('hot',!!stamp&&lyricTime>=stamp.start&&lyricTime<=stamp.end));
  E.progressFill.style.width=`${snapshot.duration?Math.min(100,p/snapshot.duration*100):0}%`;
  E.positionLabel.textContent=time(p);E.durationLabel.textContent=time(snapshot.duration||0);
}
function tick(now) { frame=0;if(document.hidden||!snapshot)return;if(now-lastFrame>=50){paint();lastFrame=now;}if(snapshot.playing)frame=requestAnimationFrame(tick); }
function wake(){cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);}
function offline(message='Deeplist is offline. Start live sharing in the app.') {snapshot=null;trackId='';E.trackTitle.textContent='Deeplist';E.trackArtist.textContent='';E.progressFill.style.width='0%';E.positionLabel.textContent='0:00';E.durationLabel.textContent='0:00';E.liveStatus.textContent=message;E.listen.disabled=true;E.previousLine.textContent='';E.nextLine.textContent='';E.currentLine.textContent='The room is quiet.';lineIndex=-2;cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();}
function syncAudio(force=false) {
  if (!listening||!playerReady||!snapshot) return;
  const p=position()/1000;
  if(playerVideo!==snapshot.id){playerVideo=snapshot.id;player.loadVideoById({videoId:snapshot.id,startSeconds:p});}
  else if(force||Math.abs(player.getCurrentTime()-p)>1.5)player.seekTo(p,true);
  if(snapshot.playing)player.playVideo();else player.pauseVideo();
}
async function poll() {
  clearTimeout(timer);if(document.hidden)return;
  const epoch=channelEpoch;
  const query=new URLSearchParams();if(channel)query.set('user',channel);if(snapshot?.lyricsVersion)query.set('lyricsVersion',snapshot.lyricsVersion);
  try{const start=performance.now();const r=await fetch('/api/deeplist/state'+(query.size?'?'+query:''),{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(epoch!==channelEpoch)return;
    if(!d.connected)offline();else{const previous=snapshot;const next=d.state;if(next.lines===undefined)next.lines=previous?.id===next.id&&previous?.lyricsVersion===next.lyricsVersion?previous.lines||[]:[];if(previous?.lyricsVersion!==next.lyricsVersion)lineIndex=-2;snapshot=next;const latency=Math.max(0,(performance.now()-start)/2);received=performance.now()-Math.max(0,d.serverNow-d.receivedAt)-latency;
      if(trackId!==snapshot.id){trackId=snapshot.id;lineIndex=-2;E.currentLine.replaceChildren();}
      E.trackTitle.textContent=snapshot.title;E.trackArtist.textContent=snapshot.artist;E.liveStatus.textContent=snapshot.playing?'DEEPLIST · LIVE':'DEEPLIST · PAUSED';E.listen.disabled=false;paint();wake();syncAudio();}
  }catch{if(epoch===channelEpoch)offline('Connection unavailable. Retrying…');}
  if(epoch===channelEpoch)timer=setTimeout(poll,2000);
}
function loadAPI(){if(window.YT?.Player)return Promise.resolve();if(apiPromise)return apiPromise;apiPromise=new Promise((resolve,reject)=>{const old=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{if(old)old();resolve();};const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=()=>reject(Error('YouTube could not load'));document.head.append(script);});return apiPromise;}
E.listen.onclick=async()=>{
  if(listening){listening=false;if(playerReady)player.pauseVideo();E.listen.textContent='Listen here';E.audioStatus.textContent='Audio stopped on this device.';return;}
  listening=true;E.listen.textContent='Stop listening';E.videoWrap.hidden=false;
  try{await loadAPI();if(!listening||!snapshot)return;
    if(!player)player=new YT.Player('youtubePlayer',{width:'100%',height:300,videoId:snapshot.id,playerVars:{origin:location.origin,playsinline:1},events:{onReady:()=>{playerReady=true;syncAudio(true);},onError:()=>{E.audioStatus.textContent='This track cannot play in the embedded player. Lyrics remain synced to Deeplist.';listening=false;E.listen.textContent='Listen here';},onAutoplayBlocked:()=>{E.audioStatus.textContent='Tap Play inside the YouTube player to enable audio.';}}});else syncAudio(true);
    E.audioStatus.textContent='Following Deeplist playback. Network delay and YouTube ads can affect audio alignment.';
  }catch{listening=false;E.listen.textContent='Listen here';E.audioStatus.textContent='YouTube could not load. Try again.';}
};
E.pairToggle.onclick=()=>{E.pairPanel.hidden=!E.pairPanel.hidden;if(!E.pairPanel.hidden)E.pairPanel.scrollIntoView({behavior:'smooth',block:'start'});};
function adminKey(){let key='';try{key=sessionStorage.getItem('cxAdminKey')||'';}catch{}return key||prompt('Website admin key (never sent to Deeplist):')||'';}
function session(){if(!mySessionPromise)mySessionPromise=fetch('/api/deeplist/me',{headers:{'X-Deeplist-Action':'session'},cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error('Could not create your connection. Check browser cookies.');return d;}).catch(e=>{mySessionPromise=null;throw e;});return mySessionPromise;}
function selectChannel(id){channel=id;channelEpoch++;clearTimeout(timer);listening=false;if(playerReady)player.pauseVideo();E.listen.textContent='Listen here';E.videoWrap.hidden=true;playerVideo='';offline();const url=new URL(location.href);if(id)url.searchParams.set('user',id);else url.searchParams.delete('user');history.replaceState(null,'',url.pathname+url.search);E.channelLabel.textContent=id?'Listener · '+id.slice(0,6)+'’s player':'Deepu’s player';ensureOption(id);E.channelSelect.value=id;poll();}
function ensureOption(id){if(!Array.from(E.channelSelect.options).some(o=>o.value===id)){const option=document.createElement('option');option.value=id;option.textContent='Listener · '+id.slice(0,6);E.channelSelect.append(option);}}
E.channelSelect.onchange=()=>selectChannel(E.channelSelect.value);
E.myPlayer.onclick=async()=>{try{const me=await session();selectChannel(me.channel);}catch(e){E.pairPanel.hidden=false;E.pairStatus.textContent=e.message;}};
async function pair(owner){let headers, endpoint;if(owner){const key=adminKey();if(!key)return;headers={'X-Admin-Key':key};endpoint='/api/deeplist/pair';}else{await session();headers={'X-Deeplist-Action':'pair'};endpoint='/api/deeplist/pair?scope=visitor';}const r=await fetch(endpoint,{method:'POST',headers});const d=await r.json();if(!r.ok)throw Error(d.error==='admin_required'?'Admin key is incorrect.':'Could not create pairing code.');E.pairUrl.value=d.website;E.pairToken.value=d.token;E.pairResult.hidden=false;E.pairPlayerLink.hidden=false;E.pairPlayerLink.href=d.channel?'/deeplist.html?user='+encodeURIComponent(d.channel):'/deeplist.html';E.pairPlayerLink.textContent=owner?'Open Deepu’s player ↗':'Open your player ↗';selectChannel(d.channel||'');E.pairStatus.textContent='Pairing code ready. Paste the URL and code into Deeplist, then Start live sharing.';}
E.createPair.onclick=async()=>{E.createPair.disabled=true;try{await pair(false);}catch(e){E.pairStatus.textContent=e.message;}finally{E.createPair.disabled=false;}};
E.createOwnerPair.onclick=async()=>{E.createOwnerPair.disabled=true;try{await pair(true);}catch(e){E.pairStatus.textContent=e.message;}finally{E.createOwnerPair.disabled=false;}};
E.copyPair.onclick=async()=>{try{await navigator.clipboard.writeText(E.pairToken.value);E.pairStatus.textContent='Pairing code copied.';}catch{E.pairToken.type='text';E.pairToken.select();E.pairStatus.textContent='Select and copy the pairing code.';}};
async function revoke(owner){let headers,endpoint;if(owner){const key=adminKey();if(!key)return;headers={'X-Admin-Key':key};endpoint='/api/deeplist/pair';}else{await session();headers={'X-Deeplist-Action':'pair'};endpoint='/api/deeplist/pair?scope=visitor';}const r=await fetch(endpoint,{method:'DELETE',headers});if(!r.ok)throw Error('Could not disconnect this connection.');E.pairResult.hidden=true;E.pairPlayerLink.hidden=true;E.pairToken.value='';E.pairStatus.textContent=owner?'Deepu’s app disconnected.':'Your app disconnected.';poll();loadDirectory();}
E.revokePair.onclick=async()=>{try{await revoke(false);}catch(e){E.pairStatus.textContent=e.message;}};
E.revokeOwnerPair.onclick=async()=>{try{await revoke(true);}catch(e){E.pairStatus.textContent=e.message;}};
async function loadDirectory(){clearTimeout(directoryTimer);if(document.hidden)return;try{const r=await fetch('/api/deeplist/listeners',{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();E.channelSelect.replaceChildren();const owner=document.createElement('option');owner.value='';owner.textContent='Deepu';E.channelSelect.append(owner);for(const visitor of d.listeners||[]){const option=document.createElement('option');option.value=visitor.channel;option.textContent=visitor.label+' · '+(visitor.playing?'live':'paused');E.channelSelect.append(option);}if(channel)ensureOption(channel);E.channelSelect.value=channel;}catch{}directoryTimer=setTimeout(loadDirectory,10000);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);clearTimeout(directoryTimer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();}else{poll();loadDirectory();}});
window.addEventListener('pagehide',()=>{clearTimeout(timer);clearTimeout(directoryTimer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();});
if(channel)ensureOption(channel);E.channelSelect.value=channel;E.channelLabel.textContent=channel?"Listener · "+channel.slice(0,6)+"’s player":"Deepu’s player";
loadDirectory();poll();
