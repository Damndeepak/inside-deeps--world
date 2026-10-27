(()=>{
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const desktop=matchMedia('(min-width: 900px) and (min-height: 700px) and (hover: hover) and (pointer: fine)');
 const ease='cubic-bezier(.215,.61,.355,1)';
 const rails=new Map(),seen=new WeakSet(),animations=new Set();
 let gsap,ST,pin,parallax,curtain,refreshTimer,frame=0,pinUpdate=false;
 const film=document.getElementById('memoryFilm'),stage=film?.querySelector('.memory-film-stage');
 const photos=document.getElementById('homeMemories');
 const progress=document.getElementById('scrollProgress');
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function overflow(rail){return Math.max(0,rail.scrollWidth-rail.clientWidth)}
 function updateProgress(){
  frame=0;updateFilm();if(!progress)return;
  const height=document.documentElement.scrollHeight-innerHeight;
  progress.style.transform='scaleX('+clamp(height>0?scrollY/height:0,0,1)+')';
 }
 function updateFilm(){
  if(!pin)return;
  const distance=pin.end-pin.start;
  pin.start=film.getBoundingClientRect().top+scrollY-48;pin.end=pin.start+distance;
  const position=clamp((scrollY-pin.start)/(pin.end-pin.start),0,1);
  pinUpdate=true;photos.scrollLeft=overflow(photos)*position;pinUpdate=false;syncButtons(photos);
 }
 addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(updateProgress)},{passive:true});
 function syncButtons(rail){
  const buttons=rails.get(rail);if(!buttons)return;
  const max=overflow(rail);
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
  rails.set(rail,{previous,next});
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
  const start=title?{opacity:.25,transform:'translateY(22px)',filter:'blur(5px)'}:{opacity:.3,transform:'translateY(14px) scale(.95)'};
  const end=title?{opacity:1,transform:'translateY(0)',filter:'blur(0)'}:{opacity:1,transform:'translateY(0) scale(1)'};
  const animation=node.animate([start,end],{duration:600,delay,easing:ease});
  animations.add(animation);const done=()=>animations.delete(animation);animation.onfinish=done;animation.oncancel=done;
 }
 const revealObserver='IntersectionObserver' in window?new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){
   const node=entry.target;revealObserver.unobserve(node);
   if(node.matches('.deep-chat-intro,.deep-app>div:first-child,.deep-section-intro')){
    [...node.children].filter(n=>n.matches('.deep-kicker,h2')).forEach((n,i)=>reveal(n,i*100,true));
   }else reveal(node,0,node.matches('.world-heading'));
  }
 },{threshold:.12}):null;
 function observeReveals(root){
  if(!revealObserver||reduced.matches)return;
  const selector='.deep-chat-intro,.deep-app>div:first-child,.deep-section-intro,.world-heading,.corner-card,.deep-app-art,.public-memory,.public-media-layout>video,.thoughts-entry .media-entry-card';
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
  rails.forEach((_,rail)=>syncButtons(rail));updateProgress();
  // Only desktop gets a pin. Touch users keep native page scrolling + horizontal swipe.
  const canPin=!reduced.matches&&desktop.matches&&stage&&photos?.querySelectorAll('.public-memory').length>1&&overflow(photos)>2;
  if(canPin){
   stage.classList.add('is-pinned');setHint(true);
   const distance=overflow(photos),start=film.getBoundingClientRect().top+scrollY-48;
   film.style.height=(stage.offsetHeight+distance)+'px';
   pin={start,end:start+distance};updateFilm();
  }else if(!canPin)removePin();
  ST?.refresh();updateProgress();
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
  const sizes=new ResizeObserver(()=>{if(!pinUpdate)scheduleLayout()});
  rails.forEach((_,rail)=>sizes.observe(rail));
 }
 addEventListener('resize',scheduleLayout,{passive:true});
 addEventListener('load',scheduleLayout,{once:true});
 document.fonts?.ready.then(scheduleLayout);
 desktop.addEventListener('change',scheduleLayout);
 function stopDecorations(){
  removePin();parallax?.kill();parallax=null;curtain?.kill();curtain=null;
  const wash=document.querySelector('.player-wash'),footer=document.querySelector('.deep-footer');
  if(gsap){if(wash)gsap.set(wash,{clearProps:'transform'});if(footer)gsap.set(footer,{clearProps:'clipPath,transform'})}
 }
 function decorations(){
  stopDecorations();if(!gsap||reduced.matches)return;
  if(desktop.matches){
   const wash=document.querySelector('.player-wash');
   if(wash)parallax=gsap.fromTo(wash,{y:-18},{y:24,ease:'none',scrollTrigger:{trigger:'.deep-hero',start:'top top',end:'bottom top',scrub:.4}});
  }
  const footer=document.querySelector('.deep-footer');
  if(footer)curtain=gsap.fromTo(footer,{clipPath:'inset(55% 0 0 0)',y:20},{clipPath:'inset(0% 0 0 0)',y:0,ease:'none',scrollTrigger:{trigger:footer,start:'top bottom',end:'bottom bottom',scrub:.3}});
  scheduleLayout();
 }
 desktop.addEventListener('change',decorations);
 reduced.addEventListener('change',()=>{
  if(reduced.matches){for(const a of animations)a.cancel();revealObserver?.disconnect();stopDecorations();}
  else{decorations();loadMotionLibrary();}
  scheduleLayout();
 });
 document.addEventListener('visibilitychange',()=>{
  for(const animation of animations){if(document.hidden)animation.pause();else animation.play()}
 });
 // Fixed-version CDN scripts are integrity checked and never block chat/player boot.
 // If unavailable, rails, native sticky pin, buttons and progress still work.
 function script(src,integrity){return new Promise((resolve,reject)=>{
  const tag=document.createElement('script');tag.src=src;tag.integrity='sha384-'+integrity;tag.crossOrigin='anonymous';tag.async=true;
  const timeout=setTimeout(()=>{tag.remove();reject(Error('motion timeout'))},8000);
  tag.onload=()=>{clearTimeout(timeout);resolve()};tag.onerror=()=>{clearTimeout(timeout);tag.remove();reject(Error('motion unavailable'))};document.head.append(tag);
 })}
 let loadingLibrary=false;
 async function loadMotionLibrary(){
  if(reduced.matches||loadingLibrary||ST||navigator.connection?.saveData)return;
  loadingLibrary=true;
  try{
   await script('https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js','HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc');
   await script('https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js','P8VzCVnT9NBUkMrpcIZrJbA7EBjJvh/fJS6PmP+4nLIM284DtsImIv8D0fFjIkeh');
   gsap=window.gsap;ST=window.ScrollTrigger;if(!gsap||!ST)return;
   gsap.registerPlugin(ST);ST.config({ignoreMobileResize:true});decorations();refreshLayout();
  }catch{/* Native scrolling remains fully functional. */}
  finally{loadingLibrary=false;}
 }
 updateProgress();scheduleLayout();loadMotionLibrary();
})();
