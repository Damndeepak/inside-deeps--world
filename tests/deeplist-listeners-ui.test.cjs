const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node{
 constructor(){this.children=[];this.className='';this.style={};this.classList={remove:c=>{if(this.className===c)this.className='';}};}
 set textContent(text){this.text=text;this.children=[];}get textContent(){return this.text||'';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}closest(){return this;}
 querySelectorAll(selector){const all=this.children.flatMap(n=>[n,...n.querySelectorAll(selector)]);return all.filter(n=>'.'+n.className===selector);}
}
const box=new Node(),count=new Node(),timers=[],events={};let fail=false;
const context={document:{hidden:false,getElementById:id=>id==='deeplistListeners'?box:count,createElement:()=>new Node(),addEventListener:(type,fn)=>events[type]=fn},window:{},AbortSignal,performance:{now:()=>1000},Date,clearTimeout(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},fetch:async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>({serverNow:20000,totalConnected:4,listeners:[
 {channel:'one',label:'Playing',title:'Song',artist:'Artist',live:true,playing:true,lastPlayedAt:19500},
 {channel:'two',label:'Paused',title:'Song',artist:'Artist',live:true,playing:false,lastPlayedAt:19500},
 {channel:'three',label:'Offline',title:'Song',artist:'Artist',live:false,playing:true,lastPlayedAt:19000},
 {channel:'four',label:'Stale',title:'Song',artist:'Artist',live:true,playing:true,lastPlayedAt:0}
 ]})};}};
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
(async()=>{
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/deeplist-listeners.js','utf8'),context);await flush();
 const info=i=>box.children[i].children.find(n=>n.className==='deeplist-listener-info').children;
 assert.equal(info(0)[0].className,'deeplist-live-indicator');assert.equal(info(0)[2].textContent,'Live · open synced lyrics');
 assert.equal(info(1)[0].className,'');assert.equal(info(1)[2].textContent,'Paused · open synced lyrics');
 for(const i of [2,3]){assert.equal(info(i)[0].className,'');assert.ok(info(i)[2].textContent.startsWith('Last shared'));}
 assert.equal(count.textContent,'4 music connections recorded');
 timers.find(t=>t.ms===14500).fn();assert.equal(info(0)[0].className,'');assert.ok(info(0)[2].textContent.startsWith('Last shared'));
 fail=true;timers.find(t=>t.ms===750).fn();await flush();assert.equal(box.textContent,'Connected listeners are unavailable right now.');assert.equal(box.children.length,0);
 console.log('PASS: tiny live markers only for fresh playing listeners; paused, offline, stale and network failure never blink');
})().catch(e=>{console.error(e);process.exitCode=1});
