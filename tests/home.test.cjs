const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Node{
 constructor(){this.children=[];this.textContent='';this.hidden=false;this.className='';this.values=new Map();this.classList={toggle:(name,value)=>this.values.set(name,value),remove:name=>this.values.delete(name)};this.style={setProperty:(k,v)=>this.values.set(k,v),removeProperty:k=>this.values.delete(k)};}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes;this.textContent=''}setAttribute(){}addEventListener(){}
}
async function render(state,history=[],failure=false){
 const nodes={},frames=[],timers=[];const context={document:{getElementById:id=>nodes[id]??=new Node(),createElement:()=>new Node(),hidden:false,addEventListener(){}},window:{worldIsVisible:()=>true},performance:{now:()=>1000},URL,JSON,AbortSignal,clearTimeout(){},setTimeout:fn=>{timers.push(fn);return timers.length},requestAnimationFrame:fn=>{frames.push(fn);return frames.length},cancelAnimationFrame(){},fetch:async url=>{if(failure)throw Error('offline');return {ok:true,json:async()=>url.includes('/state')?state:{tracks:history}}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/deeplist-home.js','utf8'),context);for(let i=0;i<8;i++)await new Promise(setImmediate);for(const frame of frames.splice(0,1))frame(1000);return {nodes,timers,frames};
}
(async()=>{
 let r=await render({connected:true,serverNow:1000,receivedAt:1000,state:{id:'abcdefghijk',title:'Track',artist:'Artist',playing:true,position:30000,duration:60000,lines:[{time:0,text:'First line'}]}});
 assert.equal(r.nodes.homeProgress.hidden,false);assert.equal(r.nodes.homeProgressFill.style.width,'50%');assert.equal(r.nodes.homeElapsed.textContent,'0:30');assert.equal(r.nodes.deeplistHomeLyrics.textContent,'First line');assert.equal(r.nodes.lfmLabel.textContent,'NOW PLAYING');assert.equal(r.timers.length,1);
 r=await render({connected:false},[{name:'Earlier track',artist:'Artist',image:'javascript:alert(1)'}]);assert.equal(r.nodes.lfmLabel.textContent,'LAST ON REPEAT');assert.equal(r.nodes.homeProgress.hidden,true);assert.equal(r.nodes.lfmBody.children[0].children[0].textContent,'d.');
 r=await render({connected:false});assert.equal(r.nodes.lfmLabel.textContent,'BETWEEN SONGS');assert.equal(r.nodes.homeProgress.hidden,true);
 r=await render(null,[],true);assert.equal(r.nodes.lfmLabel.textContent,'BETWEEN CONNECTIONS');assert.equal(r.nodes.lfmBody.children.length,1);assert.equal(r.timers.length,1);
 const css=fs.readFileSync('public/home.css','utf8');assert.ok(css.includes('--paper:#070707'));assert.ok(css.includes('color-scheme:dark'));const html=fs.readFileSync('public/index.html','utf8');for(const id of ['cxThread','cxMe','cxNicknameForm','ptDialog','homeProgress'])assert.ok(html.includes('id="'+id+'"'));assert.ok(!/Checking Deeplist|checking presence|You appear as|Loading recent/.test(html));
 console.log('PASS: homepage live progress/lyrics, offline history, safe artwork, empty/error recovery, preserved chat hooks and removed loading text');
})().catch(e=>{console.error(e);process.exitCode=1});
