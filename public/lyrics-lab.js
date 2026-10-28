(()=>{
'use strict';
const root=document.getElementById('lyricsLab');if(!root)return;
const modes=[
 {id:'apple',track:'wasted',song:'Wasted',artist:'Juice WRLD',name:'Apple',tag:'Soft focus. Every word.',glyph:'◉',preview:['eyes closed','hoping','make-believe'],desc:'Wasted · soft, full-line scrolling with a word-by-word highlight.'},
 {id:'fisheye',track:'reflections',song:'Reflections',artist:'The Neighbourhood',name:'Fisheye',tag:'Lyrics in orbit.',glyph:'◎',preview:['somebody','like you','reflection'],desc:'Reflections · a curved lyric wheel, with the current line magnified in the centre.'},
 {id:'ship',track:'aditi',song:'Kabhi Kabhi Aditi',artist:'Rashid Ali',name:'Ship',tag:'Let the words drift.',glyph:'≈',preview:['तू ख़ुश है','तो लगे','अदिति'],desc:'Kabhi Kabhi Aditi · floating Hindi lyrics on a drifting, ocean-coloured stage.'},
 {id:'visual',track:'psycho',song:'Sweet but Psycho',artist:'Ava Max',name:'Visual',tag:'Words meet energy.',glyph:'✦',preview:['sweet','but a','psycho'],desc:'Sweet but Psycho · centred lyrics over a pulsing visualizer.'},
 {id:'neon',track:'unforgettable',song:'Unforgettable',artist:'PnB Rock',name:'Neon Stack',tag:'A little louder.',glyph:'ϟ',preview:['I found you','unforgettable','around you'],desc:'Unforgettable · a luminous, right-aligned lyric stack with outlined neighbouring lines.'},
 {id:'wordstorm',track:'allgirls',song:'All Girls Are The Same',artist:'Juice WRLD',name:'Wordstorm',tag:'One word. All the feeling.',glyph:'☄',preview:['real','LOVE','a minute'],desc:'All Girls Are The Same · one oversized word at a time, with a kinetic trail.'}
];
const styleDescriptions={apple:'Soft full-line scrolling with a word-by-word highlight.',fisheye:'A curved lyric wheel with a magnified centre.',ship:'Floating, staggered lyrics on an ocean-coloured stage.',visual:'Centred uppercase lyrics over a pulsing visualizer.','fisheye-visual':'Curved line depth inside a circular visualizer.',neon:'An outlined lyric stack with a luminous right edge.',wordstorm:'One oversized word at a time, with a kinetic trail.',original:'A restrained, serif, line-by-line reading view.',experimental:'Individual word highlights inside a lyric card.'};
const $=id=>document.getElementById(id),ring=$('labRing'),viewport=$('labViewport'),dialog=$('labDialog'),stage=$('labStage'),lyrics=$('labLyrics'),audio=$('labAudio'),play=$('labPlay'),seek=$('labSeek'),status=$('labPlaybackStatus');
let selected=0,turn=0,drag=null,suppressClick=false,lastTick=-Infinity,ctx,sound=true,soundBuffer,soundLoad,voice,inertia=0,spinVelocity=0,lastSoundTurn=0,data=null,dataPromise,catalogue=null,loadEpoch=0,raf=0,lastPaint=0,activeLine=-1,activeWord=-1,viewMode='apple',openedBy=null,loading=false,visible=true;
const step=360/modes.length,reduced=matchMedia('(prefers-reduced-motion:reduce)');
try{sound=localStorage.getItem('deep-lab-sound')!=='off';}catch{}

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
function stopSpin(){cancelAnimationFrame(inertia);inertia=0;spinVelocity=0;root.classList.remove('lab-dragging','lab-spinning');$('labSpin').disabled=false;root.setAttribute('aria-busy','false');stopVoice();}
const cards=modes.map((mode,i)=>{
 const card=document.createElement('button');card.type='button';card.className='lab-card';card.style.setProperty('--card-angle',i*step+'deg');card.setAttribute('aria-label','Try '+mode.name+' lyrics demo');
 const top=document.createElement('span');top.className='lab-card-top';top.textContent=String(i+1).padStart(2,'0')+' / DEEPLIST';
 const icon=document.createElement('span');icon.className='lab-card-glyph';icon.textContent=mode.glyph;
 const title=document.createElement('strong');title.textContent=mode.name;
 const mini=document.createElement('span');mini.className='lab-card-lyrics lab-mini-'+mode.id;mode.preview.forEach((text,n)=>{const line=document.createElement('span');line.textContent=text;line.className=n===1?'lit':'';mini.append(line);});
 const song=document.createElement('span');song.className='lab-card-song';song.textContent=mode.song;const note=document.createElement('small');note.textContent=mode.artist;const open=document.createElement('span');open.className='lab-card-open';open.textContent='Tap to try ↗';card.append(top,icon,title,mini,song,note,open);
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
function randomSpin(){
 stopSpin();unlockSound();const target=(selected+1+Math.floor(Math.random()*(modes.length-1)))%modes.length;
 if(reduced.matches){select(target,true);$('labSpinResult').textContent='Picked '+modes[target].name+' · '+modes[target].song;return;}
 const startTurn=Math.round(turn/step)*step,startIndex=((Math.round(-startTurn/step)%modes.length)+modes.length)%modes.length;
 const delta=(target-startIndex+modes.length)%modes.length,finish=startTurn-(720+Math.floor(Math.random()*2)*360+delta*step),duration=2300+Math.random()*500,start=performance.now();let last=start,previousTurn=startTurn;
 root.classList.add('lab-dragging','lab-spinning');root.setAttribute('aria-busy','true');$('labSpin').disabled=true;$('labSpinResult').textContent='Spinning…';lastSoundTurn=startTurn;
 function animate(now){inertia=0;const t=Math.max(0,Math.min(1,(now-start)/duration)),ease=1-Math.pow(1-t,4);turn=startTurn+(finish-startTurn)*ease;const velocity=(turn-previousTurn)/Math.max(1,now-last);last=now;previousTurn=turn;selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;movementSound(velocity);render();if(t<1)inertia=requestAnimationFrame(animate);else{selected=target;turn=finish;stopSpin();render();$('labSpinResult').textContent='Picked '+modes[target].name+' · '+modes[target].song;}}
 inertia=requestAnimationFrame(animate);
}
$('labSpin').onclick=randomSpin;
$('labPrevious').onclick=()=>rotate(-1);$('labNext').onclick=()=>rotate(1);$('labOpen').onclick=e=>openDemo(selected,e.currentTarget);
$('labSound').onclick=()=>{sound=!sound;soundLabel();try{localStorage.setItem('deep-lab-sound',sound?'on':'off');}catch{}if(sound)unlockSound().then(()=>tick(.1));else stopVoice();};
viewport.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();rotate(e.key==='ArrowRight'?1:-1);cards[selected].focus({preventScroll:true});}});
viewport.addEventListener('pointerdown',e=>{if(e.button!==0)return;stopSpin();unlockSound();lastSoundTurn=turn;drag={x:e.clientX,y:e.clientY,turn,selected,start:performance.now(),lastX:e.clientX,lastAt:performance.now(),velocity:0,moved:false,vertical:false};});
viewport.addEventListener('pointermove',e=>{if(!drag||drag.vertical)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.moved&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>10){drag.vertical=true;return;}if(!drag.moved&&Math.abs(dx)>4){drag.moved=true;viewport.setPointerCapture?.(e.pointerId);root.classList.add('lab-dragging');}if(!drag.moved)return;
 const now=performance.now(),dt=Math.max(1,now-drag.lastAt),instant=(e.clientX-drag.lastX)*.95/dt;drag.velocity=drag.velocity*.35+instant*.65;drag.lastX=e.clientX;drag.lastAt=now;turn=drag.turn+dx*.95;selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;movementSound(drag.velocity);render();});
