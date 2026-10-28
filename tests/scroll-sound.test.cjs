const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let time=0,starts=0,playing=false,spinning=false;
const events={},listeners={},root={scrollTop:0,scrollLeft:0},volumes=[];
function node(){return {connect(){},disconnect(){}};}
class AudioContext{
 constructor(){this.sampleRate=48000;this.currentTime=0;this.state='running';this.destination={};}
 createGain(){return {...node(),gain:{set value(v){volumes.push(v)},setValueAtTime(){},linearRampToValueAtTime(v){volumes.push(v)},exponentialRampToValueAtTime(){}}};}
 createBuffer(c,n){return {getChannelData:()=>new Float32Array(n)};}
 createBufferSource(){return {...node(),playbackRate:{},start(){starts++},stop(){this.onended?.()}};}
 createBiquadFilter(){return {...node(),frequency:{},Q:{}};}
}
const document={scrollingElement:root,hidden:false,addEventListener:(type,fn)=>listeners[type]=fn,querySelector:()=>spinning?{}:null,querySelectorAll:()=>playing?[{paused:false,muted:false,volume:1}]:[]};
const window={AudioContext,scrollX:0,scrollY:0,addEventListener:(type,fn)=>events[type]=fn};
vm.runInNewContext(fs.readFileSync('public/scroll-sound.js','utf8'),{window,document,performance:{now:()=>time},Math});
function scroll(pixels,ms=100){time+=ms;root.scrollTop+=pixels;listeners.scroll({target:document});}
scroll(100);assert.equal(starts,0,'No autoplay before user input');
events.wheel({type:'wheel',isTrusted:false});scroll(100);assert.equal(starts,0,'Synthetic input does not unlock audio');
events.wheel({type:'wheel',isTrusted:true});scroll(50);assert.equal(starts,1);
scroll(100,10);assert.equal(starts,1,'Rapid events are throttled');scroll(50,150);assert.equal(starts,2);
document.hidden=true;scroll(100);assert.equal(starts,2);document.hidden=false;
spinning=true;scroll(100);assert.equal(starts,2,'Do not layer over carousel audio');spinning=false;
playing=true;scroll(100);assert.ok(volumes.at(-1)<.2,'Music playback ducks scroll effect');
const previous=starts;time+=3000;scroll(100);assert.equal(starts,previous,'Scrolling without fresh user intent stays silent');
events.touchmove({type:'touchmove',isTrusted:true});scroll(100);assert.equal(starts,previous+1);
listeners.visibilitychange();scroll(100);assert.equal(starts,previous+1);
for(const path of ['index.html','deeplist.html','arcade.html','on-repeat.html','the-room.html','memories.html','metrolist.html','media/index.html'])assert.match(fs.readFileSync('public/'+path,'utf8'),/\/scroll-sound\.js\?v=1/);
assert.doesNotMatch(fs.readFileSync('public/index.html','utf8'),/id="labSound"/);
console.log('PASS: user gesture, scroll sound, cooldown, hidden page, carousel exclusion, music ducking, intent expiry, all eight pages and no sound button');
