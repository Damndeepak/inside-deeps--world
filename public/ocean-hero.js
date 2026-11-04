(()=>{
'use strict';
if(!document.querySelector('.deep-hero'))return;
const backdrop=document.createElement('div');backdrop.className='ocean-background';backdrop.setAttribute('aria-hidden','true');document.body.prepend(backdrop);
const poster=document.createElement('img');poster.className='ocean-poster';poster.src='/media/night-ocean.jpg';poster.alt='';backdrop.append(poster);
const reduced=matchMedia('(prefers-reduced-motion: reduce)'),connection=navigator.connection;
if(reduced.matches||connection?.saveData||/2g/.test(connection?.effectiveType||''))return;
const video=document.createElement('video');video.className='ocean-video';video.muted=true;video.loop=true;video.playsInline=true;video.autoplay=true;video.preload='metadata';video.poster=poster.src;video.setAttribute('muted','');video.setAttribute('playsinline','');backdrop.append(video);
function sync(){document.documentElement.classList.toggle('page-hidden',document.hidden);if(!document.hidden&&!reduced.matches){if(!video.src)video.src='/media/night-ocean.mp4';video.play().catch(()=>{})}else video.pause()}
video.addEventListener('playing',()=>{poster.hidden=true});document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);document.addEventListener('pointerdown',sync,{once:true,passive:true});video.addEventListener('canplay',sync);sync();
})();
