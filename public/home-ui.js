(()=>{
'use strict';
// Activity becomes visible only after a response; failed activity stays quiet.
for(const id of ['worldHistory','deeplistListeners']){
 const box=document.getElementById(id);if(!box)continue;
 const observer=new MutationObserver(()=>{if(box.querySelector('.loading-row'))return;const panel=box.closest('[data-activity]');panel.hidden=false;observer.disconnect()});observer.observe(box,{childList:true});
}
// Manage focus without changing the established password/API behavior.
let returnFocus=null;
const dialogs=[...document.querySelectorAll('.modal')];
for(const modal of dialogs){new MutationObserver(()=>{if(modal.classList.contains('show')){if(!returnFocus)returnFocus=document.activeElement;modal.querySelector('input,button')?.focus()}else if(!dialogs.some(d=>d.classList.contains('show'))){returnFocus?.focus();returnFocus=null}}).observe(modal,{attributes:true,attributeFilter:['class']})}
document.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const modal=dialogs.find(d=>d.classList.contains('show'));if(!modal)return;const items=[...modal.querySelectorAll('button,input,a[href],textarea')].filter(n=>!n.disabled&&!n.hidden);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}});
})();
