// Long press/right click/Shift+F10 shows people; a regular tap still toggles.
export function bindReactionHold(list, show) {
  let hold=null,timer=0,suppress=null;
  const cancel=()=>{clearTimeout(timer);timer=0;hold=null;};
  const open=b=>{
    const id=b.closest('.cx-row')?.dataset.id;if(!id||id.startsWith('tmp-'))return;
    suppress={id,emoji:b.dataset.emoji,until:Date.now()+1000};
    show(id,b.dataset.emoji,b);
  };
  list.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    const b=e.target.closest('.cx-react');if(!b)return;
    cancel();hold={b,x:e.clientX,y:e.clientY};
    timer=setTimeout(()=>{const target=hold?.b;cancel();if(target)open(target);},450);
  });
  list.addEventListener('pointermove',e=>{if(hold&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>8)cancel();});
  for(const event of ['pointerup','pointercancel','pointerleave'])list.addEventListener(event,cancel);
  list.addEventListener('contextmenu',e=>{const b=e.target.closest('.cx-react');if(!b)return;e.preventDefault();cancel();open(b);});
  list.addEventListener('keydown',e=>{const b=e.target.closest('.cx-react');if(b&&(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))){e.preventDefault();open(b);}});
  list.addEventListener('click',e=>{
    const b=e.target.closest('.cx-react');
    if(b&&suppress&&Date.now()<suppress.until&&b.dataset.emoji===suppress.emoji&&b.closest('.cx-row')?.dataset.id===suppress.id){
      e.preventDefault();e.stopImmediatePropagation();suppress=null;
    }
  },true);
}
export function initReactionPeople(list){
  const dialog=document.createElement('dialog');dialog.className='cx-reactors';
  const head=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
  title.id='cxReactorsTitle';dialog.setAttribute('aria-labelledby',title.id);
  close.type='button';close.textContent='×';close.setAttribute('aria-label','Close reaction names');
  head.append(title,close);
  const status=document.createElement('p'),people=document.createElement('ul'),more=document.createElement('button');
  status.setAttribute('role','status');more.type='button';more.textContent='Load more';more.hidden=true;
  dialog.append(head,status,people,more);document.body.append(dialog);
  let epoch=0,current=null,trigger=null,controller=null,busy=false;
  async function load(append=false){
    if(!current||busy)return;busy=true;
    const version=epoch,{id,emoji}=current;more.disabled=true;status.textContent='Loading…';
    controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),8000);
    try{
      const q=new URLSearchParams({message_id:id,emoji,...(append&&current.after?{after:current.after}:{})});
      const r=await fetch('/api/chat/reactions?'+q,{cache:'no-store',signal:controller.signal}),d=await r.json();
      if(version!==epoch)return;
      if(!r.ok||!d.success)throw Error(d.error||'Could not load reactions');
      if(!append)people.replaceChildren();
      for(const name of d.people){const li=document.createElement('li');li.textContent='@'+name;people.append(li);}
      status.textContent=people.children.length?'Hold any reaction to see who’s here.':'No reactions yet.';
      more.hidden=!d.has_more;current.after=d.next;
    }catch(e){if(version===epoch){status.textContent=e.name==='AbortError'?'Could not load reactions. Try again.':e.message;more.textContent='Try again';more.hidden=false;}}
    finally{clearTimeout(timeout);if(version===epoch){busy=false;more.disabled=false;}}
  }
  close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{epoch++;controller?.abort();current=null;busy=false;trigger?.focus();});
  more.addEventListener('click',()=>load(!!current?.after));
  bindReactionHold(list,(id,emoji,button)=>{
    epoch++;controller?.abort();busy=false;current={id,emoji,after:null};trigger=button;
    title.textContent=emoji+' · reacted';people.replaceChildren();more.hidden=true;more.textContent='Load more';
    if(!dialog.open)dialog.showModal();load();
  });
}
