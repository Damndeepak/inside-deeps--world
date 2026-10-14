const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.options=this.children;this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.style={};this.clientWidth=360;this.classList={add(){},remove(){},toggle(){}};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.options=this.children;}scrollIntoView(){}select(){}
}
const source=fs.readFileSync('public/deeplist.js','utf8');
async function check(privateSession){
 const nodes={},requests=[],frames=[];const channel='abc123';
 const context={document:{getElementById:id=>nodes[id]??=new Element(),createElement:tag=>new Element(tag),addEventListener(){},hidden:false,head:new Element()},location:{search:'?user='+channel,origin:'https://example.com',href:'https://example.com/deeplist.html?user='+channel},history:{replaceState(){}},URL,URLSearchParams,performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},window:{addEventListener(){}},sessionStorage:{getItem(){return null}},prompt:()=>'',navigator:{clipboard:{writeText:async()=>{}}},console,
 fetch:async(path,options={})=>{requests.push({path,options});let data;if(path.startsWith('/api/deeplist/control-access'))data={canControl:privateSession};else if(path.startsWith('/api/deeplist/state'))data={connected:true,serverNow:1000,receivedAt:1000,state:{id:'abcdefghijk',title:'Test song',artist:'Artist',playing:true,position:1500,duration:60000,lyricsVersion:'one',lines:[{time:0,text:'hello world',words:[{text:'hello',start:0,end:2000},{text:'world',start:2000,end:4000}]}]}};else if(path.includes('/control'))data={queued:true};else if(path.includes('/listeners'))data={listeners:[]};else if(path.includes('/me'))data={channel,paired:false};else if(path.includes('/name'))data={channel,label:'Test'};else if(path.includes('/pair'))data={website:'https://example.com',token:'a'.repeat(64),channel};else if(path.includes('/handoff'))data={link:'deeplist://connect?website=https%3A%2F%2Fexample.com&code='+'b'.repeat(64)};else throw Error(path);return {ok:true,json:async()=>data};}};
 vm.createContext(context);vm.runInContext(source,context);for(let i=0;i<8;i++)await new Promise(setImmediate);
 assert.equal(nodes.remoteControls.hidden,!privateSession);assert.equal(nodes.currentLine.className,'wordstorm-stage');assert.equal(nodes.currentLine.children.length,9);
 for(const fn of frames.splice(0,1))fn(1000);
 if(privateSession){await nodes.remotePlay.onclick();const sent=requests.find(r=>r.path.startsWith('/api/deeplist/control?'));assert.equal(JSON.parse(sent.options.body).action,'pause');assert.equal(JSON.parse(sent.options.body).trackId,'abcdefghijk');}
 else{await nodes.remotePlay.onclick();assert.ok(!requests.some(r=>r.path.startsWith('/api/deeplist/control?')));}
 await nodes.createPair.onclick();assert.ok(nodes.openApp.href.startsWith('deeplist://connect?'));assert.ok(!nodes.openApp.href.includes('a'.repeat(64)));assert.equal(nodes.pairResult.hidden,true);
}
(async()=>{await check(false);await check(true);console.log('PASS: website UI logic, Wordstorm nodes, public/private controls and app-link pairing');})().catch(e=>{console.error(e);process.exitCode=1});
