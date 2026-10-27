const {readFileSync}=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function fixture({desktop=true,native=true,reduced=false}={}){
 let reads=0;const events={},timers=new Map(),frames=[];let tid=0;
 const style=()=>({removeProperty(k){delete this[k]}});
 const classes=()=>({values:new Set(),add(n){this.values.add(n)},remove(n){this.values.delete(n)}});
 const rail={id:'homeMemories',scrollLeft:0,listeners:{},get scrollWidth(){reads++;return 1600},get clientWidth(){reads++;return 900},addEventListener(t,f){this.listeners[t]=f},querySelectorAll:()=>[{},{}],scrollTo({left}){this.scrollLeft=left}};
 const stage={style:style(),classList:classes(),get offsetHeight(){reads++;return 400}};
 const film={style:style(),querySelector:s=>s==='.memory-film-stage'?stage:null,getBoundingClientRect(){reads++;return {top:1000-context.scrollY}}};
 const bar={style:style()},main={},queries=[];
 const context={scrollY:0,innerHeight:900,CSS:{supports:()=>native},matchMedia:q=>({matches:q.includes('reduced-motion')?reduced:desktop,addEventListener(){}}),addEventListener:(t,f)=>events[t]=f,requestAnimationFrame:f=>{frames.push(f);return frames.length},setTimeout:f=>{timers.set(++tid,f);return tid},clearTimeout:id=>timers.delete(id),document:{body:{querySelectorAll:()=>[]},hidden:false,documentElement:{get scrollHeight(){reads++;return 6000}},getElementById:id=>({memoryFilm:film,homeMemories:rail,scrollProgress:bar})[id],querySelector:()=>main,querySelectorAll:s=>{queries.push(s);return s==='[data-scroll-rail]'?[rail]:[]},addEventListener(){}}};
 context.window=context;context.scrollTo=({top})=>{context.scrollY=top};vm.runInNewContext(readFileSync('public/home-motion.js','utf8'),context);
 for(const f of [...timers.values()])f();timers.clear();
 return {rail,stage,film,bar,context,reset:()=>reads=0,reads:()=>reads,scroll(y){context.scrollY=y;events.scroll();frames.splice(0).forEach(f=>f());rail.listeners.scroll()}};
}
let f=fixture();assert.equal(f.stage.classList.values.has('is-pinned'),true);assert.equal(f.film.style.height,'1100px');
f.reset();f.scroll(1200);assert.ok(Math.abs(f.rail.scrollLeft-248)<.001);assert.equal(f.reads(),0,'scroll frames must not read layout dimensions or bounding rects');
f.scroll(1500);assert.ok(Math.abs(f.rail.scrollLeft-548)<.001);f.scroll(1100);assert.ok(Math.abs(f.rail.scrollLeft-148)<.001);assert.equal(f.reads(),0);
f=fixture({desktop:false});f.reset();f.scroll(1200);assert.equal(f.stage.classList.values.has('is-pinned'),false);assert.equal(f.rail.scrollLeft,0);assert.equal(f.reads(),0);
f=fixture({native:false});f.reset();f.scroll(2550);assert.equal(f.bar.style.transform,'scaleX(0.5)');assert.equal(f.reads(),0);
f=fixture({reduced:true});assert.equal(f.stage.classList.values.has('is-pinned'),false);
console.log('PASS: cached pin geometry, forward/reverse scrolling without layout reads, mobile bypasses pin, fallback progress and reduced-motion pin removal');
