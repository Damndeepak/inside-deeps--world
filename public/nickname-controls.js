import { IDENTITY_SYMBOLS, IDENTITY_COLORS, identityColor, identityLabel, randomNickname } from './chat-identity.js';
export function initNicknameControls({ onSaved, headers = () => ({'Content-Type':'application/json'}) }) {
  const $ = id => document.getElementById(id);
  const input=$('cxNickname'), symbol=$('cxNicknameSymbol'), palette=$('cxNicknameColors');
  const save=$('cxNicknameSave'), dice=$('cxNicknameDice'), reset=$('cxNicknameReset');
  const status=$('cxNicknameStatus'), preview=$('cxNicknamePreview'), dot=$('cxNicknamePreviewDot');
  let color='lavender', defaultName='your name', busy=false, loaded=false;
  const swatches=[];
  function paintPreview() {
    preview.textContent=identityLabel(input.value.trim()||defaultName,symbol.value,'@');
    dot.style.background=identityColor(color);
    swatches.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===color)));
  }
  for (const value of IDENTITY_SYMBOLS) {
    const option=document.createElement('option');option.value=value;option.textContent=value||'No symbol';symbol.append(option);
  }
  for (const [key,value] of Object.entries(IDENTITY_COLORS)) {
    const button=document.createElement('button');button.type='button';button.className='nickname-swatch';
    button.dataset.color=key;button.style.setProperty('--swatch',value);
    button.setAttribute('aria-label',key[0].toUpperCase()+key.slice(1));button.title=key;
    button.onclick=()=>{color=key;paintPreview();};palette.append(button);swatches.push(button);
  }
  function setBusy(value) {
    busy=value;save.disabled=value||!loaded;
    for(const node of [input,symbol,dice,reset,...swatches])node.disabled=value;
  }
  input.oninput=paintPreview;symbol.onchange=paintPreview;
  dice.onclick=()=>{let suggestion=randomNickname();if(suggestion===input.value)suggestion=randomNickname();input.value=suggestion;paintPreview();};
  reset.onclick=()=>{input.value='';paintPreview();};
  function apply(data) {
    defaultName=data.defaultName||data.user.username;input.value=data.nickname||'';
    symbol.value=IDENTITY_SYMBOLS.includes(data.user.symbol)?data.user.symbol:'';
    color=Object.hasOwn(IDENTITY_COLORS,data.user.color||'')?data.user.color:'lavender';paintPreview();
  }
  async function load() {
    try {
      const response=await fetch('/api/user/nickname',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Could not load identity.');
      apply(data);loaded=true;setBusy(false);
    } catch {status.textContent='Identity settings unavailable. You can still chat with your existing name.';}
  }
  $('cxNicknameForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!loaded)return;setBusy(true);status.textContent='Saving…';
    try {
      const response=await fetch('/api/user/nickname',{method:'POST',headers:headers(),signal:AbortSignal.timeout(15000),body:JSON.stringify({nickname:input.value,symbol:symbol.value,color})});
      const data=await response.json();if(!response.ok||!data.success)throw Error(data.error||'Could not save your identity.');
      apply(data);onSaved(data.user);status.textContent='Saved. Your chat and linked music identity are updated.';
      document.dispatchEvent(new Event('deeplist-identity-updated'));
    } catch(error) {status.textContent=error.message||'Could not save your identity. Try again.';}
    finally {setBusy(false);}
  });
  paintPreview();return {load};
}
