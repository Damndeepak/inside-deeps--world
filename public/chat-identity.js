export const IDENTITY_SYMBOLS = ['', '♡', '🪐', '✦', '🎧', '🌙', '⚡', '🫧', '🪷'];
export const IDENTITY_COLORS = {
  lavender: '#bca4f5', mint: '#91d6b0', peach: '#edb494',
  sky: '#94c9f0', rose: '#eaa6bd', gold: '#ddcc86'
};
export const identityColor = key => Object.hasOwn(IDENTITY_COLORS, key || '') ? IDENTITY_COLORS[key] : IDENTITY_COLORS.lavender;
export const identityLabel = (name, symbol, prefix = '') => prefix + name + (IDENTITY_SYMBOLS.includes(symbol) && symbol ? ' ' + symbol : '');
export function randomNickname(random = Math.random) {
  const moods = ['sleepy', 'midnight', 'cosmic', 'lofi', 'tiny', 'sad', 'chaotic', 'quiet', 'neon', 'lost', 'lunar', 'soft'];
  const things = ['cassette', 'samosa', 'ghost', 'noodle', 'orbit', 'vinyl', 'pigeon', 'waffle', 'echo', 'moon', 'chai', 'cloud'];
  return moods[Math.floor(random() * moods.length)] + ' ' + things[Math.floor(random() * things.length)];
}
