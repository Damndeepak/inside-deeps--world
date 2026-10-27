(()=>{
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const desktop=matchMedia('(min-width: 900px) and (min-height: 700px) and (hover: hover) and (pointer: fine)');
 const ease='cubic-bezier(.215,.61,.355,1)';
 const rails=new Map(),seen=new WeakSet(),animations=new Set();
 let pin,refreshTimer,frame=0,pageRange=1;
 const nativeProgress=CSS.supports('animation-timeline: scroll()');
 const nativeTitles=CSS.supports('animation-timeline: view()');
 const film=document.getElementById('memoryFilm'),stage=film?.querySelector('.memory-film-stage');
 const photos=document.getElementById('homeMemories');
 const progress=document.getElementById('scrollProgress');
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function overflow(rail){return Math.max(0,rail.scrollWidth-rail.clientWidth)}
 function updateProgress(){
  frame=0;updateFilm();if(!progress)return;
  if(!nativeProgress||reduced.matches)progress.style.transform='scaleX('+clamp(scrollY/pageRange,0,1)+')';
 }
 function updateFilm(){
  if(!pin)return;
  // Geometry is measured on layout changes, never read back after a scroll write.
  const position=clamp((scrollY-pin.start)/pin.distance,0,1);
  if(position===pin.position)return;
  pin.position=position;photos.scrollLeft=pin.distance*position;

 }
 addEventListener('scroll',()=>{if((pin||!nativeProgress||reduced.matches)&&!frame)frame=requestAnimationFrame(updateProgress)},{passive:true});
 function syncButtons(rail){
  const buttons=rails.get(rail);if(!buttons)return;
  const max=buttons.max;
  buttons.previous.forEach(b=>b.disabled=rail.scrollLeft<=2||max<=2);
  buttons.next.forEach(b=>b.disabled=rail.scrollLeft>=max-2||max<=2);
 }
 function goTo(rail,left){
  const target=clamp(left,0,overflow(rail));
  if(rail===photos&&pin){
   // Arrows/keyboard move the pinned timeline too, so vertical scroll never snaps it back.
   const ratio=overflow(rail)>0?target/overflow(rail):0;
   window.scrollTo({top:pin.start+(pin.end-pin.start)*ratio,behavior:reduced.matches?'auto':'smooth'});
  }else rail.scrollTo({left:target,behavior:reduced.matches?'auto':'smooth'});
 }
 document.querySelectorAll('[data-scroll-rail]').forEach(rail=>{
  const previous=[...document.querySelectorAll('[data-rail-prev="'+rail.id+'"]')];
  const next=[...document.querySelectorAll('[data-rail-next="'+rail.id+'"]')];
  rails.set(rail,{previous,next,max:overflow(rail)});
  previous.forEach(b=>b.addEventListener('click',()=>goTo(rail,rail.scrollLeft-rail.clientWidth*.8)));
  next.forEach(b=>b.addEventListener('click',()=>goTo(rail,rail.scrollLeft+rail.clientWidth*.8)));
  rail.addEventListener('scroll',()=>syncButtons(rail),{passive:true});
  rail.addEventListener('keydown',event=>{
   if(event.target!==rail)return;
   if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();
    const target=event.key==='Home'?0:event.key==='End'?overflow(rail):rail.scrollLeft+(event.key==='ArrowRight'?1:-1)*rail.clientWidth*.8;
    goTo(rail,target);
   }
  });
  // Tab into an offscreen photo without trapping keyboard navigation in the pin.
  rail.addEventListener('focusin',event=>{
   if(rail!==photos||!pin||event.target===rail)return;
   const card=event.target.closest('.public-memory');if(!card)return;
   goTo(rail,card.offsetLeft-rail.offsetLeft);
  });
  syncButtons(rail);
 });
 function reveal(node,delay=0,title=false){
  if(reduced.matches||!node.animate)return;
  const start=title?{opacity:.08,transform:'translate3d(0,30px,0)'}:{opacity:.12,transform:'translate3d(0,28px,0) scale(.96)'};
  const end={opacity:1,transform:'translate3d(0,0,0) scale(1)'};
  const old=node._worldReveal;old?.cancel();
  const animation=node.animate([start,end],{duration:540,delay,easing:ease});node._worldReveal=animation;
  animations.add(animation);const done=()=>animations.delete(animation);animation.onfinish=done;animation.oncancel=done;
 }
 const revealObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){
   const node=entry.target;
   if(node.matches('.deep-chat-intro,.deep-app>div:first-child,.deep-section-intro')){
    if(!nativeTitles)[...node.children].filter(n=>n.matches('.deep-kicker,h2')).forEach((n,i)=>reveal(n,i*80,true));
   }else if(!nativeTitles||!node.matches('.world-heading'))reveal(node,0,node.matches('.world-heading'));
  }
 },{threshold:.12}):null;
 function observeReveals(root){
  if(!revealObserver||reduced.matches)return;
  const selector='.deep-chat-intro,.deep-app>div:first-child,.deep-section-intro,.world-heading,.corner-card,.deep-app-art,.public-memory,.public-media-layout>video,.thoughts-entry .media-entry-card,.deep-footer';
  const nodes=[...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)];
  for(const node of nodes)if(!seen.has(node)){seen.add(node);revealObserver.observe(node)}
 }
 observeReveals(document.body);
 function setHint(pinned){
  const hint=film?.querySelector('.rail-hint');if(hint)hint.textContent=pinned?'Scroll to explore · reverse to rewind':'Swipe or use the arrows to explore';
 }
 function removePin(){
  if(pin){pin=null;film.style.removeProperty('height');photos.scrollLeft=0;syncButtons(photos)}
  stage?.classList.remove('is-pinned');setHint(false);
 }
 function refreshLayout(){
  clearTimeout(refreshTimer);
  pageRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);
  rails.forEach((buttons,rail)=>{buttons.max=overflow(rail);syncButtons(rail)});
  // Only desktop gets a pin. Touch users keep native page scrolling + horizontal swipe.
  const canPin=!reduced.matches&&desktop.matches&&stage&&photos?.querySelectorAll('.public-memory').length>1&&overflow(photos)>2;
  if(canPin){
   stage.classList.add('is-pinned');setHint(true);
   const distance=overflow(photos),start=film.getBoundingClientRect().top+scrollY-48;
   const height=(stage.offsetHeight+distance)+'px';if(film.style.height!==height)film.style.height=height;
   pin={start,end:start+distance,distance,position:-1};
  }else if(!canPin)removePin();
  pageRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);updateProgress();
 }
 function scheduleLayout(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshLayout,120)}
 // Watch only the rails, not chat or the continuously updating lyric/progress elements.
 if('MutationObserver' in window){
  const updates=new MutationObserver(records=>{
   records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)observeReveals(node)}));
   scheduleLayout();
  });
  rails.forEach((_,rail)=>updates.observe(rail,{childList:true}));
 }
 if('ResizeObserver' in window){
  const sizes=new ResizeObserver(scheduleLayout);
  rails.forEach((_,rail)=>sizes.observe(rail));
  sizes.observe(document.querySelector('main'));
 }
 addEventListener('resize',scheduleLayout,{passive:true});
 addEventListener('load',scheduleLayout,{once:true});
 document.fonts?.ready.then(scheduleLayout);
 desktop.addEventListener('change',scheduleLayout);
 reduced.addEventListener('change',()=>{
  if(reduced.matches){for(const a of animations)a.cancel();removePin();}
  if(!reduced.matches)observeReveals(document.body);
  scheduleLayout();
 });
 document.addEventListener('visibilitychange',()=>{
  for(const animation of animations){if(document.hidden)animation.pause();else animation.play()}
 });
 // Native scrolling + compositor transforms: no library ticker or network dependency.
 updateProgress();scheduleLayout();
})();
