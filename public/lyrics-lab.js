(()=>{
'use strict';
const root=document.getElementById('lyricsLab');if(!root)return;
const modes=[
 {id:'apple',name:'Apple',tag:'Soft focus. Every word.',glyph:'◉',desc:'Full lines flow past a word-by-word highlight.'},
 {id:'fisheye',name:'Fisheye',tag:'A different perspective.',glyph:'◎',desc:'The current line grows while the rest curves into the distance.'},
 {id:'ship',name:'Ship',tag:'Let the words drift.',glyph:'≈',desc:'Lyrics float from side to side with the current line at the centre.'},
 {id:'visual',name:'Visual',tag:'Words meet a little energy.',glyph:'✦',desc:'A focused lyric with an animated visual backdrop.'},
 {id:'fisheye-visual',name:'Fisheye + Visual',tag:'Perspective, with feeling.',glyph:'◌',desc:'Fisheye line depth with an animated visual backdrop.'},
 {id:'neon',name:'Neon Stack',tag:'A little louder.',glyph:'ϟ',desc:'Stacked lyrics, a luminous edge and your own accent colour.'},
 {id:'wordstorm',name:'Wordstorm',tag:'One word. All the feeling.',glyph:'☄',desc:'Words take the stage one at a time, with a gentle rise.'},
 {id:'original',name:'Classic',tag:'Just you and the lyrics.',glyph:'≡',desc:'A clean, readable line-by-line lyrics view.'},
 {id:'experimental',name:'Enhanced',tag:'Follow every syllable.',glyph:'♪',desc:'Word highlights bring a traditional lyric stack to life.'},
 {id:'studio',name:'UI Studio',tag:'Make it feel like you.',glyph:'✎',desc:'Try the type, spacing, colour, glow and background controls together.'}
];
const $=id=>document.getElementById(id),ring=$('labRing'),viewport=$('labViewport'),dialog=$('labDialog'),stage=$('labStage'),lyrics=$('labLyrics'),audio=$('labAudio'),play=$('labPlay'),seek=$('labSeek'),status=$('labPlaybackStatus');
let selected=0,turn=0,drag=null,suppressClick=false,lastTick=-Infinity,ctx,sound=true,soundBuffer,soundLoad,voice,inertia=0,spinVelocity=0,lastSoundTurn=0,data=null,dataPromise,raf=0,lastPaint=0,activeLine=-1,activeWord=-1,viewMode='apple',openedBy=null,loading=false,visible=true;
const step=360/modes.length,reduced=matchMedia('(prefers-reduced-motion:reduce)');
try{sound=localStorage.getItem('deep-lab-sound')!=='off';}catch{}
const sample=['find yourself','in the music','one word at a time'];
function soundLabel(){$('labSound').textContent=sound?'♪ Sound on':'♪ Sound off';$('labSound').setAttribute('aria-pressed',String(sound));}
soundLabel();
// The supplied click is decoded once. No sound is played before an interaction.
function unlockSound(){
 if(!sound)return Promise.resolve();
 try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return Promise.resolve();ctx??=new AC();if(ctx.state==='suspended')ctx.resume().catch(()=>{});
 if(!soundLoad)soundLoad=fetch('/sounds/lyrics-spin-click.mp3').then(r=>{if(!r.ok)throw Error();return r.arrayBuffer();}).then(bytes=>ctx.decodeAudioData(bytes)).then(buffer=>{soundBuffer=buffer;}).catch(()=>{soundLoad=null;});return soundLoad;
 }catch{return Promise.resolve();}
}
function stopVoice(){if(!voice||!ctx)return;const old=voice;voice=null;try{old.gain.gain.cancelScheduledValues(ctx.currentTime);old.gain.gain.setTargetAtTime(.0001,ctx.currentTime,.008);old.source.stop(ctx.currentTime+.035);}catch{}}
function tick(velocity=.12){
 if(!sound||document.hidden)return;const now=performance.now(),speed=Math.abs(velocity),interval=Math.max(35,130-speed*150);
 if(now-lastTick<interval)return;lastTick=now;
 unlockSound();if(!soundBuffer||ctx?.state!=='running')return;
 const rate=Math.max(.85,Math.min(3,.85+speed*2.2));
 try{stopVoice();const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=soundBuffer;source.playbackRate.value=rate;gain.gain.value=.42;source.connect(gain);gain.connect(ctx.destination);voice={source,gain};source.onended=()=>{source.disconnect();gain.disconnect();if(voice?.source===source)voice=null;};source.start();}catch{}
}
function movementSound(velocity){if(Math.abs(turn-lastSoundTurn)<7)return;lastSoundTurn=turn;tick(velocity);if(voice&&ctx)voice.source.playbackRate.setTargetAtTime(Math.max(.85,Math.min(3,.85+Math.abs(velocity)*2.2)),ctx.currentTime,.015);}
function stopSpin(){cancelAnimationFrame(inertia);inertia=0;spinVelocity=0;root.classList.remove('lab-dragging');stopVoice();}
const cards=modes.map((mode,i)=>{
 const card=document.createElement('button');card.type='button';card.className='lab-card';card.style.setProperty('--card-angle',i*step+'deg');card.setAttribute('aria-label','Try '+mode.name+' lyrics demo');
 const top=document.createElement('span');top.className='lab-card-top';top.textContent=String(i+1).padStart(2,'0')+' / DEEPLIST';
 const icon=document.createElement('span');icon.className='lab-card-glyph';icon.textContent=mode.glyph;
 const title=document.createElement('strong');title.textContent=mode.name;
 const mini=document.createElement('span');mini.className='lab-card-lyrics lab-mini-'+mode.id;sample.forEach((text,n)=>{const line=document.createElement('span');line.textContent=text;line.className=n===1?'lit':'';mini.append(line);});
 const note=document.createElement('small');note.textContent=mode.tag;const open=document.createElement('span');open.className='lab-card-open';open.textContent='Tap to try ↗';card.append(top,icon,title,mini,note,open);
 card.onclick=()=>{if(suppressClick)return;select(i,true);openDemo(i,card);};ring.append(card);return card;
});
const dots=modes.map((mode,i)=>{const b=document.createElement('button');b.type='button';b.className='lab-dot';b.setAttribute('aria-label','Select '+mode.name);b.onclick=()=>select(i,true);$('labDots').append(b);return b;});
function render(){
 ring.style.transform='rotateX(-5deg) rotateY('+turn+'deg)';
 cards.forEach((card,i)=>{const delta=((i-selected+modes.length/2)%modes.length+modes.length)%modes.length-modes.length/2;const near=Math.abs(delta);card.classList.toggle('lab-selected',i===selected);card.style.opacity=near>2?'0':near===0?'1':near===1?'.58':'.2';card.style.pointerEvents=near>2?'none':'auto';card.tabIndex=i===selected?0:-1;card.setAttribute('aria-hidden',String(near>2));if(i===selected)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');dots[i].setAttribute('aria-pressed',String(i===selected));});
 if($('labSelected').textContent!==modes[selected].name)$('labSelected').textContent=modes[selected].name;const counter=String(selected+1).padStart(2,'0')+' / '+modes.length;if($('labCounter').textContent!==counter)$('labCounter').textContent=counter;$('labOpen').textContent='Try '+modes[selected].name+' ↗';
}
function select(index,withSound=false){stopSpin();const next=(index%modes.length+modes.length)%modes.length;let delta=next-selected;if(delta>modes.length/2)delta-=modes.length;if(delta<-modes.length/2)delta+=modes.length;turn-=delta*step;selected=next;render();if(withSound&&delta){unlockSound().then(()=>{if(sound)tick(.2);});}}
function rotate(direction){select(selected+direction,true);}
$('labPrevious').onclick=()=>rotate(-1);$('labNext').onclick=()=>rotate(1);$('labOpen').onclick=e=>openDemo(selected,e.currentTarget);
$('labSound').onclick=()=>{sound=!sound;soundLabel();try{localStorage.setItem('deep-lab-sound',sound?'on':'off');}catch{}if(sound)unlockSound().then(()=>tick(.1));else stopVoice();};
viewport.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();rotate(e.key==='ArrowRight'?1:-1);cards[selected].focus({preventScroll:true});}});
viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;stopSpin();unlockSound();lastSoundTurn=turn;drag={x:e.clientX,y:e.clientY,turn,selected,start:performance.now(),lastX:e.clientX,lastAt:performance.now(),velocity:0,moved:false,vertical:false};});
viewport.addEventListener('pointermove',e=>{if(!drag||drag.vertical)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>10){drag.vertical=true;return;}if(!drag.moved&&Math.abs(dx)>8){drag.moved=true;viewport.setPointerCapture?.(e.pointerId);root.classList.add('lab-dragging');}if(!drag.moved)return;
 const now=performance.now(),dt=Math.max(1,now-drag.lastAt),instant=(e.clientX-drag.lastX)*.32/dt;drag.velocity=drag.velocity*.35+instant*.65;drag.lastX=e.clientX;drag.lastAt=now;turn=drag.turn+dx*.32;selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;movementSound(drag.velocity);render();});
