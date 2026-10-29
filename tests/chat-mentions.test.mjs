import assert from 'node:assert/strict';
import {initChatMentions, mentionRange} from '../public/chat-mentions.js';
class Input extends EventTarget {
  value='';selectionStart=0;selectionEnd=0;attrs=new Map();
  setAttribute(k,v){this.attrs.set(k,v)} removeAttribute(k){this.attrs.delete(k)}
  focus(){}
  setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length;}
  type(value,caret=value.length){this.value=value;this.selectionStart=this.selectionEnd=caret;this.dispatchEvent(new Event('input'));}
}
const input=new Input(),list={hidden:true},option=new EventTarget();option.id='ai-option';
const mentions=initChatMentions(input,list,option);
function key(name,extra={}){let prevented=false;const handled=mentions.handleKeydown({key:name,preventDefault(){prevented=true},...extra});return {handled,prevented};}
for(const text of ['email@deep','@@','@someone','@deepAi_extra','ordinary text']){input.type(text);assert.equal(list.hidden,true);}
input.type('@');assert.equal(list.hidden,false);assert.equal(input.attrs.get('aria-expanded'),'true');
assert.deepEqual(key('Enter'),{handled:true,prevented:true},'Choosing a suggestion consumes Enter instead of sending the message');
assert.equal(input.value,'@deepAi ');assert.equal(input.selectionStart,8);assert.equal(list.hidden,true);
assert.deepEqual(key('Enter'),{handled:false,prevented:false},'Normal Enter behavior resumes once the mention is inserted');
input.type('hey @DE');key('Tab');assert.equal(input.value,'hey @deepAi ');
input.type('hey @de, how are you?',7);option.dispatchEvent(new Event('click'));assert.equal(input.value,'hey @deepAi , how are you?','Text on both sides of the mention is preserved');
input.type('@deepAi hello',4);key('Enter');assert.equal(input.value,'@deepAi hello');assert.equal(input.selectionStart,8,'Replacing in the middle does not duplicate a full handle or its following space');
input.type('@d');key('Escape');assert.equal(list.hidden,true);assert.equal(input.value,'@d');assert.equal(input.attrs.has('aria-activedescendant'),false);
input.type('@d');assert.equal(key('Enter',{isComposing:true}).handled,false,'IME confirmation must never select or send');
input.dispatchEvent(new Event('blur'));assert.equal(list.hidden,true);
assert.equal(mentionRange('hi @d',3,5),null,'Replacing selected text does not trigger autocomplete');
console.log('PASS: mention autocomplete, safe insertion at caret, email exclusion, touch selection, IME, Escape and Enter without accidental sends');
