(()=>{
'use strict';
// A short, filtered paper-brush sound; no assets, autoplay, or extra controls.
let context,brush,output,lastSound=-Infinity,intentUntil=0,travel=0;
const positions=new WeakMap();
const now=()=>performance.now();
function unlock(event){
 if(!event.isTrusted)return;
 if(event.type==='keydown'&&!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp','Home','End',' '].includes(event.key))return;
 intentUntil=now()+2500;
 try{
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  if(!context){
   context=new AC();output=context.createGain();output.gain.value=.13;output.connect(context.destination);
   brush=context.createBuffer(1,Math.ceil(context.sampleRate*.045),context.sampleRate);
   const samples=brush.getChannelData(0);let smooth=0;
   for(let i=0;i<samples.length;i++){smooth=smooth*.6+(Math.random()*2-1)*.4;samples[i]=smooth;}
  }
  if(context.state==='suspended')context.resume().catch(()=>{});
 }catch{}
}
for(const type of ['pointerdown','touchstart','touchmove','wheel','keydown'])window.addEventListener(type,unlock,{passive:true});
function scroll(event){
 const target=event.target===document?document.scrollingElement:event.target;
 if(!target||typeof target.scrollTop!=='number')return;
 const current={x:target.scrollLeft,y:target.scrollTop,at:now()},previous=positions.get(target);
 positions.set(target,current);
 if(!previous)return;
 const distance=Math.hypot(current.x-previous.x,current.y-previous.y);
 if(document.hidden||current.at>intentUntil||!context||context.state!=='running'){travel=0;return;}
 // Never add a competing texture to the carousel's own spinning sound.
 if(document.querySelector('.lab-spinning,.lab-dragging'))return;
 const speed=Math.min(3,distance/Math.max(16,current.at-previous.at));
 travel+=distance;
 if(travel<18||current.at-lastSound<Math.max(65,150-speed*28))return;
 lastSound=current.at;travel=0;
 try{
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
  source.buffer=brush;source.playbackRate.value=.9+speed*.18;
  filter.type='bandpass';filter.frequency.value=950+speed*220;filter.Q.value=.65;
  const playing=[...document.querySelectorAll('audio,video')].some(media=>!media.paused&&!media.muted&&media.volume>0);
  const at=context.currentTime,level=(.45+speed*.1)*(playing?.22:1);
  gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(level,at+.004);gain.gain.exponentialRampToValueAtTime(.0001,at+.045);
  source.connect(filter);filter.connect(gain);gain.connect(output);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  source.start();source.stop(at+.05);
 }catch{}
}
if(document.scrollingElement)positions.set(document.scrollingElement,{x:window.scrollX,y:window.scrollY,at:now()});
document.addEventListener('scroll',scroll,{capture:true,passive:true});
document.addEventListener('visibilitychange',()=>{travel=0;intentUntil=0;});
})();
