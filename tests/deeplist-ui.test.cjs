const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(tag='div'){
  this.tag=tag;this.children=[];this.options=this.children;this.hidden=false;this.disabled=false;this.checked=true;this.value='';this.textContent='';
  this.style={setProperty(key,value){this[key]=value;}};this.clientWidth=360;this.clientHeight=500;this.offsetTop=0;this.offsetHeight=100;this.attributes={};
  this.classes=new Set();this.classList={add:(c)=>this.classes.add(c),remove:(c)=>this.classes.delete(c),toggle:(c,on)=>{if(on??!this.classes.has(c))this.classes.add(c);else this.classes.delete(c);}};
 }
 append(...nodes){for(const node of nodes){node.offsetTop=this.children.length*120;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.options=this.children;this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}
 scrollIntoView(){}select(){}
}
const source=fs.readFileSync('public/deeplist.js','utf8');
const html=fs.readFileSync('public/deeplist.html','utf8');
for(const id of source.match(/Object.fromEntries\(\[(.*?)\]\.map/s)[1].matchAll(/'([^']+)'/g))assert.ok(html.includes('id=\"'+id[1]+'\"'),'Missing DOM node '+id[1]);
assert.ok(html.includes('/deeplist-live.css'));assert.ok(html.includes('/media/apple-demo.css'));
assert.ok(!fs.readFileSync('public/deeplist.css','utf8').includes('.wordstorm-stage'));
assert.ok(fs.readFileSync('public/deeplist-live.css','utf8').includes('prefers-reduced-motion'));
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
async function check(privateSession){
 const nodes={},requests=[],frames=[],events={},timeouts=[],images=[];const channel='abc123';let now=1000;
 let state={id:'abcdefghijk',title:'Test song',artist:'Artist',playing:true,position:1500,duration:60000,lyricsVersion:'one',offset:0,lines:[
  {time:0,text:'hello world',words:[{text:'hello',start:0,end:2000},{text:'world',start:2000,end:4000}]},
  {time:4000,text:'Full second line'},
  {time:8000,text:'Third line stays visible'}
 ]},connected=true;
 const document={getElementById:id=>nodes[id]??=new Element(),createElement:tag=>{const node=new Element(tag);if(tag==='img')images.push(node);return node;},addEventListener:(type,fn)=>events[type]=fn,dispatchEvent:event=>events[event.type]?.(event),hidden:false,head:new Element()};
 const context={document,Event,location:{search:'?user='+channel,origin:'https://example.com',href:'https://example.com/deeplist.html?user='+channel},history:{replaceState(){}},URL,URLSearchParams,AbortController,AbortSignal,performance:{now:()=>now},setTimeout:(fn,ms)=>{timeouts.push({fn,ms});return timeouts.length;},clearTimeout(){},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},cancelAnimationFrame(){},window:{addEventListener(){}},sessionStorage:{getItem(){return null}},prompt:()=>'',navigator:{clipboard:{writeText:async()=>{}}},console,
 fetch:async(path,options={})=>{
  requests.push({path,options});let data;
  if(path.startsWith('/api/deeplist/control-access'))data={canControl:privateSession};
  else if(path.startsWith('/api/deeplist/state'))data={connected,serverNow:now,receivedAt:now,state:structuredClone(state)};
  else if(path.includes('/control'))data={queued:true};else if(path.includes('/listeners'))data={listeners:[]};else if(path.includes('/me'))data={channel,paired:false};else if(path.includes('/name'))data={channel,label:'Test'};else if(path.includes('/pair'))data={website:'https://example.com',token:'a'.repeat(64),channel};else if(path.includes('/handoff'))data={link:'deeplist://connect?website=https%3A%2F%2Fexample.com&code='+'b'.repeat(64)};else throw Error(path);
  return {ok:true,json:async()=>data};
 }};
 vm.createContext(context);vm.runInContext(source,context);await flush();
 const run=code=>vm.runInContext(code,context);
 assert.equal(nodes.remoteControls.hidden,!privateSession);
 assert.ok(timeouts.some(t=>t.ms===500),'live player refreshes within 500ms');
 assert.ok(requests.find(r=>r.path.startsWith('/api/deeplist/state')).options.signal);
 const rows=nodes.currentLine.children;
 assert.equal(rows.length,3);assert.equal(rows[0].attributes['aria-label'],'hello world');
 assert.deepEqual(rows[0].children.map(n=>n.textContent),['hello','world']);
 assert.equal(rows[0].children[0].style['--fill'],'75%');assert.equal(rows[0].children[1].style['--fill'],'0%');
 assert.ok(rows[0].classes.has('am-active'));assert.equal(rows[0].disabled,!privateSession);
 assert.equal(nodes.currentLine.style.transform,'translateY(170px)');
 assert.ok(nodes.liveStage.classes.has('am-playing'));assert.ok(nodes.liveStatus.classes.has('deeplist-live-indicator'));
 now=4000;run('paint()');assert.ok(rows[1].classes.has('am-active'));assert.ok(rows[0].classes.has('am-near'));
 assert.equal(rows[0].children[1].style['--fill'],'100%');
 const scroll=nodes.currentLine.style.transform;assert.notEqual(scroll,'translateY(170px)');
 // A pause uses the app position, not the browser clock; cached lyrics survive omitted lines.
 state={...state,playing:false,position:5000};delete state.lines;await run('poll()');
 now=15000;run('paint()');assert.equal(nodes.positionLabel.textContent,'0:05');assert.equal(nodes.currentLine.style.transform,scroll);
 assert.ok(!nodes.liveStage.classes.has('am-playing'));assert.ok(!nodes.liveStatus.classes.has('deeplist-live-indicator'));assert.equal(nodes.currentLine.children[0],rows[0]);
 // Offset changes and backward seeks re-centre the right full line without stale word fill.
 state={...state,position:500,offset:1000};await run('poll()');
 assert.ok(nodes.currentLine.children[0].classes.has('am-active'));
 assert.equal(nodes.currentLine.children[0].children[0].style['--fill'],'75%');
 // Word controls keep server authorization, including lyric taps; anonymous visitors send nothing.
 await nodes.currentLine.children[1].onclick();await flush();
 const seek=requests.find(r=>r.path.startsWith('/api/deeplist/control?'));
 if(privateSession){assert.equal(JSON.parse(seek.options.body).action,'seek');assert.equal(JSON.parse(seek.options.body).position,3000);}
 else assert.equal(seek,undefined);
 await nodes.remotePlay.onclick();
 if(privateSession){assert.ok(requests.some(r=>r.path.startsWith('/api/deeplist/control?')&&JSON.parse(r.options.body).action==='play'));}
 else assert.ok(!requests.some(r=>r.path.startsWith('/api/deeplist/control?')));
 // Same-version lyrics on a different song must rebuild; no previous song leaks into it.
 state={id:'zyxwvutsrqp',title:'New song',artist:'New artist',playing:true,position:0,duration:30000,lyricsVersion:'one',lines:[{time:0,text:'<img onerror=bad> safe'}]};await run('poll()');
 assert.equal(nodes.currentLine.children.length,1);assert.equal(nodes.currentLine.children[0].attributes['aria-label'],'<img onerror=bad> safe');
 assert.equal(nodes.currentLine.children[0].children[0].tag,'span');
 // Artwork loads once per track, rejects stale completions, and fails dark.
 assert.equal(images.length,2);
 assert.equal(nodes.liveStage.style['--live-art'],'none');
 images[0].naturalWidth=480;images[0].onload();
 assert.equal(nodes.liveStage.style['--live-art'],'none','old cover cannot replace new song');
 images[1].naturalWidth=480;images[1].onload();
 assert.ok(nodes.liveStage.style['--live-art'].includes('/zyxwvutsrqp/hqdefault.jpg'));
 await run('poll()');assert.equal(images.length,2,'heartbeats do not reload artwork');
 images[1].onerror();assert.equal(nodes.liveStage.style['--live-art'],'none');
 // A slow old response must never replace a newer song after a new poll supersedes it.
 const normalFetch=context.fetch;let finishOld,oldSignal;
 context.fetch=(path,options)=>{oldSignal=options.signal;return new Promise(resolve=>finishOld=resolve);};
 const oldPoll=run('poll()');context.fetch=normalFetch;
 state={...state,title:'Newest song'};await run('poll()');assert.equal(oldSignal.aborted,true);
 finishOld({ok:true,json:async()=>({connected:true,serverNow:now,receivedAt:now,state:{...state,title:'Late old song'}})});await oldPoll;
 assert.equal(nodes.trackTitle.textContent,'Newest song');
 // A timeout racing with a response still schedules recovery instead of stopping the poller.
 context.fetch=async()=>{timeouts.filter(t=>t.ms===1500).at(-1).fn();return {ok:true,json:async()=>({connected:true,serverNow:now,receivedAt:now,state})};};
 const timerCount=timeouts.length;await run('poll()');assert.ok(timeouts.slice(timerCount).some(t=>t.ms===500));
 assert.equal(nodes.liveStatus.textContent,'Connection unavailable. Retrying…');context.fetch=normalFetch;await run('poll()');

 // Repeated words and enhanced syllables retain their own timestamps.
 const native=run(`appleLineWords({time:1000,text:'Hello hello',words:[{text:'Hel',start:1000,end:1200},{text:'lo',start:1200,end:1700},{text:'hello',start:2000,end:2800}]},4000)`);
 assert.deepEqual(Array.from(native,w=>[w.start,w.end]),[[1000,1700],[2000,2800]]);
 const fallback=run(`appleLineWords({time:1000,text:'one two'},3000)`);
 assert.deepEqual(Array.from(fallback,w=>[w.start,w.end]),[[1000,2000],[2000,3000]]);
 // All demo look controls affect this live stage.
 for(const [id,value,key,expected]of [['liveAppleSize','52','--am-size','52px'],['liveAppleSpacing','.08','--am-gap','.08em'],['liveAppleBlur','68','--am-blur','68px']]){nodes[id].value=value;nodes[id].oninput();assert.equal(nodes.liveStage.style[key],expected);}
 nodes.liveAppleMotion.checked=false;nodes.liveAppleMotion.onchange();assert.ok(nodes.liveStage.classes.has('am-still'));
 timeouts.filter(t=>t.ms===15000).at(-1).fn();assert.ok(!nodes.liveStatus.classes.has('deeplist-live-indicator'));assert.equal(nodes.currentLine.children.length,0);await run('poll()');
 document.hidden=true;events.visibilitychange();assert.ok(!nodes.liveStage.classes.has('am-playing'));document.hidden=false;
 connected=false;await run('poll()');assert.equal(nodes.liveStage.style['--live-art'],'none');images.at(-1).naturalWidth=480;images.at(-1).onload();assert.equal(nodes.liveStage.style['--live-art'],'none','offline discards pending cover');assert.equal(nodes.currentLine.children.length,0);assert.equal(nodes.lyricsMessage.hidden,false);assert.equal(nodes.listen.disabled,true);
 connected=true;state={...state,lines:[],lyricsVersion:'empty'};await run('poll()');assert.equal(nodes.currentLine.children.length,0);assert.equal(nodes.lyricsMessage.textContent,'Lyrics unavailable for this song.');
 // Failed/expired YouTube loads must allow a fresh retry.
 const failedAPI=run('loadAPI()');const failedCheck=assert.rejects(failedAPI,/YouTube could not load/);
 document.head.children.at(-1).onerror();await failedCheck;
 const retryAPI=run('loadAPI()');const timeoutCheck=assert.rejects(retryAPI,/YouTube could not load/);
 assert.equal(document.head.children.length,2);
 timeouts.filter(t=>t.ms===15000).at(-1).fn();await timeoutCheck;
 const workingAPI=run('loadAPI()');context.window.onYouTubeIframeAPIReady();await workingAPI;
 // Failure from the previous player's control check cannot lock the new player.
 const originalFetch=context.fetch;let failOldControl;
 context.fetch=()=>new Promise((resolve,reject)=>{failOldControl=reject;});
 const pendingControl=run('checkControl()');run('channelEpoch++');context.fetch=originalFetch;
 await run('checkControl()');failOldControl(Error('old network failure'));await pendingControl;
 assert.equal(nodes.remoteControls.hidden,!privateSession);
 await nodes.createPair.onclick();assert.ok(nodes.openApp.href.startsWith('deeplist://connect?'));assert.ok(!nodes.openApp.href.includes('a'.repeat(64)));assert.equal(nodes.pairResult.hidden,true);
}
(async()=>{await check(false);await check(true);console.log('PASS: full-line Apple lyrics, word timing/fill, pause, seek, offset, track change, offline, look controls and private pairing');})().catch(e=>{console.error(e);process.exitCode=1});
