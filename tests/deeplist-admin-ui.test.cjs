const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node{
 constructor(tag='div'){this.tag=tag;this.children=[];this.hidden=false;this.value='';this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}scrollIntoView(){}focus(){}
}
(async()=>{
const nodes={},events={},stored=new Map(),requests=[];let confirmed=false;
let players=[{channel:'owner',label:'damndeepak',owner:true},{channel:'visitor',label:'Unused player',paired:true,lastPlayedAt:0}];
const source=fs.readFileSync('public/deeplist-admin.js','utf8'),html=fs.readFileSync('public/deeplist.html','utf8');
for(const [,id]of source.matchAll(/\$\('([^']+)'\)/g))assert.ok(html.includes('id="'+id+'"'));
const document={getElementById:id=>nodes[id]??=new Node(),createElement:tag=>new Node(tag),dispatchEvent:e=>events[e.type]=e.detail};
const context={document,Date,Error,JSON,String,encodeURIComponent,location:{hash:''},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},confirm:()=>confirmed,sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},fetch:async(path,options)=>{
 requests.push({path,options});const url=new URL(path,'https://example.com');let data,status=200;
 if(options.headers['X-Admin-Key']!=='correct'){status=403;data={error:'admin_required'};}
 else if(options.method==='GET')data={players:structuredClone(players)};
 else if(options.method==='PATCH'){players.find(p=>p.channel===url.searchParams.get('channel')).label=JSON.parse(options.body).name;data={success:true};}
 else{players=players.filter(p=>p.channel!==url.searchParams.get('channel'));data={success:true};}
 return {ok:status===200,status,json:async()=>data};
}};
vm.createContext(context);vm.runInContext(source,context);
const submit={preventDefault(){}};
nodes.playerAdminKey.value='wrong';await nodes.playerAdminLogin.onsubmit(submit);assert.equal(nodes.playerAdminStatus.textContent,'Admin key is incorrect.');assert.equal(nodes.playerAdminTools.hidden,true);
nodes.playerAdminKey.value='correct';await nodes.playerAdminLogin.onsubmit(submit);assert.equal(nodes.playerAdminList.children.length,2);assert.equal(nodes.playerAdminLogin.hidden,true);assert.equal(nodes.playerAdminKey.value,'');assert.equal(stored.get('cxAdminKey'),'correct');
let owner=nodes.playerAdminList.children[0];owner.children[0].children[0].value='New owner';await owner.onsubmit(submit);assert.equal(players[0].label,'New owner');assert.equal(nodes.playerAdminList.children[0].children[0].children[0].value,'New owner');assert.ok(events['deeplist-players-updated']);assert.equal(owner.children.filter(n=>n.textContent==='Delete player').length,0);
const visitor=nodes.playerAdminList.children[1],remove=visitor.children.find(n=>n.textContent==='Delete player');await remove.onclick();assert.equal(players.length,2);confirmed=true;await remove.onclick();assert.equal(players.length,1);assert.equal(events['deeplist-players-updated'].deleted,'visitor');
assert.ok(requests.every(r=>r.options.headers['X-Deeplist-Action']==='admin'));
nodes.playerAdminLock.onclick();assert.equal(nodes.playerAdminTools.hidden,true);assert.equal(nodes.playerAdminList.children.length,0);assert.equal(stored.has('cxAdminKey'),false);
console.log('PASS: admin login, incorrect key, owner rename, delete cancellation/confirmation, refresh, lock and private request headers');
})().catch(e=>{console.error(e);process.exitCode=1;});
