const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.textContent='';this.value='';this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
}
const nodes={},events={},timers=[],requests=[];let failure=false;
let listeners=[{channel:'owner',label:'Deepu',monthMs:61000,totalMs:120000,trackingSince:Date.parse('2026-10-27T00:00:00Z')},{channel:'visitor',label:'<img onerror=bad>',monthMs:500,totalMs:1000,trackingSince:null}];
const document={hidden:false,getElementById:id=>nodes[id]??=new Node(),createElement:tag=>new Node(tag),addEventListener:(type,fn)=>events[type]=fn};
const context={console:{warn(){}},document,Date,URLSearchParams,AbortController,clearTimeout(){},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},fetch:async(url,options)=>{requests.push({url,options});if(failure)throw Error('offline');const query=new URLSearchParams(url.split('?')[1]);return {ok:true,json:async()=>({period:query.get('period'),month:query.get('month'),listeners:structuredClone(listeners)})};}};
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
(async()=>{
 nodes.deeplistStatsPeriod=new Node('select');nodes.deeplistStatsPeriod.value='month';
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/chat-identity.js','utf8').replace(/^export /gm,'')+'\n'+fs.readFileSync('public/deeplist-stats.js','utf8').replace(/^import .*\n/,''),context);await flush();
 const row=i=>nodes.deeplistLeaderboard.children[i].children[0];
 assert.equal(row(0).href,'/deeplist.html');assert.equal(row(0).children[2].children[0].textContent,'1 min');
 assert.equal(row(1).children[1].children[0].textContent,'<img onerror=bad>');assert.equal(row(1).children[2].children[0].textContent,'<1 min');
 assert.match(row(1).children[1].children[1].textContent,/Starts with/);assert.ok(requests[0].options.signal);assert.ok(timers.some(t=>t.ms===10000));
 nodes.deeplistStatsPeriod.value='all';nodes.deeplistStatsPeriod.onchange();await flush();
 assert.equal(nodes.deeplistStatsMonth.disabled,true);assert.equal(row(0).children[2].children[0].textContent,'2 min');assert.ok(requests.at(-1).url.includes('period=all'));
 nodes.deeplistStatsPeriod.value='month';nodes.deeplistStatsPeriod.onchange();await flush();nodes.deeplistStatsMonth.value='2026-09';nodes.deeplistStatsMonth.onchange();await flush();assert.ok(requests.at(-1).url.includes('month=2026-09'));
 listeners=[];timers.filter(t=>t.ms===10000).at(-1).fn();await flush();assert.equal(nodes.deeplistLeaderboard.children.length,0);assert.match(nodes.deeplistStatsNote.textContent,/No shared listening/);
 failure=true;timers.filter(t=>t.ms===10000).at(-1).fn();await flush();assert.match(nodes.deeplistStatsNote.textContent,/unavailable/);assert.equal(nodes.deeplistLeaderboard.children.length,0);
 document.hidden=true;events.visibilitychange();assert.equal(requests.at(-1).options.signal.aborted,true);
 const html=fs.readFileSync('public/index.html','utf8');for(const id of ['deeplistStats','deeplistStatsPeriod','deeplistStatsMonth','deeplistLeaderboard','deeplistStatsNote'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('/deeplist-stats.css'));assert.ok(html.includes('/deeplist-stats.js'));
 console.log('PASS: monthly/total ranking controls, minute formatting, tracking start, safe labels, empty/error recovery and hidden-page cancellation');
})().catch(error=>{console.error(error);process.exitCode=1;});
