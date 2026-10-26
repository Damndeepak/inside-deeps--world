(()=>{
'use strict';
// Activity becomes visible only after a response; failed activity stays quiet.
for(const id of ['worldHistory','deeplistListeners']){
 const box=document.getElementById(id);if(!box)continue;
 const observer=new MutationObserver(()=>{if(box.querySelector('.loading-row'))return;const panel=box.closest('[data-activity]');panel.hidden=false;observer.disconnect()});observer.observe(box,{childList:true});
}
})();
