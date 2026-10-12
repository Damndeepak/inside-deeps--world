(() => {
  const el=id=>document.getElementById(id), form=el('ptForm'), input=el('ptText'), list=el('ptList'), status=el('ptStatus'), save=el('ptSave'), cancel=el('ptCancel');
  let admin=false, rows=[], editing=null, busy=false, epoch=0;
  const key=()=>{try{return sessionStorage.getItem('cxAdminKey')||''}catch{return ''}};
  const note=text=>{status.textContent=text};
  async function api(path,method='GET',body){
    const headers={}; if(method!=='GET'){headers['X-Admin-Key']=key();headers['Content-Type']='application/json'}
    const r=await fetch(path,{method,headers,cache:'no-store',...(body?{body:JSON.stringify(body)}:{})}), data=await r.json();
    if(!r.ok||!data.success)throw new Error(data.error||'Could not load thoughts');return data;
  }
  function reset(){editing=null;form.reset();save.textContent='Publish thought';cancel.hidden=true}
  function render(){
    list.replaceChildren();
    if(!rows.length){const p=document.createElement('p');p.className='world-note';p.textContent='No thoughts posted yet.';list.append(p);return}
    rows.forEach(row=>{
      const article=document.createElement('article');article.className='pt-post';
      const p=document.createElement('p');p.className='pt-body';p.textContent=row.body;
      const meta=document.createElement('div');meta.className='pt-meta';
      const date=document.createElement('time');date.dateTime=row.created_at;date.textContent=new Date(row.created_at).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
      meta.append('Deepu · ',date);if(row.updated_at!==row.created_at)meta.append(' · edited');article.append(p,meta);
      if(admin){
        const tools=document.createElement('div');tools.className='pt-tools';
        for(const action of ['Edit','Delete']){
          const button=document.createElement('button');button.type='button';button.className='world-delete';button.textContent=action;
          button.onclick=async()=>{
            if(busy)return;
            if(action==='Edit'){editing=row.id;input.value=row.body;save.textContent='Save changes';cancel.hidden=false;input.focus();return}
            if(!confirm('Delete this public thought?'))return;
            busy=true;button.disabled=true;
            try{await api('/api/thoughts/'+encodeURIComponent(row.id),'DELETE');if(editing===row.id)reset();await load();note('Thought deleted.')}catch(e){note(e.message)}finally{busy=false;button.disabled=false}
          };tools.append(button);
        }article.append(tools);
      }list.append(article);
    });
  }
  async function load(){rows=(await api('/api/thoughts')).thoughts;render()}
  async function syncAdmin(){
    const current=++epoch, token=key();let verified=false;
    if(token)try{const r=await fetch('/api/chat/admin/check',{headers:{'X-Admin-Key':token},cache:'no-store'});verified=r.ok&&!!(await r.json()).admin}catch{}
    if(current!==epoch)return;admin=verified;form.hidden=!admin;el('ptAdmin').textContent=admin?'Admin mode on':'Admin';if(!admin)reset();render();
  }
  form.onsubmit=async e=>{
    e.preventDefault();if(busy||!admin)return;const body=input.value.trim();if(!body){note('Write something first.');return}
    busy=true;save.disabled=true;
    try{await api('/api/thoughts'+(editing?'/'+encodeURIComponent(editing):''),editing?'PATCH':'POST',{body});reset();note('Thought saved.');await load()}catch(e){note(e.message)}finally{busy=false;save.disabled=false}
  };
  cancel.onclick=reset;
  el('ptAdmin').onclick=()=>{if(!admin)el('cxAdmin').click();else input.focus()};
  window.addEventListener('world-admin-change',syncAdmin);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncAdmin();load().catch(e=>note(e.message))}});
  load().catch(e=>{list.replaceChildren();note(e.message)});syncAdmin();
})();
