const HANDLES = ['deepAi', 'S.Ai'];

export function mentionRange(value, start, end = start) {
  if (start !== end) return null;
  const match = value.slice(0, start).match(/(?:^|[^\p{L}\p{N}_@])@([A-Za-z0-9_.]*)$/u);
  if (!match || !HANDLES.some(handle=>handle.toLowerCase().startsWith(match[1].toLowerCase()))) return null;
  const suffix = value.slice(start).match(/^[A-Za-z0-9_.]*/)[0];
  return { start: start - match[1].length - 1, end: start + suffix.length };
}

export function initChatMentions(input, list, option) {
  if (!input || !list || !option) return null;
  const options = [option, ...Array.from(list.querySelectorAll?.('[data-ai-handle]') || [])].filter((item,index,all)=>all.indexOf(item)===index);
  const handleOf = item => item.dataset?.aiHandle || 'deepAi';
  let selected = option, visible = [], active = null, composing = false;
  function close() {
    active = null; list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function update() {
    const range = composing ? null : mentionRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range) { close(); return; }
    const prefix=input.value.slice(range.start+1,input.selectionStart).toLowerCase();
    visible=options.filter(item=>{const show=handleOf(item).toLowerCase().startsWith(prefix);item.hidden=!show;return show;});
    if(!visible.length){close();return;}
    selected=visible[0];
    active = range; list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', selected.id);
  }
  function choose() {
    if (!active) return;
    // Re-read the caret so a stale suggestion can never overwrite another word.
    const range = mentionRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range) { close(); return; }
    const end = range.end + (input.value[range.end] === ' ' ? 1 : 0);
    input.setRangeText('@' + handleOf(selected) + ' ', range.start, end, 'end');
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }
  function handleKeydown(event) {
    if (!active || event.isComposing || composing) return false;
    if (['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key) || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {selected=visible[(visible.indexOf(selected)+(event.key==='ArrowDown'?1:visible.length-1))%visible.length]; input.setAttribute('aria-activedescendant',selected.id);}
      else if (event.key === 'Escape') close();
      else if (event.key === 'Enter' || event.key === 'Tab') choose();
      return true;
    }
    return false;
  }
  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('select', update);
  input.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update(); });
  input.addEventListener('blur', close);
  input.addEventListener('compositionstart', () => { composing = true; close(); });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  for(const item of options){item.addEventListener('pointerdown',event=>event.preventDefault());item.addEventListener('click',()=>{selected=item;choose();});}
  close();
  return { close, handleKeydown };
}
