const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('public/listen-requests.js','utf8');
const events={},timers=[],calls=[],nodes={listenRequest:{addEventListener(type,fn){this.click=fn}},listenRequestStatus:{},listen:{click(){this.clicked=(this.clicked||0)+1}}};
let result='pending',failure=null;
const document={hidden:false,getElementById:id=>nodes[id],addEventListener:(type,fn)=>events[type]=fn};
const context={document,URL,location:{href:'https://example.com/deeplist.html?user=target'},AbortSignal,Date,JSON,Error,setTimeout:(fn)=>{timers.push(fn);return timers.length},clearTimeout(){},fetch:async(path,options)=>{calls.push({path,options});return {ok:!failure,json:async()=>failure?{error:failure}:path.includes('/me')?{channel:'sender'}:options.method==='POST'?{id:'request-id'}:{status:result}}}};
vm.createContext(context);vm.runInContext(source,context);
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate)};
(async()=>{
 await nodes.listenRequest.click();await flush();assert.equal(nodes.listenRequest.disabled,true);assert.equal(JSON.parse(calls.find(c=>c.options.method==='POST').options.body).channel,'target');
 assert.ok(calls.every(c=>c.options.cache==='no-store'&&c.options.credentials==='same-origin'));
 document.hidden=true;const before=calls.length;await timers.at(-1)();assert.equal(calls.length,before,'hidden page pauses polling');document.hidden=false;
 result='accepted';await timers.at(-1)();await flush();assert.equal(nodes.listen.clicked,undefined,'acceptance does not autoplay');assert.equal(nodes.listenRequest.disabled,false);await nodes.listenRequest.click();assert.equal(nodes.listen.clicked,1);
 events['deeplist-channel-changed']();assert.equal(nodes.listenRequest.textContent,'Listen together');result='rejected';await nodes.listenRequest.click();await flush();assert.match(nodes.listenRequestStatus.textContent,/declined/);
 failure='Requests are paused for five minutes';await nodes.listenRequest.click();assert.match(nodes.listenRequestStatus.textContent,/five minutes/);assert.equal(nodes.listenRequest.disabled,false);
 console.log('PASS website requests: target, private fetches, hidden-page pause, acceptance with fresh playback gesture, reject, mute feedback and channel reset');
})().catch(e=>{console.error(e);process.exitCode=1});
