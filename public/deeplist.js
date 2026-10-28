const $ = id => document.getElementById(id);
const E = Object.fromEntries(['openApp','remoteControls','remotePlay','remoteSeek','remoteStatus','displayName','saveName','liveStatus','trackTitle','trackArtist','liveStage','lyricsWindow','lyricsMessage','currentLine','liveAppleSize','liveAppleSpacing','liveAppleBlur','liveAppleMotion','progressFill','positionLabel','durationLabel','listen','audioStatus','videoWrap','pairToggle','pairPanel','createPair','revokePair','pairResult','pairUrl','pairToken','copyPair','pairStatus','channelSelect','channelLabel','myPlayer','pairPlayerLink','createOwnerPair','revokeOwnerPair'].map(id=>[id,$(id)]));
let snapshot = null, received = 0, trackId = '', lineIndex = -2, timer, frame = 0, listening = false, player, playerReady = false, playerVideo = '', apiPromise;
let freshnessTimer, pollController, ownerName='damndeepak';
let canControl=false, controlPending=false, lyricRows=[], timelineVersion='';
let channel=new URLSearchParams(location.search).get('user')||'', channelEpoch=0, directoryTimer, mySessionPromise;
const time = ms => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
function position() { if (!snapshot) return 0; return Math.min(snapshot.duration||86400000, snapshot.position + (snapshot.playing ? performance.now()-received : 0)); }
function paint() {
  if (!snapshot) return;
  const p=position(), lyricTime=p+(snapshot.offset||0);
  paintAppleLyrics(lyricTime);
  E.liveStage.classList.toggle('am-playing',snapshot.playing&&!document.hidden);
  E.liveStatus.classList.toggle('deeplist-live-indicator',snapshot.playing&&!document.hidden);
  E.progressFill.style.width=`${snapshot.duration?Math.min(100,p/snapshot.duration*100):0}%`;
  E.positionLabel.textContent=time(p);E.durationLabel.textContent=time(snapshot.duration||0);
}
function tick(now) { frame=0;if(document.hidden||!snapshot)return;paint();if(snapshot.playing)frame=requestAnimationFrame(tick); }
function wake(){cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);}
function offline(message='Deeplist is offline. Start live sharing in the app.') {clearTimeout(freshnessTimer);snapshot=null;trackId='';E.trackTitle.textContent='Deeplist';E.trackArtist.textContent='';E.progressFill.style.width='0%';E.positionLabel.textContent='0:00';E.durationLabel.textContent='0:00';E.liveStatus.textContent=message;E.listen.disabled=true;resetAppleLyrics('The room is quiet.');E.liveStage.classList.remove('am-playing');E.liveStatus.classList.remove('deeplist-live-indicator');cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();}
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
  pollController?.abort();const controller=new AbortController();pollController=controller;
  const started=performance.now(),deadline=setTimeout(()=>controller.abort(),1500);
  const query=new URLSearchParams();if(channel)query.set('user',channel);if(snapshot?.lyricsVersion)query.set('lyricsVersion',snapshot.lyricsVersion);
  try{const start=performance.now();const r=await fetch('/api/deeplist/state'+(query.size?'?'+query:''),{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();const d=await r.json();if(epoch!==channelEpoch||pollController!==controller)return;if(controller.signal.aborted)throw Error('Request expired');
    if(channel&&d.label){E.channelLabel.textContent=d.label+'’s player';ensureOption(channel);Array.from(E.channelSelect.options).find(o=>o.value===channel).textContent=d.label;}if(!d.connected)offline();else{const previous=snapshot;const next=d.state;if(next.lines===undefined)next.lines=previous?.id===next.id&&previous?.lyricsVersion===next.lyricsVersion?previous.lines||[]:[];if(previous?.lyricsVersion!==next.lyricsVersion)lineIndex=-2;snapshot=next;buildAppleLyrics();const latency=Math.max(0,(performance.now()-start)/2);received=performance.now()-Math.max(0,d.serverNow-d.receivedAt)-latency;clearTimeout(freshnessTimer);freshnessTimer=setTimeout(()=>offline(),Math.max(0,15000-(performance.now()-received)));
      if(trackId!==snapshot.id){trackId=snapshot.id;lineIndex=-2;}
      E.trackTitle.textContent=snapshot.title;E.trackArtist.textContent=snapshot.artist;E.liveStatus.textContent=snapshot.playing?'DEEPLIST · LIVE':'DEEPLIST · PAUSED';E.listen.disabled=false;E.remoteSeek.max=String(snapshot.duration/1000);if(document.activeElement!==E.remoteSeek)E.remoteSeek.value=String(position()/1000);paint();wake();syncAudio();}
  }catch{if(epoch===channelEpoch&&pollController===controller)offline('Connection unavailable. Retrying…');}
  finally{clearTimeout(deadline);}
  if(epoch===channelEpoch&&pollController===controller)timer=setTimeout(poll,Math.max(0,500-(performance.now()-started)));
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
E.pairToggle.onclick=async()=>{E.pairPanel.hidden=false;E.pairPanel.scrollIntoView({behavior:'smooth',block:'start'});E.pairToggle.disabled=true;try{let owner=false;try{owner=!!sessionStorage.getItem('cxAdminKey');}catch{}if(owner){await pair(true);}else{const me=await session();if(!me.paired)await pair(false);else E.pairStatus.textContent='Your browser is paired. Use Connect my app to reconnect, or Disconnect my app.';}}catch(e){E.pairStatus.textContent=e.message;}finally{E.pairToggle.disabled=false;}};
function adminKey(){let key='';try{key=sessionStorage.getItem('cxAdminKey')||'';}catch{}key=key||prompt('Website admin key (never sent to Deeplist):')||'';if(key)sessionStorage.setItem('cxAdminKey',key);return key;}
function session(){if(!mySessionPromise)mySessionPromise=fetch('/api/deeplist/me',{headers:{'X-Deeplist-Action':'session'},cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error('Could not create your connection. Check browser cookies.');E.displayName.value=d.displayName||'';return d;}).catch(e=>{mySessionPromise=null;throw e;});return mySessionPromise;}
function selectChannel(id){channel=id;canControl=false;E.remoteControls.hidden=true;timelineVersion='';channelEpoch++;checkControl();clearTimeout(timer);listening=false;if(playerReady)player.pauseVideo();E.listen.textContent='Listen here';E.videoWrap.hidden=true;playerVideo='';offline();const url=new URL(location.href);if(id)url.searchParams.set('user',id);else url.searchParams.delete('user');history.replaceState(null,'',url.pathname+url.search);E.channelLabel.textContent=id?'Listener · '+id.slice(0,6)+'’s player':ownerName+'’s player';ensureOption(id);E.channelSelect.value=id;poll();}
function ensureOption(id){if(!Array.from(E.channelSelect.options).some(o=>o.value===id)){const option=document.createElement('option');option.value=id;option.textContent='Listener · '+id.slice(0,6);E.channelSelect.append(option);}}
E.channelSelect.onchange=()=>selectChannel(E.channelSelect.value);
E.myPlayer.onclick=async()=>{try{const me=await session();selectChannel(me.channel);}catch(e){E.pairPanel.hidden=false;E.pairStatus.textContent=e.message;}};
async function saveName(){const name=E.displayName.value;await session();E.displayName.value=name;const r=await fetch('/api/deeplist/name',{method:'POST',headers:{'X-Deeplist-Action':'name','Content-Type':'application/json'},body:JSON.stringify({displayName:name})});const d=await r.json();if(!r.ok)throw Error('Could not save name. Use up to 32 characters.');mySessionPromise=null;if(channel===d.channel)E.channelLabel.textContent=d.label+'’s player';await loadDirectory();return d;}
E.saveName.onclick=async()=>{E.saveName.disabled=true;try{await saveName();E.pairStatus.textContent='Display name saved.';}catch(e){E.pairStatus.textContent=e.message;}finally{E.saveName.disabled=false;}};
async function pair(owner){let headers, endpoint;if(owner){const key=adminKey();if(!key)return;headers={'X-Admin-Key':key};endpoint='/api/deeplist/pair';}else{await saveName();headers={'X-Deeplist-Action':'pair'};endpoint='/api/deeplist/pair?scope=visitor';}const r=await fetch(endpoint,{method:'POST',headers});const d=await r.json();if(!r.ok)throw Error(d.error==='admin_required'?'Admin key is incorrect.':'Could not create pairing code.');E.pairUrl.value=d.website;E.pairToken.value=d.token;E.pairResult.hidden=false;E.pairPlayerLink.hidden=false;E.pairPlayerLink.href=d.channel?'/deeplist.html?user='+encodeURIComponent(d.channel):'/deeplist.html';E.pairPlayerLink.textContent=owner?'Open main player ↗':'Open your player ↗';selectChannel(d.channel||'');const controlHeaders={'X-Deeplist-Action':'control','Content-Type':'application/json',...(owner?headers:{})};
const handoff=await fetch('/api/deeplist/handoff'+(d.channel?'?user='+encodeURIComponent(d.channel):''),{method:'POST',headers:controlHeaders,body:JSON.stringify({token:d.token})});
const grant=await handoff.json();if(!handoff.ok)throw Error('Could not create app link. Try connecting again.');
mySessionPromise=null;E.openApp.href=grant.link;E.openApp.hidden=false;E.pairResult.hidden=true;E.pairStatus.textContent='Tap Open Deeplist and approve. This link expires in two minutes.';checkControl();}
E.createPair.onclick=async()=>{E.createPair.disabled=true;try{await pair(false);}catch(e){E.pairStatus.textContent=e.message;}finally{E.createPair.disabled=false;}};
E.createOwnerPair.onclick=async()=>{E.createOwnerPair.disabled=true;try{await pair(true);}catch(e){E.pairStatus.textContent=e.message;}finally{E.createOwnerPair.disabled=false;}};
E.copyPair.onclick=async()=>{try{await navigator.clipboard.writeText(E.pairToken.value);E.pairStatus.textContent='Pairing code copied.';}catch{E.pairToken.type='text';E.pairToken.select();E.pairStatus.textContent='Select and copy the pairing code.';}};
async function revoke(owner){let headers,endpoint;if(owner){const key=adminKey();if(!key)return;headers={'X-Admin-Key':key};endpoint='/api/deeplist/pair';}else{await session();headers={'X-Deeplist-Action':'pair'};endpoint='/api/deeplist/pair?scope=visitor';}const r=await fetch(endpoint,{method:'DELETE',headers});if(!r.ok)throw Error('Could not disconnect this connection.');E.openApp.hidden=true;E.pairResult.hidden=true;E.pairPlayerLink.hidden=true;E.pairToken.value='';E.pairStatus.textContent=owner?'Main app disconnected.':'Your app disconnected.';poll();loadDirectory();}
E.revokePair.onclick=async()=>{try{await revoke(false);}catch(e){E.pairStatus.textContent=e.message;}};
E.revokeOwnerPair.onclick=async()=>{try{await revoke(true);}catch(e){E.pairStatus.textContent=e.message;}};
async function loadDirectory(){clearTimeout(directoryTimer);if(document.hidden)return;try{const r=await fetch('/api/deeplist/listeners',{cache:'no-store',signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error();const d=await r.json();E.channelSelect.replaceChildren();const owner=document.createElement('option');owner.value='';ownerName=d.owner?.label||'damndeepak';owner.textContent=ownerName;if(!channel)E.channelLabel.textContent=ownerName+'’s player';E.channelSelect.append(owner);for(const visitor of d.listeners||[]){const option=document.createElement('option');option.value=visitor.channel;option.textContent=visitor.label+' · '+(visitor.live?(visitor.playing?'live':'paused'):'last shared');E.channelSelect.append(option);}if(channel)ensureOption(channel);E.channelSelect.value=channel;}catch{}directoryTimer=setTimeout(loadDirectory,1000);}
document.addEventListener('visibilitychange',()=>{if(document.hidden){E.liveStage.classList.remove('am-playing');E.liveStatus.classList.remove('deeplist-live-indicator');clearTimeout(timer);pollController?.abort();clearTimeout(directoryTimer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();}else{poll();loadDirectory();}});
window.addEventListener('pagehide',()=>{clearTimeout(freshnessTimer);E.liveStage.classList.remove('am-playing');E.liveStatus.classList.remove('deeplist-live-indicator');clearTimeout(timer);pollController?.abort();clearTimeout(directoryTimer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();});
if(channel)ensureOption(channel);E.channelSelect.value=channel;E.channelLabel.textContent=channel?"Listener · "+channel.slice(0,6)+"’s player":ownerName+"’s player";
loadDirectory();poll();
document.addEventListener('deeplist-players-updated',event=>{if(event.detail?.deleted===channel)selectChannel('');else poll();loadDirectory();});

function privateHeaders(){const headers={'X-Deeplist-Action':'control'};if(!channel){try{const key=sessionStorage.getItem('cxAdminKey');if(key)headers['X-Admin-Key']=key;}catch{}}return headers;}
async function checkControl(){const epoch=channelEpoch;try{const r=await fetch('/api/deeplist/control-access'+(channel?'?user='+encodeURIComponent(channel):''),{headers:privateHeaders(),cache:'no-store'});const d=await r.json();if(epoch!==channelEpoch)return;canControl=r.ok&&d.canControl;E.remoteControls.hidden=!canControl;updateLyricControl();}catch{canControl=false;E.remoteControls.hidden=true;updateLyricControl();}}
async function command(action,position){if(!canControl||!snapshot||controlPending)return;controlPending=true;E.remoteStatus.textContent='Sending to app…';try{const r=await fetch('/api/deeplist/control'+(channel?'?user='+encodeURIComponent(channel):''),{method:'POST',headers:{...privateHeaders(),'Content-Type':'application/json'},body:JSON.stringify({action,trackId:snapshot.id,...(position===undefined?{}:{position})})});if(!r.ok)throw Error();E.remoteStatus.textContent='Sent. Waiting for app sync…';}catch{E.remoteStatus.textContent='Could not control app. Check the connection.';}finally{controlPending=false;}}
E.remotePlay.onclick=()=>command(snapshot?.playing?'pause':'play');E.remoteSeek.onchange=()=>command('seek',Number(E.remoteSeek.value)*1000);
function resetAppleLyrics(message='Lyrics unavailable for this song.') {
  timelineVersion='';lineIndex=-2;lyricRows=[];E.currentLine.replaceChildren();
  E.currentLine.style.transform='';E.lyricsMessage.textContent=message;E.lyricsMessage.hidden=false;
}
function updateLyricControl(){for(const row of lyricRows)row.node.disabled=!canControl;}
function appleLineWords(line,nextTime){
  const tokens=Array.from(line.text.matchAll(/\S+/gu));let cursor=0;
  const stamps=(line.words||[]).map(word=>{
    const startChar=line.text.indexOf(word.text,cursor);
    if(!word.text||startChar<0)return null;
    cursor=startChar+word.text.length;
    return {...word,startChar,endChar:cursor};
  }).filter(Boolean);
  const duration=Math.max(1,Math.min(12000,nextTime-line.time)),weight=tokens.reduce((n,t)=>n+t[0].length,0)||1;
  let consumed=0;
  return tokens.map(token=>{
    const startChar=token.index,endChar=startChar+token[0].length;
    const matching=stamps.filter(w=>w.startChar<endChar&&w.endChar>startChar);
    const start=matching.length?Math.min(...matching.map(w=>w.start)):line.time+duration*consumed/weight;
    consumed+=token[0].length;
    const end=matching.length?Math.max(...matching.map(w=>w.end)):line.time+duration*consumed/weight;
    return {text:token[0],start,end:Math.max(start+1,end)};
  });
}
function buildAppleLyrics(){
  const key=JSON.stringify([snapshot.id,snapshot.lyricsVersion,snapshot.duration,snapshot.offset]);
  if(timelineVersion===key)return;
  resetAppleLyrics();timelineVersion=key;
  const lines=(snapshot.lines||[]).filter(line=>line.text.trim());
  lyricRows=lines.map((line,i)=>{
    const node=document.createElement('button');node.type='button';node.className='am-line';node.dir='auto';
    node.setAttribute('aria-label',line.text);node.disabled=!canControl;
    const end=lines[i+1]?.time??Math.max(line.time+4000,(snapshot.duration||0)+(snapshot.offset||0));
    const words=appleLineWords(line,end).map(word=>{
      const span=document.createElement('span');span.className='am-word';span.textContent=word.text;node.append(span);
      return {...word,node:span};
    });
    node.onclick=()=>{if(canControl)command('seek',Math.max(0,line.time-(snapshot.offset||0)));};
    E.currentLine.append(node);return {time:line.time,node,words};
  });
  E.lyricsMessage.hidden=lyricRows.length>0;
}
function centreAppleLyrics(snap=false){
  const row=lyricRows[lineIndex]?.node;if(!row)return;
  E.currentLine.style.transition=snap?'none':'';
  E.currentLine.style.transform=`translateY(${E.lyricsWindow.clientHeight*.44-row.offsetTop-row.offsetHeight/2}px)`;
}
function paintAppleLyrics(time){
  if(!lyricRows.length)return;
  let low=0,high=lyricRows.length;
  while(low<high){const middle=(low+high)>>>1;if(lyricRows[middle].time<=time)low=middle+1;else high=middle;}
  const active=Math.max(0,low-1);
  if(active!==lineIndex){
    const snap=lineIndex<0||Math.abs(active-lineIndex)>3;lineIndex=active;
    lyricRows.forEach((row,i)=>{
      row.node.classList.toggle('am-active',i===active);row.node.classList.toggle('am-near',Math.abs(i-active)===1);
      row.node.classList.toggle('am-visible',Math.abs(i-active)<=4);
      if(i===active)row.node.setAttribute('aria-current','true');else row.node.removeAttribute('aria-current');
    });
    centreAppleLyrics(snap);
  }
  for(let i=Math.max(0,active-4);i<=Math.min(lyricRows.length-1,active+4);i++){
    for(const word of lyricRows[i].words){
      const fill=Math.max(0,Math.min(1,(time-word.start)/Math.max(80,word.end-word.start)));
      word.node.style.setProperty('--fill',`${fill*100}%`);
      word.node.classList.toggle('am-hot',i===active&&fill>0&&fill<1);
    }
  }
}
for(const [id,property,unit]of [['liveAppleSize','--am-size','px'],['liveAppleSpacing','--am-gap','em'],['liveAppleBlur','--am-blur','px']]){
  E[id].oninput=()=>{E.liveStage.style.setProperty(property,E[id].value+unit);centreAppleLyrics(true);};
}
E.liveAppleMotion.onchange=()=>E.liveStage.classList.toggle('am-still',!E.liveAppleMotion.checked);
if(typeof ResizeObserver!=='undefined'){
  const resize=new ResizeObserver(()=>centreAppleLyrics(true));resize.observe(E.lyricsWindow);resize.observe(E.currentLine);
}
window.addEventListener('resize',()=>centreAppleLyrics(true));
if(document.fonts)document.fonts.ready.then(()=>centreAppleLyrics(true));
checkControl();
