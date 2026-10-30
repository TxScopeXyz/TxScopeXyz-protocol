// Motion toolkit: damped-spring solver, scroll reveal, parallax, spotlight, progress, count-up.
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

const live = new Set();
let raf = 0;
let last = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  for (const s of [...live]) {
    s.advance(dt);
    s.onUpdate && s.onUpdate(s.x);
    if (s.settled()) {
      s.x = s.t;
      s.v = 0;
      s.onUpdate && s.onUpdate(s.x);
      live.delete(s);
      s.onDone && s.onDone();
    }
  }
  raf = live.size ? requestAnimationFrame(frame) : 0;
}

// Damped harmonic oscillator, semi-implicit Euler with sub-stepping.
export class Spring {
  constructor(x = 0, { k = 170, c = 24, m = 1, onUpdate, onDone } = {}) {
    Object.assign(this, { x, t: x, v: 0, k, c, m, onUpdate, onDone });
  }
  to(t) {
    this.t = t;
    if (reduced()) {
      this.x = t;
      this.v = 0;
      this.onUpdate && this.onUpdate(t);
      this.onDone && this.onDone();
      return;
    }
    live.add(this);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  advance(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = (-this.k * (this.x - this.t) - this.c * this.v) / this.m;
      this.v += a * h;
      this.x += this.v * h;
    }
  }
  settled() {
    return Math.abs(this.v) < 0.002 && Math.abs(this.x - this.t) < 0.002;
  }
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const RISE = 28;
const STAGGER = 70;

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => {
    el.style.transform = '';
    el.style.opacity = '';
    el.classList.add('is-in');
  };
  if (reduced() || !('IntersectionObserver' in window)) {
    els.forEach(show);
    return;
  }
  // index inside its stagger group (or its parent) decides the delay
  const delayOf = (el) => {
    const group = el.closest('[data-stagger]');
    if (!group) return 0;
    return [...group.querySelectorAll('[data-reveal]')].indexOf(el) * STAGGER;
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target;
        const sp = new Spring(RISE, {
          k: 150,
          c: 17,
          onUpdate: (y) => {
            el.style.transform = `translate3d(0,${y.toFixed(2)}px,0)`;
            el.style.opacity = String(clamp(1 - Math.max(0, y) / RISE));
          },
          onDone: () => show(el)
        });
        el.style.opacity = '0';
        el.style.transform = `translate3d(0,${RISE}px,0)`;
        setTimeout(() => sp.to(0), delayOf(el));
        el.classList.add('is-in-start');
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  els.forEach((el) => io.observe(el));
}

export function initProgress() {
  const bar = document.querySelector('[data-progress]');
  if (!bar) return;
  const sp = new Spring(0, { k: 260, c: 30, onUpdate: (v) => (bar.style.transform = `scaleX(${clamp(v)})`) });
  const read = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    sp.to(max > 0 ? scrollY / max : 0);
  };
  addEventListener('scroll', read, { passive: true });
  addEventListener('resize', read);
  read();
}

export function initParallax() {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;
  const layers = [...document.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) }));
  const px = new Spring(0, { k: 60, c: 14, onUpdate: apply });
  const py = new Spring(0, { k: 60, c: 14, onUpdate: apply });
  function apply() {
    if (reduced()) return;
    const sy = scrollY;
    for (const { el, d } of layers) {
      const y = py.x * d * 34 - sy * d * 0.1;
      el.style.transform = `translate3d(${(px.x * d * 34).toFixed(2)}px,${y.toFixed(2)}px,0)`;
    }
  }
  addEventListener('pointermove', (e) => {
    if (reduced() || e.pointerType === 'touch') return;
    px.to(e.clientX / innerWidth - 0.5);
    py.to(e.clientY / innerHeight - 0.5);
  }, { passive: true });
  addEventListener('scroll', apply, { passive: true });
  apply();
}

export function initSpotlight() {
  if (!matchMedia('(hover: hover)').matches) return;
  document.addEventListener('pointermove', (e) => {
    if (reduced()) return;
    const el = e.target.closest && e.target.closest('[data-spot]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// Count a numeric element toward a new value; flash when it changes after first paint.
export function setNumber(el, to, fmt, { flash = true, dur = 700 } = {}) {
  const from = el._n;
  el._n = to;
  if (from === to) return;
  const write = (v) => (el.textContent = fmt(v));
  if (reduced() || typeof to !== 'number') {
    write(to);
    return;
  }
  const start = typeof from === 'number' ? from : 0;
  if (typeof from === 'number' && flash) {
    const cls = to > from ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(cls);
  }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const tick = (now) => {
    const p = clamp((now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    write(start + (to - start) * e);
    if (p < 1) el._raf = requestAnimationFrame(tick);
    else write(to);
  };
  el._raf = requestAnimationFrame(tick);
}