function settle(){root.classList.remove('lab-dragging');turn=Math.round(turn/step)*step;selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;render();stopVoice();}
function release(event){if(!drag)return;const {moved,velocity,lastAt}=drag;drag=null;if(moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);
 spinVelocity=event?.type==='pointercancel'||reduced.matches||performance.now()-lastAt>100?0:Math.max(-1.8,Math.min(1.8,velocity));
 if(Math.abs(spinVelocity)<.045){settle();return;}
 let previous=performance.now();const coast=now=>{inertia=0;const dt=Math.min(32,Math.max(1,now-previous));previous=now;turn+=spinVelocity*dt;spinVelocity*=Math.exp(-dt*.0065);selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;movementSound(spinVelocity);render();if(Math.abs(spinVelocity)>.018)inertia=requestAnimationFrame(coast);else{spinVelocity=0;settle();}};inertia=requestAnimationFrame(coast);
 }else root.classList.remove('lab-dragging');}
viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);viewport.addEventListener('lostpointercapture',release);
function getData(){if(!dataPromise)dataPromise=fetch('/media/apple-demo-data.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{data=d;return d;}).catch(e=>{dataPromise=null;throw e;});return dataPromise;}
async function openDemo(index,trigger){
 stopSpin();selected=index;openedBy=trigger;const mode=modes[index];$('labDialogTitle').textContent=mode.name;$('labDescription').textContent=mode.desc;$('labStyle').value=mode.id==='studio'?'apple':mode.id;viewMode=$('labStyle').value;
 if(!dialog.open)dialog.showModal();document.body.classList.add('lab-dialog-open');applyMode();status.textContent='Press play to hear the synced sample.';
 try{await getData();if(dialog.open){buildLyrics();paint();}}catch{status.textContent='The sample could not load. Close and try again.';}
}
function closeDemo(){audio.pause();cancelAnimationFrame(raf);raf=0;if(dialog.open)dialog.close();}
$('labClose').onclick=closeDemo;dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDemo();}});
dialog.addEventListener('close',()=>{audio.pause();cancelAnimationFrame(raf);raf=0;document.body.classList.remove('lab-dialog-open');openedBy?.focus({preventScroll:true});});
function applyMode(){stage.dataset.mode=viewMode;activeLine=-1;activeWord=-1;if(data){buildLyrics();paint();}}
function buildLyrics(){lyrics.replaceChildren();for(const [index,line]of data.lines.entries()){const row=document.createElement('button');row.type='button';row.className='lab-line';row.setAttribute('aria-label','Seek to '+line[1].map(w=>w[1]).join(' '));row.onclick=()=>{audio.currentTime=line[0];wake();};for(const word of line[1]){const span=document.createElement('span');span.className='lab-word';span.textContent=word[1];row.append(span);}lyrics.append(row);}activeLine=-1;activeWord=-1;}
const time=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function paint(){
 if(!data)return;const t=audio.currentTime;let index=0;data.lines.forEach((line,i)=>{if(t>=line[0])index=i;});const rows=[...lyrics.children];
 if(activeLine!==index){activeLine=index;rows.forEach((row,i)=>{const distance=i-index;row.classList.toggle('lab-line-current',distance===0);row.classList.toggle('lab-line-near',Math.abs(distance)===1);row.classList.toggle('lab-line-visible',Math.abs(distance)<=2);row.style.setProperty('--distance',distance);if(distance===0)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});}
 const row=rows[index],words=data.lines[index][1];let wordIndex=0;
 words.forEach((word,i)=>{if(t>=word[0])wordIndex=i;const end=words[i+1]?.[0]??data.lines[index+1]?.[0]??data.duration;const fill=Math.max(0,Math.min(1,(t-word[0])/Math.max(.08,end-word[0])));row.children[i].style.setProperty('--word-fill',fill*100+'%');row.children[i].classList.toggle('lab-word-current',i===wordIndex);row.children[i].classList.toggle('lab-word-done',fill>=1);});
 // Reconcile after finding the current word, so a future word never remains active.
 [...row.children].forEach((node,i)=>node.classList.toggle('lab-word-current',i===wordIndex));activeWord=wordIndex;
 const height=$('labLyricWindow').clientHeight,offset=row.offsetTop+row.offsetHeight/2;lyrics.style.transform='translateY('+(height*.48-offset)+'px)';
 seek.max=String(data.duration);if(document.activeElement!==seek)seek.value=String(t);$('labElapsed').textContent=time(t);$('labDuration').textContent=time(data.duration);
}
function frame(now){raf=0;if(!dialog.open||document.hidden||audio.paused||audio.ended)return;if(now-lastPaint>=32){paint();lastPaint=now;}raf=requestAnimationFrame(frame);}
function wake(){cancelAnimationFrame(raf);paint();if(dialog.open&&!audio.paused&&!document.hidden)raf=requestAnimationFrame(frame);}
play.onclick=async()=>{if(!audio.paused){audio.pause();return;}if(loading)return;loading=true;play.disabled=true;try{await getData();if(audio.ended)audio.currentTime=0;await audio.play();}catch{status.textContent='Audio could not start. Tap play to retry.';}finally{loading=false;play.disabled=false;}};
audio.addEventListener('play',()=>{document.querySelectorAll('audio,video').forEach(media=>{if(media!==audio)media.pause();});stage.classList.add('lab-playing');play.textContent='Ⅱ';play.setAttribute('aria-label','Pause sample');status.textContent='Playing Wasted · Juice WRLD · short sample';wake();});
audio.addEventListener('pause',()=>{stage.classList.remove('lab-playing');play.textContent='▶';play.setAttribute('aria-label','Play sample');cancelAnimationFrame(raf);raf=0;paint();});
audio.addEventListener('ended',()=>{status.textContent='Sample finished. Play again or try another style.';});audio.addEventListener('seeked',wake);audio.addEventListener('timeupdate',()=>{if(!raf)paint();});audio.addEventListener('error',()=>{status.textContent='Audio unavailable. Please try again.';});
seek.oninput=()=>{if(data){audio.currentTime=Number(seek.value);wake();}};
$('labStyle').onchange=()=>{viewMode=$('labStyle').value;applyMode();};
const defaults={size:'30',spacing:'1.3',font:'sans',glow:true,motion:true,accent:'#c7adff',backdrop:'aurora'};
function settings(){stage.style.setProperty('--lab-size',$('labSize').value+'px');stage.style.setProperty('--lab-spacing',$('labSpacing').value);stage.style.setProperty('--lab-accent',$('labAccent').value);stage.dataset.font=$('labFont').value;stage.dataset.backdrop=$('labBackdrop').value;stage.classList.toggle('lab-no-glow',!$('labGlow').checked);stage.classList.toggle('lab-still',!$('labMotion').checked||reduced.matches);$('labSizeValue').textContent=$('labSize').value+'px';$('labSpacingValue').textContent=Number($('labSpacing').value).toFixed(1);paint();}
for(const id of ['labSize','labSpacing','labFont','labGlow','labMotion','labAccent','labBackdrop'])$(id).addEventListener('input',settings);
$('labReset').onclick=()=>{for(const [key,value]of Object.entries(defaults)){const node=$('lab'+key[0].toUpperCase()+key.slice(1));if(typeof value==='boolean')node.checked=value;else node.value=value;}settings();};
reduced.addEventListener?.('change',settings);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopSpin();audio.pause();ctx?.suspend().catch(()=>{});}});
if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;root.classList.toggle('lab-in-view',visible);if(!visible)stopSpin();}).observe(root);
if('ResizeObserver'in window)new ResizeObserver(()=>paint()).observe($('labLyricWindow'));
render();settings();root.classList.add('lab-ready');
})();