function settle(){root.classList.remove('lab-dragging');turn=Math.round(turn/step)*step;selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;render();stopVoice();}
function release(event){if(!drag)return;const {moved,velocity,lastAt}=drag;drag=null;if(moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);
 spinVelocity=event?.type==='pointercancel'||reduced.matches||performance.now()-lastAt>100?0:Math.max(-2.6,Math.min(2.6,velocity));
 if(Math.abs(spinVelocity)<.045){settle();return;}
 let previous=performance.now();const coast=now=>{inertia=0;const dt=Math.min(32,Math.max(1,now-previous));previous=now;turn+=spinVelocity*dt;spinVelocity*=Math.exp(-dt*.005);selected=((Math.round(-turn/step)%modes.length)+modes.length)%modes.length;movementSound(spinVelocity);render();if(Math.abs(spinVelocity)>.018)inertia=requestAnimationFrame(coast);else{spinVelocity=0;settle();}};inertia=requestAnimationFrame(coast);
 }else root.classList.remove('lab-dragging');}
viewport.addEventListener('pointerup',release);viewport.addEventListener('pointercancel',release);viewport.addEventListener('lostpointercapture',release);
function getData(track=modes[selected].track){if(!dataPromise)dataPromise=fetch('/media/lyrics-lab-tracks.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{catalogue=d.tracks;return catalogue;}).catch(e=>{dataPromise=null;throw e;});return dataPromise.then(tracks=>{if(!tracks[track])throw Error('Missing sample');return tracks[track];});}
async function openDemo(index,trigger){
 stopSpin();selected=index;openedBy=trigger;const mode=modes[index],epoch=++loadEpoch;
 audio.pause();data=null;play.disabled=true;lyrics.replaceChildren();lyrics.style.transform='';$('labTrackTitle').textContent=mode.song;$('labTrackArtist').textContent=mode.artist;$('labElapsed').textContent='0:00';$('labDuration').textContent='—';seek.value='0';
 $('labStyle').value=mode.id;viewMode=mode.id;$('labDialogTitle').textContent=mode.name;$('labDescription').textContent=mode.desc;
 if(!dialog.open)dialog.showModal();document.body.classList.add('lab-dialog-open');applyMode();status.textContent='Loading '+mode.song+'…';
 try{const track=await getData(mode.track);if(epoch!==loadEpoch||!dialog.open)return;data=track;
 if(audio.dataset.track!==mode.track){audio.src=track.src;audio.dataset.track=mode.track;audio.load();}audio.currentTime=0;
 $('labTrackTitle').textContent=track.title;$('labTrackArtist').textContent=track.artist;buildLyrics();paint();play.disabled=false;status.textContent='Press play · '+track.title+(track.timing==='estimated'?' · word timing is approximate.':'.');
 }catch{if(epoch===loadEpoch)status.textContent='This sample could not load. Close and try again.';}
}
function closeDemo(){loadEpoch++;audio.pause();cancelAnimationFrame(raf);raf=0;if(dialog.open)dialog.close();}
$('labClose').onclick=closeDemo;dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDemo();}});
dialog.addEventListener('close',()=>{audio.pause();cancelAnimationFrame(raf);raf=0;document.body.classList.remove('lab-dialog-open');openedBy?.focus({preventScroll:true});});
function applyMode(){stage.dataset.mode=viewMode;const detail=modes.find(m=>m.id===viewMode);$('labDialogTitle').textContent=detail?.name||({original:'Classic',experimental:'Enhanced','fisheye-visual':'Fisheye + Visual'}[viewMode]||viewMode);$('labDescription').textContent=(data?.title||modes[selected].song)+' · '+styleDescriptions[viewMode];activeLine=-1;activeWord=-1;if(data){buildLyrics();paint();}}
function buildLyrics(){lyrics.replaceChildren();for(const [index,line]of data.lines.entries()){const row=document.createElement('button');row.type='button';row.className='lab-line';row.setAttribute('aria-label','Seek to '+line[1].map(w=>w[1]).join(' '));row.onclick=()=>{audio.currentTime=line[0];wake();};for(const word of line[1]){const span=document.createElement('span');span.className='lab-word';span.textContent=word[1];row.append(span);}lyrics.append(row);}activeLine=-1;activeWord=-1;}
const time=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
function paint(){
 if(!data)return;const t=audio.currentTime;let index=0;data.lines.forEach((line,i)=>{if(t>=line[0])index=i;});const rows=[...lyrics.children];
 if(activeLine!==index){activeLine=index;rows.forEach((row,i)=>{const distance=i-index;row.classList.toggle('lab-line-current',distance===0);row.classList.toggle('lab-line-near',Math.abs(distance)===1);row.classList.toggle('lab-line-visible',Math.abs(distance)<=2);row.style.setProperty('--distance',distance);row.style.setProperty('--depth-scale',1/(1+Math.abs(distance)*.35));row.style.setProperty('--shift',i%2?'22px':'-22px');if(distance===0)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');});}
 const row=rows[index],words=data.lines[index][1];let wordIndex=0;
 words.forEach((word,i)=>{if(t>=word[0])wordIndex=i;const end=words[i+1]?.[0]??data.lines[index+1]?.[0]??data.duration;const fill=Math.max(0,Math.min(1,(t-word[0])/Math.max(.08,end-word[0])));row.children[i].style.setProperty('--word-fill',fill*100+'%');row.children[i].classList.toggle('lab-word-current',i===wordIndex);row.children[i].classList.toggle('lab-word-done',fill>=1);});
 // Reconcile after finding the current word, so a future word never remains active.
 [...row.children].forEach((node,i)=>node.classList.toggle('lab-word-current',i===wordIndex));activeWord=wordIndex;
 const spatial=['fisheye','ship','visual','fisheye-visual','neon','wordstorm'].includes(viewMode);if(spatial)lyrics.style.transform='none';else{const height=$('labLyricWindow').clientHeight,offset=row.offsetTop+row.offsetHeight/2;lyrics.style.transform='translateY('+(height*.48-offset)+'px)';}
 if(viewMode==='wordstorm'){$('labWordTrail').textContent=words[Math.max(0,wordIndex-1)]?.[1]||'';}
 seek.max=String(data.duration);if(document.activeElement!==seek)seek.value=String(t);$('labElapsed').textContent=time(t);$('labDuration').textContent=time(data.duration);
}
function frame(now){raf=0;if(!dialog.open||document.hidden||audio.paused||audio.ended)return;if(now-lastPaint>=32){paint();lastPaint=now;}raf=requestAnimationFrame(frame);}
function wake(){cancelAnimationFrame(raf);paint();if(dialog.open&&!audio.paused&&!document.hidden)raf=requestAnimationFrame(frame);}
play.onclick=async()=>{if(!audio.paused){audio.pause();return;}if(loading)return;loading=true;play.disabled=true;try{if(!data)return;if(audio.ended)audio.currentTime=0;await audio.play();}catch{status.textContent='Audio could not start. Tap play to retry.';}finally{loading=false;play.disabled=false;}};
audio.addEventListener('play',()=>{document.querySelectorAll('audio,video').forEach(media=>{if(media!==audio)media.pause();});stage.classList.add('lab-playing');play.textContent='Ⅱ';play.setAttribute('aria-label','Pause sample');status.textContent='Playing '+data.title+' · '+data.artist+(data.timing==='estimated'?' · approximate word timing':'');wake();});
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
