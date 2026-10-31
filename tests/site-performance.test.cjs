const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
 let now=0,reads=0,fail=false,finish;
 const observers=[];
 class Observer{constructor(callback){this.callback=callback;this.nodes=new Set();observers.push(this)}observe(node){this.nodes.add(node)}unobserve(node){this.nodes.delete(node)}}
 const window={},navigator={connection:{effectiveType:'4g',saveData:false}};
 const context={window,navigator,IntersectionObserver:Observer,Map,Set,AbortSignal,Date:{now:()=>now},fetch:async()=>{reads++;await new Promise(resolve=>finish=resolve);if(fail)throw Error('offline');return {ok:true,json:async()=>({tracks:[]})}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/site-performance.js','utf8'),context);
 const node={};let near=0;window.worldWhenNear(node,()=>near++);window.worldWhenNear(node,()=>near++);
 assert.equal(near,0,'below-fold work waits for intersection');
 observers[0].callback([{target:node,isIntersecting:false}]);assert.equal(near,0);
 observers[0].callback([{target:node,isIntersecting:true}]);assert.equal(near,2);assert.equal(observers[0].nodes.size,0);
 assert.equal(window.worldPollDelay(1000,5000),1000);
 navigator.connection.effectiveType='3g';assert.equal(window.worldPollDelay(1000,5000),5000);
 navigator.connection.effectiveType='4g';navigator.connection.saveData=true;assert.equal(window.worldPollDelay(1500,5000),5000);
 assert.throws(()=>window.worldPublicJSON('/api/user'),'private/session requests cannot enter shared music cache');
 const a=window.worldPublicJSON('/api/deeplist/history'),b=window.worldPublicJSON('/api/deeplist/history');
 assert.equal(a,b);assert.equal(reads,1,'concurrent history consumers share a single request');finish();await a;
 assert.equal(window.worldPublicJSON('/api/deeplist/history'),a,'fresh public metadata is reused');
 now=30001;fail=true;const failure=window.worldPublicJSON('/api/deeplist/history');finish();await assert.rejects(failure);
 fail=false;const retry=window.worldPublicJSON('/api/deeplist/history');assert.equal(reads,3,'failed requests are never retained');finish();await retry;
 // The startup path goes directly to the feed, without awaiting the state endpoint.
 const chat=fs.readFileSync('public/home-chat.js','utf8');
 const boot=chat.slice(chat.indexOf('async function boot(){'),chat.indexOf('\nE.more.addEventListener'));
 let feed=0;const E={empty:{style:{}}};const bootContext={E,loadFeed:async()=>feed++,getState:()=>{throw Error('state waterfall returned')}};
 vm.createContext(bootContext);vm.runInContext(boot+'\nboot()',bootContext);await new Promise(setImmediate);assert.equal(feed,1);
 for(const name of ['index.html','deeplist.html']){
  const html=fs.readFileSync('public/'+name,'utf8');
  for(const tag of html.match(/<link[^>]*fonts.googleapis.com\/css[^>]*>/g)||[]){
   assert.ok(tag.includes('media="print"'),'web fonts cannot block first paint');
   const link={media:'print'};new Function(tag.match(/onload="([^"]+)"/)[1]).call(link);assert.equal(link.media,'all');
  }
 }
 console.log('PASS: lazy section scheduling, slow-network backoff, bounded public request sharing, retry recovery, direct chat bootstrap and nonblocking font handlers');
})().catch(error=>{console.error(error);process.exitCode=1});
