import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';
import {handleFeatures} from '../src/features.js';
const assets=[];
const env={ASSETS:{fetch:async r=>{assets.push(new URL(r.url).pathname);return new Response('public asset')}}};
for(const path of ['/memories','/memories/']){
 const response=await worker.fetch(new Request('https://example.com'+path),env,{});assert.equal(response.status,200);assert.equal(assets.at(-1),path);
}
for(const section of ['memories','music','people']){
 const response=await worker.fetch(new Request('https://example.com/api/check-password',{method:'POST',body:JSON.stringify({section,password:'anything'})}),env,{});assert.equal(response.status,410);
}
const row={id:'photo-1',caption:'A public moment',memory_date:'2026-10-26',r2_key:'memories/photo-1',content_type:'image/jpeg'};
const db={prepare:sql=>({bind(){return this},all:async()=>({results:[row]}),first:async()=>row}),batch:async()=>[]};
const helpers={getUserId:()=>null,getUser:async()=>null,chatIsAdmin:async()=>false,ensureChatSchema:async()=>{},chatSniffImage:()=>null};
const featureEnv={DB:db,CHAT_IMAGES:{get:async()=>({body:new Uint8Array([1,2]),httpEtag:'test',size:2})}};
const call=(path,method='GET')=>handleFeatures(new Request('https://example.com'+path,{method}),featureEnv,{},helpers);
let response=await call('/api/memories');assert.equal(response.status,200);assert.equal((await response.json()).memories[0].caption,row.caption);
assert.equal((await call('/api/memories/photo-1/image')).status,200);
for(const [path,method] of [['/api/memories','POST'],['/api/memories/photo-1','PATCH'],['/api/memories/photo-1','DELETE'],['/api/memories/visits','GET']])assert.equal((await call(path,method)).status,403);
const home=fs.readFileSync('public/index.html','utf8'),media=fs.readFileSync('public/media/index.html','utf8');
assert.ok(!/deepPrivate|passwordModal|home-private.js|Deep Private Section/.test(home));assert.ok(home.includes('homeMemories'));assert.ok(home.includes('<video'));
assert.ok(media.includes('publicPlaylist'));assert.ok(media.includes('id="appleLyricsDemo"'));assert.ok(media.includes('id="aditiPlayer"'));assert.ok(!fs.existsSync('public/home-private.js'));
console.log('PASS: password-free gallery routes, retired password endpoint, anonymous photo/caption access, protected admin writes, public playlist/video hooks');
