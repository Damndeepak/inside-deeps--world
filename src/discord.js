import { identityFor } from './chat-identity.js';
import { identityColor, identityLabel } from '../public/chat-identity.js';

// Discord must never delay or fail a saved site message.
export function queueDiscordMessage(env, ctx, user, message) {
  if (!env.DISCORD_WEBHOOK_URL || !ctx?.waitUntil) return;
  ctx.waitUntil(postDiscordMessage(env, user, message));
}

export async function postDiscordMessage(env, user, message) {
  try {
    const url = new URL(env.DISCORD_WEBHOOK_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' ||
        !/^\/api(?:\/v10)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      console.warn('Discord bridge: invalid webhook configuration');
      return;
    }
    url.search = '?wait=true';
    let identity = {symbol:'', color:'lavender'};
    try { identity = await identityFor(env.DB, user.id); } catch {}
    const description = [message.text, message.image ? '[Photo shared in the Common Room]' : '',
      message.audio ? '[Voice note shared in the Common Room]' : ''].filter(Boolean).join('\n');
    if (!description) return;
    const payload = {
      username: identityLabel(user.username || 'Listener', identity.symbol).replace(/[\r\n]/g, ' ').slice(0,80),
      allowed_mentions: {parse:[], users:[], roles:[], replied_user:false},
      embeds: [{description:description.slice(0,4096), color:parseInt(identityColor(identity.color).slice(1),16),
        footer:{text:'The Common Room · '+message.id}}]
    };
    // Retry only explicit short rate limits; ambiguous failures can duplicate posts.
    for (let attempt=0; attempt<2; attempt++) {
      const response = await fetch(url.href, {method:'POST', redirect:'error',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(5000)});
      if (response.ok) { await response.body?.cancel(); return; }
      if (response.status === 429 && attempt === 0) {
        const limit = await response.json();
        const seconds = Number(limit.retry_after);
        if (Number.isFinite(seconds) && seconds > 0 && seconds <= 2) {
          await new Promise(resolve => setTimeout(resolve, Math.ceil(seconds*1000)));
          continue;
        }
      } else await response.body?.cancel();
      console.warn('Discord bridge: delivery skipped, HTTP '+response.status);
      return;
    }
  } catch {
    // Errors and response bodies can contain webhook credentials. Never log them.
    console.warn('Discord bridge: delivery unavailable');
  }
}
