const $ = id => document.getElementById(id);
const E = Object.fromEntries(['liveStatus','trackTitle','trackArtist','previousLine','currentLine','nextLine','progressFill','positionLabel','durationLabel','listen','audioStatus','videoWrap','pairToggle','pairPanel','createPair','revokePair','pairResult','pairUrl','pairToken','copyPair','pairStatus'].map(id=>[id,$(id)]));
let snapshot = null, received = 0, trackId = '', lineIndex = -2, words = [], timer, frame = 0, lastFrame = 0, listening = false, player, playerReady = false, playerVideo = '', apiPromise;
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
  try{const start=performance.now();const r=await fetch('/api/deeplist/state'+(snapshot?.lyricsVersion?'?lyricsVersion='+encodeURIComponent(snapshot.lyricsVersion):''),{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();
    if(!d.connected)offline();else{const previous=snapshot;const next=d.state;if(next.lines===undefined)next.lines=previous?.id===next.id&&previous?.lyricsVersion===next.lyricsVersion?previous.lines||[]:[];if(previous?.lyricsVersion!==next.lyricsVersion)lineIndex=-2;snapshot=next;const latency=Math.max(0,(performance.now()-start)/2);received=performance.now()-Math.max(0,d.serverNow-d.receivedAt)-latency;
      if(trackId!==snapshot.id){trackId=snapshot.id;lineIndex=-2;E.currentLine.replaceChildren();}
      E.trackTitle.textContent=snapshot.title;E.trackArtist.textContent=snapshot.artist;E.liveStatus.textContent=snapshot.playing?'DEEPLIST · LIVE':'DEEPLIST · PAUSED';E.listen.disabled=false;paint();wake();syncAudio();}
  }catch{offline('Connection unavailable. Retrying…');}
  timer=setTimeout(poll,2000);
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
E.createPair.onclick=async()=>{const key=adminKey();if(!key)return;E.createPair.disabled=true;try{const r=await fetch('/api/deeplist/pair',{method:'POST',headers:{'X-Admin-Key':key}});const d=await r.json();if(!r.ok)throw Error(d.error==='admin_required'?'Admin key is incorrect.':'Could not create pairing code.');E.pairUrl.value=d.website;E.pairToken.value=d.token;E.pairResult.hidden=false;E.pairStatus.textContent='Pairing code ready. Paste it into Deeplist settings.';}catch(e){E.pairStatus.textContent=e.message;}finally{E.createPair.disabled=false;}};
E.copyPair.onclick=async()=>{try{await navigator.clipboard.writeText(E.pairToken.value);E.pairStatus.textContent='Pairing code copied.';}catch{E.pairToken.type='text';E.pairToken.select();E.pairStatus.textContent='Select and copy the pairing code.';}};
E.revokePair.onclick=async()=>{const key=adminKey();if(!key)return;try{const r=await fetch('/api/deeplist/pair',{method:'DELETE',headers:{'X-Admin-Key':key}});if(!r.ok)throw Error();E.pairResult.hidden=true;E.pairToken.value='';E.pairStatus.textContent='App disconnected.';offline();}catch{E.pairStatus.textContent='Could not disconnect. Check the admin key.';}};
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();}else{poll();}});
window.addEventListener('pagehide',()=>{clearTimeout(timer);cancelAnimationFrame(frame);if(playerReady)player.pauseVideo();});
poll();
