(()=>{'use strict';
const root=document.documentElement,box=document.querySelector('[data-theme-controls]');
let off=matchMedia('(prefers-reduced-motion: reduce)').matches;
try{const saved=localStorage.getItem('deep_motion');if(saved)off=saved==='off'}catch{}
const button=document.createElement('button');button.type='button';button.className='deep-motion-toggle';
function apply(){root.dataset.deepMotion=off?'off':'on';button.textContent=off?'Motion: off':'Motion: on';button.setAttribute('aria-pressed',String(!off));if(off)document.getAnimations?.().forEach(a=>a.cancel())}
button.addEventListener('click',()=>{off=!off;try{localStorage.setItem('deep_motion',off?'off':'on')}catch{}apply()});box?.append(button);apply();
const preview=document.getElementById('deepMemoryPreview');
if(preview)fetch('/api/memories',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(d=>{
for(const m of (d.memories||[]).slice(0,3)){if(!/^[a-zA-Z0-9_-]+$/.test(String(m.id)))continue;const a=document.createElement('a'),img=document.createElement('img'),caption=document.createElement('span');a.href='/memories.html';img.src='/api/memories/'+encodeURIComponent(m.id)+'/image';img.alt=m.caption||'A moment from the Memory Wall';img.loading='lazy';img.width=320;img.height=240;caption.textContent=m.caption||'A little moment';a.append(img,caption);preview.append(a)}
}).catch(()=>{});
})();
