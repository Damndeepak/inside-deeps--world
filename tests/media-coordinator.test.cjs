const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('public/media/index.html','utf8');
const script=html.match(/<script id="media-single-player-js">([\s\S]*?)<\/script>/)[1];
class Root{
 constructor(){this.elements=[];this.media=[];this.frames=[];this.events={};}
 querySelectorAll(selector){return selector==='*'?this.elements:selector==='iframe'?this.frames:this.media;}
 addEventListener(type,fn){(this.events[type]??=[]).push(fn)}
 dispatch(type,event={}){for(const fn of this.events[type]||[])fn(event)}
}
const audio=()=>({paused:false,matches:s=>s==='audio,video',pause(){this.paused=true}});
const document=new Root(),regular=audio();document.media.push(regular);
vm.runInNewContext(script,{document,WeakSet});
const shadow=new Root(),nested=new Root(),child=new Root();
const shadowAudio=audio(),nestedAudio=audio(),frameAudio=audio();
shadow.media.push(shadowAudio);nested.media.push(nestedAudio);child.media.push(frameAudio);
document.elements.push({shadowRoot:shadow});shadow.elements.push({shadowRoot:nested});
document.frames.push({contentDocument:child,addEventListener(){}});
document.dispatch('DOMContentLoaded');
shadow.dispatch('play',{target:shadowAudio});
assert.equal(shadowAudio.paused,false);assert.equal(regular.paused,true);assert.equal(nestedAudio.paused,true);assert.equal(frameAudio.paused,true);
regular.paused=false;document.dispatch('play',{target:regular});assert.equal(shadowAudio.paused,true);
assert.equal(document.events.play.length,1,'Binding late shadow players must not duplicate document listeners');
console.log('PASS: exclusive playback across late shadow roots, nested roots, regular audio and iframe players');
