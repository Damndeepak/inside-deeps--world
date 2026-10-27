import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initNicknameControls} from '../public/nickname-controls.js';
import {identityLabel,identityColor,randomNickname} from '../public/chat-identity.js';
class Node {
 children=[];value='';disabled=false;textContent='';dataset={};attributes={};events={};
 style={setProperty(key,value){this[key]=value;}};
 append(...nodes){this.children.push(...nodes);}setAttribute(key,value){this.attributes[key]=value;}
 addEventListener(type,fn){this.events[type]=fn;}
}
const nodes={},events=[],requests=[],saved=[];
let fail=false;
globalThis.document={getElementById:id=>nodes[id]??=new Node(),createElement:()=>new Node(),dispatchEvent:event=>events.push(event.type)};
globalThis.fetch=async(url,options={})=>{
 requests.push({url,options});
 if(options.method==='POST'){
  const body=JSON.parse(options.body);
  return {ok:!fail,json:async()=>fail?{success:false,error:'This username is already taken.'}:{success:true,nickname:body.nickname,defaultName:'damn_waffle',user:{username:body.nickname||'damn_waffle',symbol:body.symbol,color:body.color}}};
 }
 return {ok:true,json:async()=>({success:true,nickname:'deepu',defaultName:'damn_waffle',user:{username:'deepu',symbol:'🪐',color:'mint'}})};
};
const controls=initNicknameControls({onSaved:user=>saved.push(user),headers:()=>({'Content-Type':'application/json'})});
await controls.load();
assert.equal(nodes.cxNickname.value,'deepu');assert.equal(nodes.cxNicknameSave.disabled,false);
assert.equal(nodes.cxNicknamePreview.textContent,'@deepu 🪐');assert.equal(nodes.cxNicknamePreviewDot.style.background,identityColor('mint'));
const rose=nodes.cxNicknameColors.children.find(n=>n.dataset.color==='rose');rose.onclick();assert.equal(rose.attributes['aria-pressed'],'true');
nodes.cxNicknameSymbol.value='♡';nodes.cxNicknameSymbol.onchange();assert.equal(nodes.cxNicknamePreview.textContent,'@deepu ♡');
const before=requests.length;nodes.cxNicknameDice.onclick();assert.ok(nodes.cxNickname.value.length<=24);assert.ok(!nodes.cxNickname.value.startsWith('damn_'));assert.equal(requests.length,before,'Dice previews a suggestion without saving');
nodes.cxNickname.value='cosmic chai';nodes.cxNickname.oninput();await nodes.cxNicknameForm.events.submit({preventDefault(){}});
assert.equal(saved.length,1);assert.deepEqual(saved[0],{username:'cosmic chai',symbol:'♡',color:'rose'});assert.ok(events.includes('deeplist-identity-updated'));
assert.equal(nodes.cxNicknameSave.disabled,false);assert.equal(nodes.cxNicknamePreview.textContent,'@cosmic chai ♡');
fail=true;nodes.cxNickname.value='taken name';await nodes.cxNicknameForm.events.submit({preventDefault(){}});assert.equal(saved.length,1);assert.equal(nodes.cxNicknameStatus.textContent,'This username is already taken.');
const beforeReset=requests.length;nodes.cxNicknameReset.onclick();assert.equal(nodes.cxNickname.value,'');assert.equal(nodes.cxNicknamePreview.textContent,'@damn_waffle ♡');assert.equal(requests.length,beforeReset);
nodes.cxNickname.value='<img onerror=bad>';nodes.cxNickname.oninput();assert.equal(nodes.cxNicknamePreview.textContent,'@<img onerror=bad> ♡');assert.equal(nodes.cxNicknamePreview.children.length,0,'Preview never inserts nickname HTML');
assert.equal(identityColor('red;display:none'),identityColor('lavender'));
assert.equal(identityLabel('Deepu','<img>'),'Deepu');
for(let i=0;i<100;i++)assert.match(randomNickname(),/^[a-z]+ [a-z]+$/);
const html=fs.readFileSync('public/index.html','utf8');for(const id of ['cxNicknameSymbol','cxNicknameColors','cxNicknameDice','cxNicknamePreview','cxNicknamePreviewDot'])assert.ok(html.includes('id="'+id+'"'));
assert.ok(html.includes('maxlength="24"'));assert.ok(html.includes('name changes every 24 hours'));
console.log('PASS: identity preview, symbol/colour picker, dice without auto-save, canonical save, duplicate errors, default preview and safe text rendering');
