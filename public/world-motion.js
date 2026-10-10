(()=>{
  'use strict';
  function init(){
    if(document.querySelector('.deep-ambient'))return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    const ambient=document.createElement('div');
    const scene=document.querySelector('.room');
    ambient.className='deep-ambient'+(scene?' deep-ambient-scene':'');
    ambient.setAttribute('aria-hidden','true');
    for(let i=0;i<12;i++){
      const mote=document.createElement('span');mote.className='deep-mote';
      mote.style.cssText='--x:'+((i*31+9)%100)+'%;--y:'+((i*47+18)%100)+'%;--size:'+(i%3+2)+'px;--duration:'+(18+i%5*3)+'s;--delay:-'+(i*2+1)+'s';
      ambient.append(mote);
    }
    (scene||document.body).prepend(ambient);
    // Reveal once without hiding content beforehand or touching existing transforms.
    const active=new Set(),seen=new WeakSet();
    const targets='.media-entry,.lfm,.cx-card,.song-player,.public-video-player,.unsent,.world-card,.world-memory,.world-rank';
    function reveal(node){
      if(reduced.matches||!node.animate)return;
      const animation=node.animate([{opacity:.4,translate:'0 12px'},{opacity:1,translate:'0 0'}],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)'});
      active.add(animation);
      const done=()=>active.delete(animation);animation.onfinish=done;animation.oncancel=done;
      if(document.hidden)animation.pause();
    }
    const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);reveal(entry.target)}
    },{threshold:.08}):null;
    function observe(root){
      if(!observer||!(root instanceof Element))return;
      const nodes=[...(root.matches(targets)?[root]:[]),...root.querySelectorAll(targets)];
      for(const node of nodes)if(!seen.has(node)){seen.add(node);observer.observe(node)}
    }
    observe(document.body);
    // Observe only dynamic memory/ranking containers, never chat tokens or lyrics.
    const dynamic=document.querySelectorAll('#worldMemories,#worldRepeat');
    if(dynamic.length&&'MutationObserver' in window){const updates=new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes)observe(node);
    });dynamic.forEach(node=>updates.observe(node,{childList:true}));}
    function visibility(){
      document.documentElement.classList.toggle('deep-motion-paused',document.hidden);
      for(const animation of active){if(document.hidden)animation.pause();else animation.play()}
    }
    document.addEventListener('visibilitychange',visibility);visibility();
    reduced.addEventListener?.('change',()=>{if(reduced.matches)for(const animation of [...active])animation.cancel()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
