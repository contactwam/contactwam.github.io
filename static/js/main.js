// Lazy clips, speed badges, TOC scroll-spy, lightbox. Plain ES module, no dependencies.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduced) document.documentElement.classList.add('reduced');

/* ---------- lazy clips ---------- */
const clips = $$('video[data-src]');
const userPaused = new WeakSet();
const setPP = (video, playing) => {
  const b = $('.pp', video.parentElement);
  if (!b) return;
  b.textContent = playing ? '❚❚' : '▶';
  b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
};
clips.forEach(v => {
  v.addEventListener('play', () => setPP(v, true));
  v.addEventListener('pause', () => setPP(v, false));
  const b = $('.pp', v.parentElement);
  if (b) b.addEventListener('click', () => {
    if (v.paused) { userPaused.delete(v); v.play().catch(() => {}); }
    else { userPaused.add(v); v.pause(); }
  });
  if (reduced) v.controls = true;
});
const loadObs = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const v = e.target;
    if (!v.getAttribute('src')) { v.src = v.dataset.src; v.preload = 'auto'; }
    loadObs.unobserve(v);
  }
}, { rootMargin: '300px' });
const playObs = new IntersectionObserver(entries => {
  if (reduced) return;
  for (const e of entries) {
    const v = e.target;
    if (e.isIntersecting && e.intersectionRatio >= 0.25) {
      if (v.getAttribute('src') && !userPaused.has(v)) v.play().catch(() => {});
    } else v.pause();
  }
}, { threshold: [0, 0.25, 0.5] });
clips.forEach(v => { loadObs.observe(v); playObs.observe(v); });

/* ---------- speed badges ---------- */
clips.forEach(v => {
  const b = $('[data-badge]', v.parentElement);
  if (b && v.dataset.fixedSpeed) { b.textContent = v.dataset.fixedSpeed; b.hidden = false; }
});

/* ---------- TOC scroll-spy ---------- */
const toc = $('#toc');
const tabs = $$('a', toc);
const secs = tabs.map(a => $(a.getAttribute('href')));
const setTocH = () => document.documentElement.style.setProperty('--toc-h', toc.offsetHeight + 'px');
setTocH(); addEventListener('resize', setTocH);
const spy = () => {
  let cur = null;
  const line = toc.offsetHeight + innerHeight * 0.25;
  for (const s of secs) if (s.getBoundingClientRect().top < line) cur = s;
  tabs.forEach(a => {
    const on = !!cur && a.getAttribute('href') === '#' + cur.id;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  const act = $('a.active', toc.firstElementChild);
  if (act) { const c = toc.firstElementChild, l = act.offsetLeft - 16; if (c.scrollWidth > c.clientWidth) c.scrollLeft = l - (c.clientWidth - act.offsetWidth) / 2; }
};
addEventListener('scroll', spy, { passive: true }); spy();
if (reduced) document.documentElement.style.scrollBehavior = 'auto';

/* ---------- lightbox ---------- */
const lb = $('#lightbox'), lbImg = $('img', lb), lbClose = $('.lb-close', lb);
let lastTrigger = null;
$$('[data-zoom]').forEach(btn => btn.addEventListener('click', () => {
  lastTrigger = btn;
  lbImg.src = btn.dataset.zoom;
  lbImg.alt = $('img', btn)?.alt || '';
  lb.showModal();
  lbClose.focus();
}));
lbClose.addEventListener('click', () => lb.close());
lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
lb.addEventListener('close', () => { lbImg.removeAttribute('src'); lastTrigger?.focus(); });

/* ---------- main video: clean poster + centered play button ---------- */
{
  const mv = $('.main-video video'), btn = $('.main-video .mv-play');
  if (mv && btn) {
    const start = () => {
      btn.hidden = true;
      mv.controls = true;
      const p = mv.play();
      if (p && p.catch) p.catch(() => {});
      mv.focus({ preventScroll: true });
    };
    mv.controls = false;
    btn.hidden = false;
    btn.addEventListener('click', start);
    mv.addEventListener('click', () => { if (!mv.controls) start(); });
    mv.addEventListener('play', () => { if (!mv.controls) { mv.controls = true; btn.hidden = true; } });
  }
}
