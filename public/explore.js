// Explore: the day's topics under the box, drawn as cards.
//
// A card is a topic, never a destination of its own. Its link is the
// visitor's current prompt with the topic in the slot, opened in that prompt's
// engine, so switching prompts re-aims every card. Links are real <a href>s,
// which keeps middle-click, ⌘-click and "copy link" working. When the prompt
// has more than one blank a topic cannot finish it, so the card fills the
// first box instead.
//
// Which cards, in what order, is decided here in the browser from the
// visitor's preferences (interests.js?v=ce4a88d427). Feedback hides or nudges without
// reshuffling what is on screen: the order is fixed until the visitor picks
// another pill or comes back later.
//
// There are no images. Each card gets a cover drawn from its category (orbits
// for science, strata for history, …), varied by a seed from the topic so no
// two look alike, with the card's one striking figure set large on top.

import { CATEGORIES, categoryById, tagById, ORIGINS, KINDS, DEPTHS, isNews } from './categories.js?v=ce4a88d427';
import { rank, placeSponsored, visible, setCategory, setTag, topicsValue } from './interests.js?v=ce4a88d427';

// Three rows to start (the wide lead card, then three and three); each
// "Show more" adds two rows under them.
const FIRST = 8;
const STEP = 6;
const DISMISSED_KEY = 'tmea:explore-dismissed';
const MAX_DISMISSED = 300;
// Which cards this browser has shown, and on which day, so cards carried
// from earlier days appear only to browsers that have not had them yet.
const SEEN_KEY = 'tmea:explore-seen';
const SEEN_DAYS = 21;
const VIEWED_KEY = 'tmea:sponsored-viewed';

