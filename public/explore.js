// Explore: the day's topics under the box, drawn as cards.
//
// A card is a topic, never a destination of its own. Its link is the
// visitor's current prompt with the topic in the slot, opened in that prompt's
// engine, so switching prompts re-aims every card. Links are real <a href>s,
// which keeps middle-click, ⌘-click and "copy link" working. When the prompt
// has more than one blank a topic cannot finish it, so the card fills the
// first box instead.
//
// There are no images. Each card gets a cover drawn from its category (orbits
// for science, strata for history, …), varied by a seed from the topic so no
// two look alike, with the card's one striking figure set large on top.

import { categoryById, ORIGINS } from './categories.js?v=d45deaf580';

// Three rows to start (the wide lead card, then three and three); each
// "Show more" adds two rows under them.
const FIRST = 8;
const STEP = 6;
const DISMISSED_KEY = 'tmea:explore-dismissed';
const MAX_DISMISSED = 300;

export function createExplore({ root, link, fill, preview, clearPreview, launched, interests, recent }) {
  const cardsEl = root.querySelector('.cards');
  const recentEl = root.querySelector('.recent');
  const dateEl = root.querySelector('.explore-date');
  const footEl = root.querySelector('.explore-foot');
  const moreBtn = root.querySelector('.explore-more');
  let feed = null;
  let count = FIRST;
  let shown = [];

  // Topics the visitor likes come first and the rest follow, so a narrow
  // choice on a thin day still fills the shelf.
  function pool() {
    if (!feed) return [];
    const dismissed = readDismissed();
    const all = feed.cards.filter(c => !dismissed.has(c.id));
    const want = new Set(interests());
    if (!want.size) return all;
    return [...all.filter(c => want.has(c.category)), ...all.filter(c => !want.has(c.category))];
  }

  let lastInterests = '';
  function render() {
    renderRecent();
    if (!feed) { renderSkeleton(); return; }
    const key = interests().join();
    if (key !== lastInterests) { lastInterests = key; count = FIRST; }
    const list = pool();
    shown = list.slice(0, count);
    cardsEl.innerHTML = '';
    cardsEl.removeAttribute('aria-busy');
    shown.forEach((c, i) => cardsEl.appendChild(cardEl(c, i === 0)));
    moreBtn.hidden = list.length <= shown.length;
    dateEl.textContent = feed.source === 'daily' ? formatDay(feed.day) : '';
    footEl.textContent = feed.source === 'daily'
      ? 'Chosen this morning by Claude from Wikipedia and Hacker News. Each card opens with the prompt you have selected above.'
      : 'A few timeless places to start. Each card opens with the prompt you have selected above.';
  }

  function renderSkeleton() {
    cardsEl.innerHTML = '';
    cardsEl.setAttribute('aria-busy', 'true');
    for (let i = 0; i < FIRST; i++) {
      const s = document.createElement('div');
      s.className = 'card skeleton' + (i === 0 ? ' feature' : '');
      s.innerHTML = '<div class="cover"></div><div class="card-body"><span class="bar w40"></span><span class="bar w80"></span><span class="bar w60"></span></div>';
      cardsEl.appendChild(s);
    }
    moreBtn.hidden = true;
  }

  function renderRecent() {
    const items = recent();
    recentEl.innerHTML = '';
    recentEl.hidden = !items.length;
    if (!items.length) return;
    const label = document.createElement('span');
    label.className = 'recent-label';
    label.textContent = 'Pick up where you left off';
    recentEl.appendChild(label);
    for (const topic of items) {
      const a = document.createElement('a');
      a.className = 'recent-chip';
      a.dataset.kind = 'recent';
      a.dataset.text = topic;
      a.textContent = topic;
      aim(a);
      recentEl.appendChild(a);
    }
  }

  function cardEl(c, feature) {
    const cat = categoryById(c.category);
    const el = document.createElement('article');
    el.className = 'card' + (feature ? ' feature' : '');
    el.style.setProperty('--h', cat.hue);
    el.dataset.id = c.id;

    const main = document.createElement('a');
    main.className = 'card-link';
    main.dataset.kind = 'card';
    main.dataset.text = c.topic;
    aim(main);

    const cover = document.createElement('div');
    cover.className = 'cover' + (c.figure ? ' has-figure' : '');
    cover.setAttribute('aria-hidden', 'true');
    cover.innerHTML = motif(c.category, c.topic);
    if (c.figure) {
      const fig = document.createElement('div');
      fig.className = 'figure';
      const n = document.createElement('span');
      n.className = 'figure-n';
      n.textContent = c.figure;
      fig.appendChild(n);
      if (c.figureLabel) {
        const l = document.createElement('span');
        l.className = 'figure-l';
        l.textContent = c.figureLabel;
        fig.appendChild(l);
      }
      cover.appendChild(fig);
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const kicker = document.createElement('span');
    kicker.className = 'kicker';
    kicker.textContent = cat.name + (ORIGINS[c.origin] && c.origin !== 'timeless' ? ` · ${ORIGINS[c.origin]}` : '');
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = c.topic;
    const hook = document.createElement('p');
    hook.className = 'card-hook';
    hook.textContent = c.hook;
    body.append(kicker, title, hook);
    main.append(cover, body);
    el.appendChild(main);

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    if (c.angle) {
      const q = document.createElement('a');
      q.className = 'angle';
      q.dataset.kind = 'angle';
      q.dataset.text = c.angle;
      q.dataset.topic = c.topic;
      q.textContent = c.angle;
      aim(q);
      foot.appendChild(q);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'dismiss';
    x.title = 'Not interested';
    x.setAttribute('aria-label', `Not interested in ${c.topic}`);
    x.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    x.addEventListener('click', () => dismiss(c.id, el));
    foot.appendChild(x);
    el.appendChild(foot);
    return el;
  }

  function aim(a) {
    const { href, target, fill: fills } = link(a.dataset.text, a.dataset.kind);
    a.href = fills ? '#ask' : href;
    a.toggleAttribute('data-fill', !!fills);
    if (target && !fills) { a.target = target; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }

  function dismiss(id, el) {
    const d = readDismissed();
    d.add(id);
    writeDismissed(d);
    clearPreview();
    el.classList.add('leaving');
    setTimeout(render, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
  }

  // Preview: hovering or focusing anything aimable writes it into the sentence.
  let previewing = null;
  const over = e => {
    const a = e.target.closest?.('a[data-kind]');
    if (!a || !root.contains(a)) return;
    previewing = a;
    preview(a.dataset.kind === 'angle' ? 'question' : 'topic', a.dataset.text);
  };
  const out = e => {
    if (!previewing) return;
    const to = e.relatedTarget;
    if (to && previewing.contains(to)) return;
    previewing = null;
    clearPreview();
  };
  root.addEventListener('pointerover', over);
  root.addEventListener('focusin', over);
  root.addEventListener('pointerout', out);
  root.addEventListener('focusout', out);

  root.addEventListener('click', e => {
    const a = e.target.closest('a[data-kind]');
    if (!a) return;
    if (a.hasAttribute('data-fill')) { e.preventDefault(); fill(a.dataset.topic || a.dataset.text); return; }
    launched(a.dataset.kind, a.dataset.topic || a.dataset.text, e);
  });
  root.addEventListener('auxclick', e => {
    const a = e.target.closest('a[data-kind]');
    if (a && e.button === 1 && !a.hasAttribute('data-fill')) launched(a.dataset.kind, a.dataset.topic || a.dataset.text, e);
  });

  // Adds cards under the ones already there; nothing above moves.
  moreBtn.addEventListener('click', () => {
    const before = shown.length;
    count = before + STEP;
    render();
    const added = [...cardsEl.children].slice(before);
    added.forEach((el, i) => { el.classList.add('arriving'); el.style.animationDelay = `${i * 40}ms`; });
    added[0]?.querySelector('.card-link')?.focus({ preventScroll: true });
    added[0]?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });

  return {
    setFeed(next) {
      const changed = !feed || next.day !== feed.day || next.cards.length !== feed.cards.length || next.cards.some((c, i) => c.id !== feed.cards[i]?.id);
      feed = next;
      if (changed) { count = FIRST; render(); }
    },
    render,
    // Re-aim every link after the prompt or engine changes, without rebuilding.
    reaim() { root.querySelectorAll('a[data-kind]').forEach(aim); },
    topics: () => shown.map(c => c.topic),
    hasFeed: () => !!feed,
  };
}

function readDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
}
function writeDismissed(set) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-MAX_DISMISSED))); } catch { /* private mode */ }
}

function formatDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// ---------- covers ----------

const W = 320, H = 180;

export function motif(category, seedText) {
  const draw = MOTIFS[category] || MOTIFS.ideas;
  const r = rng(hash(`${category}:${seedText}`));
  return `<svg class="motif" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${draw(r)}</svg>`;
}

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32: small, fast, and the same picture for the same topic everywhere.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = n => n.toFixed(1);

// Each motif leans right, so the figure on the left stays legible.
const MOTIFS = {
  science(r) {
    const cx = W * (0.62 + r() * 0.3), cy = H * (0.25 + r() * 0.45), tilt = f(-35 + r() * 70);
    let s = '';
    for (let i = 0; i < 5; i++) {
      const rx = 34 + i * 34 + r() * 10, ry = rx * (0.3 + r() * 0.12), a = r() * Math.PI * 2;
      s += `<g transform="rotate(${tilt} ${f(cx)} ${f(cy)})"><ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="none" stroke="currentColor" stroke-width="1" opacity="${f(0.6 - i * 0.08)}"/>`
        + `<circle cx="${f(cx + rx * Math.cos(a))}" cy="${f(cy + ry * Math.sin(a))}" r="${f(2 + r() * 3.5)}" fill="currentColor"/></g>`;
    }
    return s + `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(9 + r() * 7)}" fill="currentColor" opacity=".85"/>`;
  },
  history(r) {
    const amp = 4 + r() * 9, fr = 0.008 + r() * 0.012, ph = r() * 6;
    let s = '', y = 6 + r() * 10;
    while (y < H + 10) {
      let d = '';
      for (let x = 0; x <= W; x += 10) d += `${x ? 'L' : 'M'}${x} ${f(y + Math.sin(x * fr + ph + y * 0.04) * amp)}`;
      s += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${r() < 0.2 ? 2.2 : 1}" opacity="${f(0.25 + r() * 0.45)}"/>`;
      y += 6 + r() * 13;
    }
    return s;
  },
  technology(r) {
    const g = 20;
    let s = '';
    for (let x = g / 2; x < W; x += g) for (let y = g / 2; y < H; y += g) s += `<circle cx="${x}" cy="${y}" r="1" fill="currentColor" opacity=".3"/>`;
    for (let i = 0; i < 7; i++) {
      let x = g / 2 + Math.floor((0.35 + r() * 0.65) * W / g) * g, y = g / 2 + Math.floor(r() * H / g) * g;
      let d = `M${x} ${y}`;
      s += `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="currentColor" opacity=".8"/>`;
      for (let k = 0; k < 4; k++) {
        if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * g * (1 + Math.floor(r() * 4));
        else y += (r() < 0.5 ? -1 : 1) * g * (1 + Math.floor(r() * 3));
        d += ` L${x} ${y}`;
      }
      s += `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity=".7"/><circle cx="${x}" cy="${y}" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
    }
    return s;
  },
  nature(r) {
    const cx = W * (0.6 + r() * 0.35), cy = H * (0.25 + r() * 0.55);
    const k1 = 2 + Math.floor(r() * 3), k2 = 3 + Math.floor(r() * 3), p1 = r() * 6, p2 = r() * 6;
    let s = '';
    for (let i = 1; i <= 10; i++) {
      const R = i * 15;
      let d = '';
      for (let a = 0; a <= 72; a++) {
        const t = a / 72 * Math.PI * 2;
        const rr = R * (1 + 0.13 * Math.sin(k1 * t + p1) + 0.07 * Math.sin(k2 * t + p2 + i * 0.35));
        d += `${a ? 'L' : 'M'}${f(cx + rr * Math.cos(t))} ${f(cy + rr * Math.sin(t) * 0.78)}`;
      }
      s += `<path d="${d}Z" fill="none" stroke="currentColor" stroke-width="1" opacity="${f(0.65 - i * 0.045)}"/>`;
    }
    return s;
  },
  culture(r) {
    let s = '';
    for (let i = 0; i < 4; i++) s += `<circle cx="${f(W * (0.4 + r() * 0.6))}" cy="${f(H * r())}" r="${f(34 + r() * 70)}" fill="currentColor" opacity="${f(0.1 + r() * 0.16)}"/>`;
    s += `<circle cx="${f(W * (0.55 + r() * 0.35))}" cy="${f(H * (0.25 + r() * 0.5))}" r="${f(14 + r() * 22)}" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".75"/>`;
    const y = f(H * (0.2 + r() * 0.6));
    return s + `<line x1="${f(W * 0.45)}" y1="${y}" x2="${W}" y2="${y}" stroke="currentColor" stroke-width="1" opacity=".45"/>`;
  },
  society(r) {
    const n = 16 + Math.floor(r() * 8), w = W / n;
    let s = '';
    for (let i = 0; i < n; i++) {
      const h = H * (0.12 + r() * 0.55) * (0.35 + i / n);
      s += `<rect x="${f(i * w + 1)}" y="${f(H - h)}" width="${f(w - 3)}" height="${f(h)}" rx="1" fill="currentColor" opacity="${f(0.12 + r() * 0.3)}"/>`;
    }
    return s;
  },
  ideas(r) {
    const cx = W * (0.62 + r() * 0.3), cy = H * (0.2 + r() * 0.45), n = 32;
    let s = '';
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + r() * 0.06, r1 = 14 + r() * 8, r2 = 50 + r() * 150;
      s += `<line x1="${f(cx + r1 * Math.cos(a))}" y1="${f(cy + r1 * Math.sin(a))}" x2="${f(cx + r2 * Math.cos(a))}" y2="${f(cy + r2 * Math.sin(a))}" stroke="currentColor" stroke-width="1" opacity="${f(0.2 + r() * 0.5)}"/>`;
    }
    return s + `<circle cx="${f(cx)}" cy="${f(cy)}" r="6" fill="currentColor"/>`;
  },
  sport(r) {
    const cx = W * (0.8 + r() * 0.3), cy = H * (1.05 + r() * 0.3);
    let s = '';
    for (let i = 0; i < 9; i++) {
      s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${70 + i * 20}" fill="none" stroke="currentColor" stroke-width="${i % 3 === 0 ? 2 : 1}" opacity="${f(0.62 - i * 0.05)}"${i === 4 ? ' stroke-dasharray="7 7"' : ''}/>`;
    }
    return s;
  },
};

