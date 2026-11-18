// Flash run cycle rendered from nitwit.friends' HatchXR model (CC BY 4.0).
const feed = document.getElementById('cxThread');
const canvas = document.getElementById('chatFlash');
const pen = canvas?.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

if (feed && pen) {
  const wrapper = canvas.parentElement;
  const sprite = new Image();
  const trail = [];
  const fadeTime = 230;
  const runTime = 460;
  let frame = 0, ready = false, previousScroll = feed.scrollTop;
  let lastInput = -Infinity, runStart = -Infinity;
  let verticalDirection = -1, draggingScrollbar = false;

  function enable() {
    canvas.hidden = reducedMotion.matches || !ready;
    previousScroll = feed.scrollTop;
    if (canvas.hidden) {
      clear();
      loadSprite();
    }
  }

  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    trail.length = 0;
    runStart = -Infinity;
    pen.clearRect(0, 0, canvas.width, canvas.height);
  }

  function loadSprite() {
    if (!reducedMotion.matches && !sprite.getAttribute('src')) {
      sprite.src = '/flash-run.webp';
    }
  }

  function markInput() {
    lastInput = performance.now();
    loadSprite();
  }

  function drawSprite(pose, opacity, size) {
    const cell = pose.cell;
    pen.save();
    pen.globalAlpha = opacity;
    pen.translate(pose.x, pose.y);
    pen.scale(-1, 1);
    pen.rotate(.08);
    pen.drawImage(sprite, (cell % 8) * 128, Math.floor(cell / 8) * 150, 128, 150,
      -size * 0.5, -size * 0.59, size, size * 150 / 128);
    pen.restore();
  }

  function paint(now) {
    frame = 0;
    if (canvas.hidden || document.hidden) return clear();
    const age = now - runStart;
    const width = wrapper.clientWidth, height = feed.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, width, height);
    if (age >= runTime + fadeTime || height < 75) return clear();

    const size = Math.max(52, Math.min(80, width * .16));
    const progress = Math.min(1, age / runTime);
    const x = width + size / 2 - (width + size) * progress;
    const y = height * .46 + verticalDirection * height * .23 * (progress - .5);
    const pose = {x, y, time:now, cell:Math.floor(age / 25) % 16};
    const last = trail.at(-1);
    if (age < runTime && (!last || now - last.time >= 16)) trail.push(pose);

    while (trail.length && now - trail[0].time >= fadeTime) trail.shift();
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const opacity = (1 - (now - point.time) / fadeTime);
      if (i % 3 === 0 && now - point.time > 35) drawSprite(point, opacity * .20, size);
      const next = trail[i + 1];
      if (!next) continue;
      pen.beginPath();
      pen.moveTo(point.x, point.y);
      pen.lineTo((point.x + next.x) / 2, (point.y + next.y) / 2 + (i % 2 ? -5 : 5));
      pen.lineTo(next.x, next.y);
      pen.strokeStyle = 'rgba(255,62,42,' + opacity * .46 + ')';
      pen.lineWidth = 8;
      pen.stroke();
      pen.strokeStyle = 'rgba(255,199,64,' + opacity * .94 + ')';
      pen.lineWidth = 2.2;
      pen.stroke();
    }
    if (age < runTime) drawSprite(pose, 1, size);
    frame = requestAnimationFrame(paint);
  }

  function onScroll() {
    const position = feed.scrollTop;
    const delta = position - previousScroll;
    previousScroll = position;
    const now = performance.now();
    if (!delta || canvas.hidden || (!draggingScrollbar && now - lastInput > 1000)) return;
    if (frame) return;
    verticalDirection = Math.sign(delta);
    runStart = now;
    frame = requestAnimationFrame(paint);
  }

  sprite.addEventListener('load', () => { ready = true; enable(); });
  for (const event of ['wheel', 'touchstart', 'touchmove', 'keydown']) {
    feed.addEventListener(event, markInput, {passive:true});
  }
  feed.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.clientX >= feed.getBoundingClientRect().right - 16) {
      draggingScrollbar = true;
      markInput();
    }
  });
  for (const event of ['pointerup', 'pointercancel']) {
    window.addEventListener(event, () => { draggingScrollbar = false; });
  }
  feed.addEventListener('scroll', onScroll, {passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  reducedMotion.addEventListener('change', enable);
  if (window.worldWhenNear) window.worldWhenNear(feed, loadSprite);
  else loadSprite();
}