export function createExplore({ root, link, fill, preview, clearPreview, launched, prefs, updatePrefs, recent, report, saved, isSaved, toggleSave, tuneHref = '/settings#topics' }) {
  const cardsEl = root.querySelector('.cards');
  const recentEl = root.querySelector('.recent');
  const pillsEl = root.querySelector('.pills');
  const dateEl = root.querySelector('.explore-date');
  const footEl = root.querySelector('.explore-foot');
  const moreBtn = root.querySelector('.explore-more');
  const menu = document.createElement('div');
  menu.className = 'menu card-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.appendChild(menu);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  document.body.appendChild(toast);

  let feed = null;
  let count = FIRST;
  let shown = [];
  let pill = null;        // a category, 'news', 'saved', or null for "For you"
  let frozen = null;      // card ids in the order first shown

  // The day's list, chosen for this visitor.
  // The News pill is today's news across the visitor's topics.
  function ranked(category = pill) {
    if (!feed) return [];
    const opts = { dismissed: readDismissed(), seenBefore: seenBefore(feed.day) };
    if (category === 'news') return rank(feed.cards, prefs(), opts).filter(isNews);
    return rank(feed.cards, prefs(), { ...opts, category });
  }

  // The ranked list in the order already on screen: cards that are now hidden
  // drop out and the gap closes, newly eligible ones join at the end.
  function ordered() {
    if (pill === 'saved') return saved();
    const fresh = ranked();
    if (!frozen) { frozen = fresh.map(c => c.id); return fresh; }
    const byId = new Map(fresh.map(c => [c.id, c]));
    const kept = frozen.filter(id => byId.has(id)).map(id => byId.get(id));
    const known = new Set(frozen);
    const added = fresh.filter(c => !known.has(c.id));
    frozen = [...frozen, ...added.map(c => c.id)];
    return [...kept, ...added];
  }

  // Cards pinned in the card manager lead For you and their category,
  // unless the visitor has set them aside or hidden what they are about.
  function withPinned(list) {
    const p = prefs();
    const dismissed = readDismissed();
    const pins = (feed.pinned || []).filter(c => !dismissed.has(c.id) && visible(c, p) && (!pill || c.category === pill));
    if (!pins.length) return list;
    const ids = new Set(pins.map(c => c.id));
    return [...pins, ...list.filter(c => !ids.has(c.id))];
  }

  function refresh() {
    frozen = null;
    count = FIRST;
    render();
  }

  function render() {
    renderRecent();
    if (!feed) { renderSkeleton(); return; }
    renderPills();
    const list = pill === 'saved' ? ordered() : placeSponsored(withPinned(ordered()), feed.sponsored || [], prefs(), { dismissed: readDismissed(), category: pill });
    shown = list.slice(0, count);
    cardsEl.innerHTML = '';
    cardsEl.removeAttribute('aria-busy');
    shown.forEach((c, i) => cardsEl.appendChild(cardEl(c, i === 0)));
    measureFeature();
    if (!shown.length) {
      const empty = document.createElement('p');
      empty.className = 'explore-empty';
      if (pill === 'saved') {
        empty.textContent = 'Nothing saved yet. Use the bookmark on any card to keep it here.';
      } else {
        empty.append('Nothing here with your current choices. ');
        const a = document.createElement('a');
        a.href = tuneHref;
        a.textContent = 'Change what Explore shows';
        empty.append(a, '.');
      }
      cardsEl.appendChild(empty);
    }
    markSeen(shown.filter(c => !c.sponsored), feed.day);
    for (const c of shown) if (c.sponsored) reportOnce(c.id, feed.day);
    moreBtn.hidden = list.length <= shown.length;
    dateEl.textContent = feed.source === 'daily' ? formatDay(feed.day) : '';
    footEl.textContent = feed.source === 'daily'
      ? "Chosen this morning by Claude from Wikipedia, Hacker News, Reddit's Today I Learned and sources for each category, then ordered for you in this browser. Each card opens with the prompt you have selected above."
      : 'A few timeless places to start. Each card opens with the prompt you have selected above.';
  }

  // The lead card's question is pinned to the bottom of its column; tell
  // the words above how tall it is, now and whenever the width changes.
  let footWatch = null;
  function measureFeature() {
    footWatch?.disconnect();
    const card = cardsEl.querySelector('.card.feature:not(.skeleton)');
    const foot = card?.querySelector('.card-foot');
    if (!foot) return;
    const set = () => card.style.setProperty('--foot', `${Math.ceil(foot.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'function') {
      footWatch = new ResizeObserver(set);
      footWatch.observe(foot);
    }
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
    // Hold the pills' row open so the cards do not drop when the list lands.
    pillsEl.hidden = false;
    pillsEl.innerHTML = '';
    moreBtn.hidden = true;
  }

  // "For you", then each category that has something to show.
  function renderPills() {
    const p = prefs();
    const all = ranked(null);
    const cats = CATEGORIES.filter(c => p.categories.has(c.id) && all.some(x => x.category === c.id));
    const savedCount = saved().length;
    const hasNews = all.some(isNews);
    if (pill && pill !== 'saved' && !(pill === 'news' && hasNews) && !cats.some(c => c.id === pill)) pill = null;
    pillsEl.hidden = false;
    pillsEl.innerHTML = '';
    const make = (id, name, hue) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'topic-pill';
      b.textContent = name;
      if (hue !== undefined) b.style.setProperty('--h', hue);
      b.setAttribute('aria-pressed', String(pill === id));
      b.addEventListener('click', () => {
        if (pill === id) return;
        pill = id;
        refresh();
      });
      pillsEl.appendChild(b);
    };
    make(null, 'For you');
    if (hasNews) make('news', 'News');
    if (savedCount || pill === 'saved') make('saved', `Saved · ${savedCount}`);
    for (const c of cats) make(c.id, c.name, c.hue);
    const tune = document.createElement('a');
    tune.className = 'pill-tune';
    tune.href = tuneHref;
    tune.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>Tune';
    pillsEl.appendChild(tune);
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
    el.className = 'card' + (feature ? ' feature' : '') + (c.sponsored ? ' sponsored' : '');
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
    if (c.depth === 'deep') {
      const d = document.createElement('span');
      d.className = 'depth';
      d.textContent = DEPTHS.deep;
      cover.appendChild(d);
    }
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
    const second = c.pinned ? 'Editor’s pick' : KINDS[c.kind] || (c.origin !== 'timeless' ? ORIGINS[c.origin] : '');
    kicker.textContent = c.sponsored ? `Sponsored · ${c.sponsor}` : cat.name + (second ? ` · ${second}` : '');
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
    // A sponsor's own page, when it has one: a plain link, nothing added to it.
    if (c.sponsored && c.url) {
      const v = document.createElement('a');
      v.className = 'visit';
      v.href = c.url;
      v.target = '_blank';
      v.rel = 'sponsored noopener noreferrer';
      v.textContent = `Visit ${c.sponsor} ↗`;
      v.addEventListener('click', () => report?.(c.id, 'click'));
      foot.appendChild(v);
    }
    if (!c.sponsored) {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'card-save';
      keep.innerHTML = '<svg width="13" height="14" viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h14v20l-7-5-7 5z"/></svg>';
      paintSave(keep, c);
      keep.addEventListener('click', e => { e.stopPropagation(); toggle(c); });
      foot.appendChild(keep);
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'card-more';
    more.title = 'More or less like this';
    more.setAttribute('aria-label', `Options for ${c.topic}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    more.addEventListener('click', e => { e.stopPropagation(); menu.hidden || menuFor !== c.id ? openMenu(c, more) : closeMenu(); });
    foot.appendChild(more);
    el.appendChild(foot);
    return el;
  }

  function paintSave(button, c) {
    const on = isSaved(c.id);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? `Remove ${c.topic} from saved` : `Save ${c.topic}`);
    button.title = on ? 'Saved' : 'Save';
  }

  // Save or unsave.
  function toggle(c) {
    const was = isSaved(c.id);
    const result = toggleSave(c);
    if (result === 'full') { say('That is the most saved cards there can be. Remove some under Saved first.'); return; }
    const btn = cardsEl.querySelector(`[data-id="${CSS.escape(c.id)}"] .card-save`);
    if (btn) paintSave(btn, c);
    const undo = () => {
      toggleSave(c);
      render();
    };
    if (was && pill === 'saved') leave(() => cardsEl.querySelector(`[data-id="${CSS.escape(c.id)}"]`));
    else renderPills();
    say(result === 'saved' ? 'Saved. Find it under Saved, here and on every browser you sign in on.' : 'Removed from saved.', undo);
  }

  function aim(a) {
    const { href, target, fill: fills } = link(a.dataset.text, a.dataset.kind);
    a.href = fills ? '#ask' : href;
    a.toggleAttribute('data-fill', !!fills);
    if (target && !fills) { a.target = target; a.rel = 'noopener'; } else { a.removeAttribute('target'); a.removeAttribute('rel'); }
  }

  // ---------- feedback ----------

  let menuFor = null;
  let menuButton = null;

  function openMenu(c, button) {
    closeMenu();
    menuFor = c.id;
    menuButton = button;
    button.setAttribute('aria-expanded', 'true');
    menu.innerHTML = '';
    const cat = categoryById(c.category);
    const tags = (c.tags || []).map(tagById).filter(Boolean);
    const item = (label, run, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.className = cls;
      b.innerHTML = '<span class="name"></span>';
      b.querySelector('.name').textContent = label;
      b.addEventListener('click', () => { closeMenu(); run(); });
      menu.appendChild(b);
    };
    const sep = () => { const d = document.createElement('div'); d.className = 'menu-sep'; menu.appendChild(d); };
    if (c.sponsored) {
      item('Not interested in this one', () => dismissCard(c, 'Set aside.'));
      item('Why am I seeing this?', () => say(`Sponsored by ${c.sponsor}. This browser picked it because it fits the topics you follow; nothing about you was sent to us or to ${c.sponsor}.`));
      placeMenu(button);
      return;
    }
    item(isSaved(c.id) ? 'Remove from saved' : 'Save', () => toggle(c));
    item('Not interested in this one', () => dismissCard(c, 'Set aside.'));
    sep();
    const ticked = prefs().tags;
    for (const t of tags) if (ticked.has(t.id)) item(`Hide ${t.name}`, () => hideTag(t));
    item(`Hide all of ${cat.name}`, () => hideCategory(cat));
    sep();
    const a = document.createElement('a');
    a.href = tuneHref;
    a.setAttribute('role', 'menuitem');
    a.className = 'menu-link';
    a.textContent = 'Choose topics…';
    menu.appendChild(a);
    placeMenu(button);
  }

  function placeMenu(button) {
    const r = button.getBoundingClientRect();
    menu.hidden = false;
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(window.scrollX + r.right - w, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
    menu.style.top = `${window.scrollY + r.bottom + 6}px`;
    menu.querySelector('button')?.focus();
    setTimeout(() => document.addEventListener('click', outside), 0);
  }

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside);
    menuFor = null;
  }
  function outside(e) {
    if (!menu.contains(e.target)) closeMenu();
  }
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); const b = menuButton; closeMenu(); b?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });

  function dismissCard(c, message, alsoUndo) {
    const d = readDismissed();
    d.add(c.id);
    writeDismissed(d);
    leave(() => cardsEl.querySelector(`[data-id="${CSS.escape(c.id)}"]`));
    say(message, () => {
      const u = readDismissed();
      u.delete(c.id);
      writeDismissed(u);
      alsoUndo?.();
      render();
    });
  }

  // Hiding from a card is the same as unticking in Topics, with an undo.
  function hideTag(t) {
    const before = prefs();
    updatePrefs({ topics: topicsValue(setTag(before, t.id, false)) });
    leave(() => [...cardsEl.querySelectorAll('.card')].filter(el => !shownStill(el.dataset.id)));
    say(`Hiding ${t.name}. Change it any time in Topics.`, () => { updatePrefs({ topics: topicsValue(before) }); render(); });
  }

  function hideCategory(cat) {
    const before = prefs();
    updatePrefs({ topics: topicsValue(setCategory(before, cat.id, false)) });
    leave(() => [...cardsEl.querySelectorAll('.card')].filter(el => !shownStill(el.dataset.id)));
    say(`Hiding ${cat.name}. Change it any time in Topics.`, () => { updatePrefs({ topics: topicsValue(before) }); render(); });
  }

  function shownStill(id) {
    const c = [...(feed?.cards || []), ...(feed?.pinned || [])].find(x => x.id === id);
    return !c || visible(c, prefs());
  }

  // Fade out what is going, then close the gaps.
  function leave(pick) {
    clearPreview();
    const els = [].concat(pick() || []);
    for (const el of els) el.classList.add('leaving');
    setTimeout(render, matchMedia('(prefers-reduced-motion: reduce)').matches || !els.length ? 0 : 180);
  }

  let toastTimer = null;
  function say(message, undo) {
    clearTimeout(toastTimer);
    toast.innerHTML = '<span class="toast-text"></span>';
    toast.querySelector('.toast-text').textContent = message;
    if (undo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-undo';
      b.textContent = 'Undo';
      b.addEventListener('click', () => { undo(); hideToast(); });
      toast.appendChild(b);
    }
    toast.hidden = false;
    toast.classList.remove('out');
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    toast.classList.add('out');
    setTimeout(() => { toast.hidden = true; }, 200);
  }

  // ---------- previews and launching ----------

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
    const card = a.closest('.card.sponsored');
    if (card) report?.(card.dataset.id, 'click');
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

  // A sponsored card's view is counted once a day per browser, by card only.
  function reportOnce(id, day) {
    let viewed = {};
    try { viewed = JSON.parse(localStorage.getItem(VIEWED_KEY) || '{}') || {}; } catch { /* ignore */ }
    if (viewed[id] === day) return;
    for (const k of Object.keys(viewed)) if (viewed[k] !== day) delete viewed[k];
    viewed[id] = day;
    try { localStorage.setItem(VIEWED_KEY, JSON.stringify(viewed)); } catch { /* ignore */ }
    report?.(id, 'view');
  }

  return {
    setFeed(next) {
      const ids = f => [...f.cards, ...(f.sponsored || []), ...(f.pinned || [])].map(c => `${c.id}:${c.topic}:${c.hook}:${c.figure}`).join('|');
      const changed = !feed || next.day !== feed.day || ids(next) !== ids(feed);
      feed = next;
      if (changed) refresh();
    },
    render,
    // Preferences changed somewhere else (settings page, another browser).
    refresh,
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

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function seenBefore(day) {
  const seen = readSeen();
  return new Set(Object.keys(seen).filter(id => seen[id] < day));
}
function markSeen(cards, day) {
  const seen = readSeen();
  const cutoff = new Date(Date.parse(`${day}T00:00:00Z`) - SEEN_DAYS * 86400_000).toISOString().slice(0, 10);
  let changed = false;
  for (const id of Object.keys(seen)) if (seen[id] < cutoff) { delete seen[id]; changed = true; }
  for (const c of cards) if (!seen[c.id]) { seen[c.id] = day; changed = true; }
  if (changed) try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* private mode */ }
}

// Forget what this browser set aside and has seen (settings: reset).
export function forgetLocal() {
  try { localStorage.removeItem(DISMISSED_KEY); localStorage.removeItem(SEEN_KEY); } catch { /* ignore */ }
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

