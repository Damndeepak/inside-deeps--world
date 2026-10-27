import {identityColor,identityLabel} from './chat-identity.js';
(() => {
  'use strict';
  const box = document.getElementById('deeplistStats');
  if (!box) return;
  const list = document.getElementById('deeplistLeaderboard');
  const period = document.getElementById('deeplistStatsPeriod');
  const month = document.getElementById('deeplistStatsMonth');
  const note = document.getElementById('deeplistStatsNote');
  const currentMonth = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  month.value = currentMonth; month.max = currentMonth;
  let timer, controller;
  const minutes = ms => ms > 0 && ms < 60000 ? '<1 min' : Math.floor(Math.max(0, Number(ms) || 0) / 60000).toLocaleString() + ' min';
  async function load() {
    clearTimeout(timer);
    if (document.hidden) return;
    controller?.abort();
    const active = new AbortController(); controller = active;
    const deadline = setTimeout(() => active.abort(), 15000);
    try {
      const query = new URLSearchParams({ period: period.value, month: month.value || currentMonth });
      const response = await fetch('/api/deeplist/stats?' + query, { cache: 'no-store', signal: active.signal });
      if (!response.ok) throw Error('HTTP '+response.status);
      const data = await response.json();
      if (controller !== active || active.signal.aborted) return;
      list.replaceChildren();
      for (const [index, listener] of (data.listeners || []).entries()) {
        const row = document.createElement('li'), link = document.createElement('a');
        link.className = 'deeplist-rank';
        link.href = listener.channel === 'owner' ? '/deeplist.html' : '/deeplist.html?user=' + encodeURIComponent(listener.channel);
        const rank = document.createElement('span'); rank.className = 'deeplist-rank-number'; rank.textContent = String(index + 1).padStart(2, '0');
        const identity = document.createElement('span'), name = document.createElement('strong'), detail = document.createElement('small');
        name.textContent = identityLabel(listener.label,listener.symbol);if(listener.color)name.style.color=identityColor(listener.color);
        detail.textContent = listener.trackingSince ? 'Recorded since ' + new Date(listener.trackingSince).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Starts with the next shared playback';
        identity.append(name, detail);
        const time = document.createElement('span'); time.className = 'deeplist-rank-time';
        const score = document.createElement('strong'), total = document.createElement('small');
        score.textContent = minutes(data.period === 'all' ? listener.totalMs : listener.monthMs);
        total.textContent = data.period === 'all' ? 'recorded total' : minutes(listener.totalMs) + ' recorded total';
        time.append(score, total); link.append(rank, identity, time); row.append(link); list.append(row);
      }
      note.textContent = data.listeners?.length ? 'Per music connection · shared playback only · pauses and offline gaps excluded · months use India time. Earlier listening was not recorded.' : 'No shared listening yet. Connect Deeplist to start recording minutes.';
    } catch (error) {
      if (controller === active) console.warn('Deeplist stats:', error.name, error.message);
      if (controller === active) { list.replaceChildren(); note.textContent = 'Listening stats are unavailable. Retrying shortly.'; }
    } finally {
      clearTimeout(deadline);
      if (controller === active && !document.hidden) timer = setTimeout(load, 10000);
    }
  }
  period.onchange = () => { month.disabled = period.value === 'all'; load(); };
  month.onchange = load;
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); controller?.abort(); } else load(); });
  document.addEventListener('deeplist-identity-updated',load);
  load();
})();
