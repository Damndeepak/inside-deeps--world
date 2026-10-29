const HANDLE = 'deepAi';

export function mentionRange(value, start, end = start) {
  if (start !== end) return null;
  const match = value.slice(0, start).match(/(?:^|[^\p{L}\p{N}_@])@([A-Za-z0-9_]*)$/u);
  if (!match || !HANDLE.toLowerCase().startsWith(match[1].toLowerCase())) return null;
  const suffix = value.slice(start).match(/^[A-Za-z0-9_]*/)[0];
  return { start: start - match[1].length - 1, end: start + suffix.length };
}

export function initChatMentions(input, list, option) {
  if (!input || !list || !option) return null;
  let active = null, composing = false;
  function close() {
    active = null; list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function update() {
    const range = composing ? null : mentionRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range) { close(); return; }
    active = range; list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', option.id);
  }
  function choose() {
    if (!active) return;
    // Re-read the caret so a stale suggestion can never overwrite another word.
    const range = mentionRange(input.value, input.selectionStart, input.selectionEnd);
    if (!range) { close(); return; }
    const end = range.end + (input.value[range.end] === ' ' ? 1 : 0);
    input.setRangeText('@' + HANDLE + ' ', range.start, end, 'end');
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }
  function handleKeydown(event) {
    if (!active || event.isComposing || composing) return false;
    if (['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key) || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      if (event.key === 'Escape') close();
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
  option.addEventListener('pointerdown', event => event.preventDefault());
  option.addEventListener('click', choose);
  close();
  return { close, handleKeydown };
}
