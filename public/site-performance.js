(()=>{
'use strict';
// Share network-aware scheduling; do not slow down the local lyric animation.
const near=new Map();
const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 for(const entry of entries)if(entry.isIntersecting){const callbacks=near.get(entry.target)||[];near.delete(entry.target);observer.unobserve(entry.target);for(const callback of callbacks)callback();}
},{rootMargin:'300px'}):null;
window.worldWhenNear=(node,callback)=>{
 if(!node)return;
 if(!observer){callback();return;}
 const callbacks=near.get(node)||[];callbacks.push(callback);near.set(node,callbacks);observer.observe(node);
};
// Only share public music metadata; sessions, chat and controls are never cached.
const publicPaths=new Set(['/api/deeplist/history','/api/deeplist/on-repeat']);
const reads=new Map();
window.worldPublicJSON=path=>{
 if(!publicPaths.has(path))throw Error('Not a public music read');
 const previous=reads.get(path);
 if(previous&&Date.now()-previous.at<30000)return previous.promise;
 const entry={at:Date.now()};
 entry.promise=fetch(path,{cache:'no-store',signal:AbortSignal.timeout(12000)}).then(response=>{
  if(!response.ok)throw Error('Music request failed');return response.json();
 }).catch(error=>{if(reads.get(path)===entry)reads.delete(path);throw error;});
 reads.set(path,entry);return entry.promise;
};
window.worldPollDelay=(normal,idle=normal)=>{
 const connection=navigator.connection;
 const slow=connection?.saveData||['slow-2g','2g','3g'].includes(connection?.effectiveType);
 return slow?Math.max(normal*2,idle):normal;
};
})();
