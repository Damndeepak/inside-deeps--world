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
  const coastTime = 110;
  let frame = 0, ready = false, previousScroll = feed.scrollTop;
  let lastInput = -Infinity, lastMove = -Infinity, lastFrame = 0;
  let y = 0, speed = 0, stride = 0, direction = -1, rightEdge = true, draggingScrollbar = false;

  function enable() {
    canvas.hidden = reducedMotion.matches || !ready;
    wrapper.classList.toggle('has-chat-flash', !canvas.hidden);
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
    speed = 0;
    lastMove = -Infinity;
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
    pen.scale(pose.direction, 1);
    pen.rotate(.08);
    pen.drawImage(sprite, (cell % 8) * 128, Math.floor(cell / 8) * 150, 128, 150,
      -size * 0.5, -size * 0.59, size, size * 150 / 128);
    pen.restore();
  }

  function paint(now) {
    frame = 0;
    if (canvas.hidden || document.hidden) return clear();
    const elapsed = Math.min(32, now - lastFrame);
    const age = now - lastMove;
    lastFrame = now;
    const width = wrapper.clientWidth, height = feed.clientHeight;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    pen.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.clearRect(0, 0, width, height);
    if (age >= fadeTime || height < 75) return clear();

    const size = width < 450 ? 34 : 48;
    const edge = width < 450 ? 15 : 23;
    const x = rightEdge ? width - edge : edge;
    const margin = size * .56;
    const fade = 1 - Math.max(0, age - coastTime) / (fadeTime - coastTime);
    if (age < coastTime) {
      y += direction * speed * elapsed;
      if (y < margin || y > height - margin) {
        y = direction < 0 ? height - margin : margin;
        trail.length = 0;
      }
      stride += elapsed * Math.min(.042, .019 + .009 * speed);
      const last = trail.at(-1);
      if (!last || now - last.time >= 19) {
        trail.push({x, y, direction, time:now, cell:Math.floor(stride) % 16});
      }
    }
    while (trail.length && now - trail[0].time >= fadeTime) trail.shift();
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      const opacity = (1 - (now - point.time) / fadeTime) * fade;
      if (i % 3 === 0 && now - point.time > 35) drawSprite(point, opacity * .20, size);
      const next = trail[i + 1];
      if (!next) continue;
      pen.beginPath();
      pen.moveTo(point.x, point.y);
      pen.lineTo(point.x + (i % 2 ? -4 : 4), (point.y + next.y) / 2);
      pen.lineTo(next.x, next.y);
      pen.strokeStyle = 'rgba(255,62,42,' + opacity * .46 + ')';
      pen.lineWidth = 8;
      pen.stroke();
      pen.strokeStyle = 'rgba(255,199,64,' + opacity * .94 + ')';
      pen.lineWidth = 2.2;
      pen.stroke();
    }
    drawSprite({x, y, direction, cell:Math.floor(stride) % 16}, fade, size);
    frame = requestAnimationFrame(paint);
  }

  function onScroll() {
    const position = feed.scrollTop;
    const delta = position - previousScroll;
    previousScroll = position;
    const now = performance.now();
    if (!delta || canvas.hidden || (!draggingScrollbar && now - lastInput > 1000)) return;
    direction = Math.sign(delta);
    const gap = now - lastMove;
    if (gap >= fadeTime) {
      rightEdge = !rightEdge;
      y = direction < 0 ? feed.clientHeight - 38 : 38;
      trail.length = 0;
    }
    speed = Math.max(.25, Math.min(2.1, Math.abs(delta) / Math.max(12, gap >= fadeTime ? 16 : gap)));
    lastMove = now;
    if (!frame) {
      lastFrame = now;
      frame = requestAnimationFrame(paint);
    }
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
