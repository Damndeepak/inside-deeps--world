(()=>{
 'use strict';
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const rails=new Map();
 let refreshTimer,frame=0,pageRange=1;
 const nativeProgress=CSS.supports('animation-timeline: scroll()');
 const progress=document.getElementById('scrollProgress');
 const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
 function overflow(rail){return Math.max(0,rail.scrollWidth-rail.clientWidth)}
 function updateProgress(){
  frame=0;if(!progress)return;
  if(!nativeProgress||reduced.matches)progress.style.transform='scaleX('+clamp(scrollY/pageRange,0,1)+')';
 }
 addEventListener('scroll',()=>{if((!nativeProgress||reduced.matches)&&!frame)frame=requestAnimationFrame(updateProgress)},{passive:true});
 function syncButtons(rail){
  const buttons=rails.get(rail);if(!buttons)return;
  const max=buttons.max;
  buttons.previous.forEach(b=>b.disabled=rail.scrollLeft<=2||max<=2);
  buttons.next.forEach(b=>b.disabled=rail.scrollLeft>=max-2||max<=2);
 }
 function goTo(rail,left){
  const target=clamp(left,0,overflow(rail));
  rail.scrollTo({left:target,behavior:reduced.matches?'auto':'smooth'});
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
  syncButtons(rail);
 });
 function refreshLayout(){
  clearTimeout(refreshTimer);
  pageRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);
  rails.forEach((buttons,rail)=>{buttons.max=overflow(rail);syncButtons(rail)});
  updateProgress();
 }
 function scheduleLayout(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshLayout,120)}
 // Watch only the rails, not chat or the continuously updating lyric/progress elements.
 if('MutationObserver' in window){
  const updates=new MutationObserver(scheduleLayout);
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
 reduced.addEventListener('change',scheduleLayout);
 updateProgress();scheduleLayout();
})();
