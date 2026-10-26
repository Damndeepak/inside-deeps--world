(() => {
const dialog=document.getElementById('ptDialog'),open=document.getElementById('ptOpen');
open.addEventListener('click',()=>dialog.showModal());
document.getElementById('ptClose').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
})();
