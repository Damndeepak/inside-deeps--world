(()=>{
  const palettes={violet:['#b9a6ff','#6850b5'],mint:['#8be0bd','#167651'],rose:['#ffa4bc','#ac365d'],amber:['#f6ce84','#885c12'],blue:['#9bc7ff','#2866a7']};
  let mode='dark',accent='violet';
  try{mode=localStorage.getItem('deep_theme')||mode;accent=localStorage.getItem('deep_accent')||accent}catch{}
  if(!['dark','light','system'].includes(mode))mode='dark';if(!palettes[accent])accent='violet';
  const system=matchMedia('(prefers-color-scheme: dark)');
  function apply(){
    const resolved=mode==='system'?(system.matches?'dark':'light'):mode;
    document.documentElement.dataset.worldTheme=resolved;
    document.documentElement.dataset.worldAccent=accent;
    document.documentElement.style.setProperty('--world-accent',palettes[accent][resolved==='light'?1:0]);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='light'?'#f5f3f9':'#070707');
  }
  apply();system.addEventListener?.('change',apply);
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-theme-controls]').forEach(box=>{
      const make=(labelText,key,choices,current)=>{
        const label=document.createElement('label');label.textContent=labelText;
        const select=document.createElement('select');select.setAttribute('aria-label',labelText);
        for(const value of choices){const o=document.createElement('option');o.value=value;o.textContent=value[0].toUpperCase()+value.slice(1);select.append(o)}select.value=current;
        select.addEventListener('change',()=>{if(key==='theme')mode=select.value;else accent=select.value;try{localStorage.setItem('deep_'+key,select.value)}catch{}apply()});
        label.append(select);box.append(label);
      };
      make('Theme','theme',['dark','light','system'],mode);make('Accent','accent',Object.keys(palettes),accent);
    });
  });
})();
