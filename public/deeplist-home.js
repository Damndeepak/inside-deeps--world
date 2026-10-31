(()=>{
'use strict';
const box=document.getElementById('lfm'),label=document.getElementById('lfmLabel'),body=document.getElementById('lfmBody'),lyric=document.getElementById('deeplistHomeLyrics');if(!box)return;
const progress=document.getElementById('homeProgress'),fill=document.getElementById('homeProgressFill'),elapsed=document.getElementById('homeElapsed'),duration=document.getElementById('homeDuration');
let snapshot=null,received=0,key='',timer,frame=0,last=0,loading=false,freshnessTimer,historyChecked=-Infinity,historyTrack=null,failures=0;
// Animate only a new synced line; polling the same line must never restart it.
let lyricAnimation;
function showLyric(text){
 if(lyric.textContent===text)return;
 lyricAnimation?.cancel();lyric.textContent=text;
 if(!text||document.hidden||!lyric.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
 if(!(window.worldIsVisible||(()=>true))(box))return;
 lyricAnimation=lyric.animate([
  {opacity:0,transform:'translate3d(0,10px,0)'},
  {opacity:1,transform:'translate3d(0,0,0)'}
 ],{duration:320,easing:'cubic-bezier(.2,.8,.2,1)'});
}
const time=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')};
function card(track,live){
 const labelText=live?(track.playing?'NOW PLAYING':'ON PAUSE'):'LAST ON REPEAT';if(label.textContent!==labelText)label.textContent=labelText;box.classList.toggle('is-playing',!!live&&track.playing);label.classList.toggle('deeplist-live-indicator',!!live&&!!track.playing);
 const next=[track.id||track.url,track.title||track.name,track.artist].join('|');if(key===next)return;key=next;
 const link=document.createElement('a');link.className='lfm-card';link.href='/deeplist.html';
 const cover=document.createElement('div');cover.className='lfm-cover';cover.textContent='d.';cover.setAttribute('aria-hidden','true');
 let image='';if(/^[A-Za-z0-9_-]{11}$/.test(track.id||''))image='https://i.ytimg.com/vi/'+track.id+'/hqdefault.jpg';else try{const u=new URL(track.image);if(u.protocol==='https:')image=u.href}catch{}
 box.style.removeProperty('--album-art');if(image){const img=document.createElement('img');img.alt='';img.src=image;img.referrerPolicy='no-referrer';img.onload=()=>{if(key===next)box.style.setProperty('--album-art','url('+JSON.stringify(image)+')')};img.onerror=()=>{cover.textContent='d.';box.style.removeProperty('--album-art')};cover.replaceChildren(img)}
 const info=document.createElement('div');info.className='lfm-info';for(const [cls,text] of [['lfm-title',track.title||track.name],['lfm-artist',track.artist]]){const node=document.createElement('div');node.className=cls;node.textContent=text;info.append(node)}link.append(cover,info);body.replaceChildren(link);
}
function paint(now){frame=0;if(!snapshot||document.hidden)return;if(now-last>=100){last=now;const raw=snapshot.position+(snapshot.playing?performance.now()-received:0),p=Math.min(snapshot.duration||raw,Math.max(0,raw));let active;for(const line of snapshot.lines||[]){if(line.time>p+(snapshot.offset||0))break;active=line}const text=active?.text||'';showLyric(text);if(progress){progress.hidden=!snapshot.duration;fill.style.width=(snapshot.duration?Math.min(100,p/snapshot.duration*100):0)+'%';const e=time(p),d=time(snapshot.duration);if(elapsed.textContent!==e)elapsed.textContent=e;if(duration.textContent!==d)duration.textContent=d}}if(snapshot.playing&&(window.worldIsVisible||(()=>!document.hidden))(box))frame=requestAnimationFrame(paint)}
function empty(unavailable=false){clearTimeout(freshnessTimer);snapshot=null;const emptyKey='empty:'+unavailable;if(key===emptyKey)return;key=emptyKey;showLyric('');if(progress)progress.hidden=true;box.classList.remove('is-playing');label.classList.remove('deeplist-live-indicator');box.style.removeProperty('--album-art');label.textContent=unavailable?'BETWEEN CONNECTIONS':'BETWEEN SONGS';body.replaceChildren();const cover=document.createElement('div');cover.className='lfm-card';const mark=document.createElement('div');mark.className='lfm-cover';mark.textContent='d.';const title=document.createElement('div');title.className='lfm-title';title.textContent=unavailable?'A quiet moment.':'The next song is a feeling.';const note=document.createElement('div');note.className='lfm-artist';note.textContent=unavailable?'Live listening will return when connected.':'Deepak’s shared tracks will appear here.';cover.append(mark,title,note);body.append(cover)}
async function poll(){clearTimeout(timer);if(document.hidden||loading)return;loading=true;const started=performance.now();try{
 const r=await fetch('/api/deeplist/state'+(snapshot?.lyricsVersion?'?lyricsVersion='+encodeURIComponent(snapshot.lyricsVersion):''),{cache:'no-store',signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error();const d=await r.json();cancelAnimationFrame(frame);
 if(d.connected&&d.state){const next=d.state;if(next.lines===undefined)next.lines=snapshot?.id===next.id&&snapshot.lyricsVersion===next.lyricsVersion?snapshot.lines||[]:[];snapshot=next;received=performance.now()-Math.max(0,d.serverNow-d.receivedAt);clearTimeout(freshnessTimer);freshnessTimer=setTimeout(()=>empty(true),Math.max(0,15000-(performance.now()-received)));card(snapshot,true);frame=requestAnimationFrame(paint)}
 else{clearTimeout(freshnessTimer);snapshot=null;showLyric('');if(progress)progress.hidden=true;
  if(performance.now()-historyChecked>=30000){const h=await fetch('/api/deeplist/history',{cache:'no-store',signal:AbortSignal.timeout(4000)});if(!h.ok)throw Error();const history=await h.json();historyTrack=history.tracks?.[0]||null;historyChecked=performance.now();}
  if(historyTrack)card(historyTrack,false);else empty()}
 failures=0;}catch{failures++;empty(true)}finally{loading=false;timer=setTimeout(()=>{if((window.worldIsVisible||(()=>!document.hidden))(box))poll();else timer=setTimeout(poll,10000)},failures?Math.min(10000,1000*2**(failures-1)):Math.max(0,500-(performance.now()-started)))}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){lyricAnimation?.cancel();label.classList.remove('deeplist-live-indicator');clearTimeout(timer);cancelAnimationFrame(frame)}else poll()});box.addEventListener('world-visible',()=>{if(snapshot)frame=requestAnimationFrame(paint);poll()});poll();
})();
