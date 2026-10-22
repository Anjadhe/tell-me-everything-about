// Tell me everything about — the home page: a sentence to finish.
//
// State, sync and the account live in store.js?v=d45deaf580, shared with the prompts
// page (/prompts) where prompts are written and settings are kept. This page
// draws the selected prompt as a sentence with a box for each blank, launches
// it, and shows Explore under it.

import * as store from './store.js?v=d45deaf580';
import { ENGINES, engineById } from './engines.js?v=d45deaf580';
import { parse, fill, defaultLabel } from './template.js?v=d45deaf580';
import { buildSentence, wireSentence, valuesOf } from './sentence.js?v=d45deaf580';
import { createExplore } from './explore.js?v=d45deaf580';

const FEED_KEY = 'tmea:explore-feed';
const FEED_FRESH_MS = 30 * 60 * 1000;

const $ = s => document.querySelector(s);
const tabsEl = $('#prompt-tabs');
const sentenceEl = $('#sentence');
const wholeEl = $('#whole');
const engineBtn = $('#engine-btn');
const engineName = $('#engine-name');
const engineMenu = $('#engine-menu');
const editLink = $('#edit-prompt');
const footNote = $('#foot-note');
const syncDot = $('#sync-dot');
const hintTake = $('#hint-take');

let selectedId = store.selectedId();
let inputs = [];
// What has been typed, by blank name, so switching prompts keeps it; the
// first box also carries over by position (a topic is a topic).
const typed = {};
let firstTyped = '';

// True inside the new-tab extension's frame (extension/newtab.html). There the
// browser keeps focus in its address bar, and taking it would defeat the
// point, so the box is not autofocused; and a launch navigates the whole tab.
const FRAMED = window.self !== window.top;

function selected() {
  const list = store.prompts();
  return list.find(p => p.id === selectedId) || list[0] || null;
}

function template() {
  return selected()?.template || 'Tell me everything about {}';
}

function currentEngine() {
  return engineById(selected()?.engine || store.setting('defaultEngine', 'google-ai'));
}

// ---------- the sentence ----------

function renderTabs() {
  const list = store.prompts();
  const cur = selected();
  tabsEl.innerHTML = '';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.role = 'tab';
    b.textContent = p.label || defaultLabel(p.template);
    b.setAttribute('aria-selected', String(cur && p.id === cur.id));
    b.tabIndex = cur && p.id === cur.id ? 0 : -1;
    b.addEventListener('click', () => select(p.id));
    tabsEl.appendChild(b);
  }
}

function keepTyped() {
  Object.assign(typed, valuesOf(inputs));
  if (inputs[0]) firstTyped = inputs[0].value;
}

function renderSentence() {
  const focusAt = inputs.indexOf(document.activeElement);
  keepTyped();
  clearPreview();
  const tpl = template();
  const { blanks } = parse(tpl);
  const values = { ...typed };
  if (blanks[0]) values[blanks[0].id] = firstTyped;
  ({ inputs } = buildSentence(sentenceEl, tpl, { values }));
  sentenceEl.classList.toggle('multi', blanks.length > 1);
  if (!single()) setSuggestion('');
  else if (suggestion) ghostOf(inputs[0]).textContent = suggestion;
  engineName.textContent = currentEngine().name;
  const p = selected();
  editLink.href = p ? `/prompts#${encodeURIComponent(p.id)}` : '/prompts';
  updateHint();
  if (focusAt >= 0) (inputs[focusAt] || inputs[0])?.focus();
  explore?.reaim();
}

function ghostOf(input) {
  return input?.parentElement.querySelector('.ghost');
}

function select(id, { focus = true } = {}) {
  selectedId = id;
  store.setSelectedId(id);
  renderTabs();
  renderSentence();
  if (focus) focusFirstEmpty();
}

function focusFirstEmpty() {
  (inputs.find(i => !i.value.trim()) || inputs[inputs.length - 1])?.focus();
}

wireSentence(sentenceEl);

// Clicking the words, not a box, goes to the first box still empty.
sentenceEl.addEventListener('mousedown', e => {
  if (e.target.tagName === 'INPUT') return;
  e.preventDefault();
  focusFirstEmpty();
});

sentenceEl.addEventListener('input', () => updateHint());

sentenceEl.addEventListener('keydown', e => {
  const input = e.target;
  if (input.tagName !== 'INPUT') return;
  const i = inputs.indexOf(input);
  if (e.key === 'Enter') {
    e.preventDefault();
    launch({ newTab: e.metaKey || e.ctrlKey });
    return;
  }
  if (e.key === 'Tab' && !e.shiftKey && i === 0 && !input.value && suggestion) {
    e.preventDefault();
    input.value = suggestion;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (inputs.length > 1) inputs[1].focus();
    return;
  }
  // Backspace in an empty box steps back to the one before.
  if (e.key === 'Backspace' && !input.value && i > 0) {
    e.preventDefault();
    inputs[i - 1].focus();
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const list = store.prompts();
    if (list.length < 2) return;
    e.preventDefault();
    const at = list.findIndex(p => p.id === selected()?.id);
    select(list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].id, { focus: false });
    (inputs[Math.min(Math.max(i, 0), inputs.length - 1)] || inputs[0])?.focus();
  }
});

// ---------- launching ----------

// The address a launch would open, for Explore's links. A card's question
// goes as it is; a topic goes into the prompt's blank. A prompt with several
// blanks cannot be finished by one topic, so the card fills the first box
// instead of linking anywhere.
function link(text, kind) {
  const target = store.setting('newTab', false) ? '_blank' : FRAMED ? '_top' : '';
  const engine = currentEngine();
  if (kind === 'angle') return { href: engine.url(encodeURIComponent(text)), target };
  const { blanks } = parse(template());
  if (blanks.length > 1) return { fill: true };
  return { href: engine.url(encodeURIComponent(fill(template(), { [blanks[0].id]: text }))), target };
}

function fillFirst(topic) {
  inputs[0].value = topic;
  inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
  clearPreview();
  sentenceEl.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  focusFirstEmpty();
}

function launch({ newTab }) {
  const p = selected();
  if (!p) return;
  const empty = inputs.find(i => !i.value.trim());
  if (empty) { empty.focus(); nudge(empty); return; }
  const engine = currentEngine();
  const url = engine.url(encodeURIComponent(fill(p.template, valuesOf(inputs))));
  document.body.classList.add('launching');
  countLaunch(engine.id, 'typed');
  store.remember(inputs[0].value);
  if (newTab || store.setting('newTab', false)) {
    window.open(url, '_blank', 'noopener');
    for (const i of inputs) { i.value = ''; i.parentElement.dataset.value = ''; }
    for (const k of Object.keys(typed)) delete typed[k];
    firstTyped = '';
    inputs[0].focus();
    updateHint();
    setTimeout(() => document.body.classList.remove('launching'), 400);
    explore?.render();
  } else if (FRAMED) {
    // In the new-tab extension's frame, "this tab" means the whole tab: the
    // engines refuse to load inside a frame, and the frame is not what the
    // person is looking at anyway. The keypress that got us here is the user
    // activation a cross-origin frame needs to navigate its top window.
    try { window.top.location.assign(url); } catch { window.open(url, '_blank', 'noopener'); }
  } else {
    window.location.assign(url);
  }
}

function nudge(input) {
  const slot = input.parentElement;
  slot.classList.remove('nudge');
  void slot.offsetWidth;
  slot.classList.add('nudge');
}

// The one thing the page reports: that a launch happened, to which engine,
// and whether it came from the box or from Explore. Never the topic.
// keepalive lets it complete after navigation.
function countLaunch(engine, from) {
  try {
    fetch('/api/launch', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ engine, from }) }).catch(() => {});
  } catch { /* never block a launch on this */ }
}

$('#ask').addEventListener('submit', e => { e.preventDefault(); launch({ newTab: false }); });

document.addEventListener('keydown', e => {
  if (e.key === '/' && !inputs.includes(document.activeElement) && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
    e.preventDefault();
    focusFirstEmpty();
  }
  if (e.key === 'Escape' && !engineMenu.hidden) closeMenu();
});
function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
window.addEventListener('pageshow', e => {
  document.body.classList.remove('launching');
  if (e.persisted) {
    selectedId = store.selectedId();
    renderTabs();
    renderSentence();
  }
  clearPreview();
  explore?.render();
  if (!FRAMED) focusFirstEmpty();
});

// Engine menu: per prompt, so "Latest" can live in Perplexity while
// "Everything about" stays in Google AI Mode.
engineBtn.addEventListener('click', () => (engineMenu.hidden ? openMenu() : closeMenu()));
function openMenu() {
  const p = selected();
  if (!p) return;
  engineMenu.innerHTML = '';
  const cur = p.engine || store.setting('defaultEngine', 'google-ai');
  for (const e of ENGINES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'menuitemradio';
    b.setAttribute('aria-checked', String(e.id === cur));
    b.innerHTML = `<span class="name">${e.name}</span><span class="host">${e.host}</span>`;
    b.addEventListener('click', () => {
      store.upsertPrompt({ ...p, engine: e.id });
      closeMenu();
      renderSentence();
      focusFirstEmpty();
    });
    engineMenu.appendChild(b);
  }
  const note = document.createElement('div');
  note.className = 'menu-note';
  note.textContent = `For "${p.label || 'this prompt'}". Each prompt keeps its own.`;
  engineMenu.appendChild(note);
  const r = engineBtn.getBoundingClientRect();
  const s = engineBtn.offsetParent.getBoundingClientRect();
  engineMenu.style.left = `${r.left - s.left}px`;
  engineMenu.style.top = `${r.bottom - s.top + 6}px`;
  engineMenu.hidden = false;
  engineBtn.setAttribute('aria-expanded', 'true');
  engineMenu.querySelector('[aria-checked="true"]')?.focus();
  setTimeout(() => document.addEventListener('click', onOutside), 0);
}
function closeMenu() {
  engineMenu.hidden = true;
  engineBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onOutside);
}
function onOutside(e) {
  if (!engineMenu.contains(e.target) && e.target !== engineBtn && !engineBtn.contains(e.target)) closeMenu();
}

// ---------- explore ----------

const exploreEl = $('#explore');
let explore = null;
let suggestion = '';
let suggestAt = 0;
let previewing = null;

function exploreOn() {
  return store.setting('explore', true) !== false;
}

function renderExplore() {
  const on = exploreOn();
  exploreEl.hidden = !on;
  document.body.classList.toggle('has-explore', on);
  if (!on) { setSuggestion(''); return; }
  if (explore) { explore.render(); return; }
  explore = createExplore({
    root: exploreEl,
    link,
    fill: fillFirst,
    preview,
    clearPreview,
    interests: () => store.setting('interests', []),
    recent: store.recentTopics,
    launched(kind, topic, e) {
      countLaunch(currentEngine().id, kind);
      store.remember(topic);
      const elsewhere = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1 || store.setting('newTab', false);
      if (!elsewhere) document.body.classList.add('launching');
      // After the browser has followed the link; rebuilding first could drop it.
      else setTimeout(() => explore.render(), 0);
    },
  });
  loadFeed();
}

// The list is the same for everyone and changes once a day, so the page shows
// the copy it has at once and asks again only when that copy is old. The
// request carries no cookie.
async function loadFeed() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(FEED_KEY) || 'null'); } catch { /* ignore */ }
  if (Array.isArray(cached?.feed?.cards)) { explore.setFeed(cached.feed); primeSuggestion(); }
  else explore.render();
  if (cached && Date.now() - cached.at < FEED_FRESH_MS) return;
  try {
    const res = await fetch('/api/explore', { credentials: 'omit' });
    if (!res.ok) throw new Error(String(res.status));
    const feed = await res.json();
    if (!Array.isArray(feed?.cards)) throw new Error('bad feed');
    explore.setFeed(feed);
    primeSuggestion();
    try { localStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), feed })); } catch { /* private mode */ }
  } catch {
    if (!explore.hasFeed()) exploreEl.hidden = true;
  }
}

// Hovering a card writes it into the first box, or a card's question in
// place of the sentence, so you see exactly what will be asked. The stage
// keeps its height (app.css?v=d45deaf580), so nothing below moves.
function preview(kind, text) {
  previewing = kind;
  const slot = inputs[0]?.parentElement;
  if (kind === 'question') {
    slot?.classList.remove('previewing');
    wholeEl.textContent = text;
    sentenceEl.classList.add('whole-preview');
  } else if (slot) {
    sentenceEl.classList.remove('whole-preview');
    slot.classList.add('previewing');
    slot.dataset.value = text;
    ghostOf(inputs[0]).textContent = text;
  }
}

function clearPreview() {
  if (!previewing) return;
  previewing = null;
  sentenceEl.classList.remove('whole-preview');
  const slot = inputs[0]?.parentElement;
  if (!slot) return;
  slot.classList.remove('previewing');
  slot.dataset.value = inputs[0].value;
  const ghost = ghostOf(inputs[0]);
  ghost.textContent = suggestion || ghost.dataset.name;
}

// The empty box suggests the cards' topics in turn; Tab takes one. Only on
// a one-box prompt: in "Plan a {days}-day trip" a topic makes no sense.
function single() {
  return inputs.length === 1;
}

function setSuggestion(text) {
  if (text === suggestion) { updateHint(); return; }
  suggestion = text;
  updateHint();
  const ghost = ghostOf(inputs[0]);
  if (previewing || !ghost) return;
  ghost.classList.add('swap');
  setTimeout(() => {
    if (!previewing) ghost.textContent = suggestion || ghost.dataset.name;
    ghost.classList.remove('swap');
  }, 140);
}

function updateHint() {
  hintTake.hidden = !suggestion || !!inputs[0]?.value;
}

function primeSuggestion() {
  const list = single() ? explore?.topics() || [] : [];
  suggestAt = 0;
  setSuggestion(list[0] || '');
}

setInterval(() => {
  if (previewing || inputs[0]?.value || document.hidden || !exploreOn() || !explore) return;
  const list = single() ? explore.topics() : [];
  if (!list.length) { setSuggestion(''); return; }
  suggestAt = (suggestAt + 1) % list.length;
  setSuggestion(list[suggestAt]);
}, 4500);

// ---------- account ----------

const signin = $('#signin');
const signinForm = $('#signin-form');
const signinStatus = $('#signin-status');
const accountBtn = $('#account-btn');

accountBtn.addEventListener('click', () => {
  if (store.currentUser()) location.href = '/prompts#settings';
  else openSignIn();
});
$('#signin-cancel').addEventListener('click', () => signin.close());

function openSignIn() {
  signinStatus.textContent = '';
  signinStatus.className = 'status';
  signin.showModal();
  $('#signin-email').focus();
}

signinForm.addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#signin-email').value.trim();
  const btn = $('#signin-send');
  btn.disabled = true;
  signinStatus.className = 'status';
  signinStatus.textContent = 'Sending…';
  try {
    const res = await store.requestLink(email);
    signinStatus.className = 'status ok';
    signinStatus.textContent = `Check ${email} for a link. It works once and expires in 15 minutes.`;
    if (res.devLink) {
      const a = document.createElement('a');
      a.href = res.devLink;
      a.textContent = 'Open the dev link.';
      signinStatus.append(' ', a);
    }
  } catch (err) {
    signinStatus.className = 'status err';
    signinStatus.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

function renderUser() {
  const user = store.currentUser();
  accountBtn.textContent = user ? user.email.split('@')[0] : 'Sign in';
  accountBtn.title = user ? `${user.email}: settings and account` : 'Sign in to sync your prompts';
  syncDot.hidden = !user;
  footNote.textContent = user ? `Synced to ${user.email}.` : 'Saved in this browser.';
}

store.subscribe(what => {
  if (what === 'user') renderUser();
  else if (what === 'busy') syncDot.classList.add('busy');
  else if (what === 'idle') syncDot.classList.remove('busy');
  else if (what === 'state') {
    selectedId = store.selectedId() || selectedId;
    renderTabs();
    renderSentence();
    renderExplore();
  }
});

// ---------- home page help ----------

$('#homepage-help').addEventListener('click', e => {
  e.preventDefault();
  $('#homepage-url').value = location.origin + '/';
  $('#homepage').showModal();
});
$('#homepage-copy').addEventListener('click', async e => {
  try { await navigator.clipboard.writeText(location.origin + '/'); e.target.textContent = 'Copied'; }
  catch { $('#homepage-url').select(); }
  setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
});

// ---------- boot ----------

renderTabs();
renderSentence();
renderUser();
renderExplore();
if (!FRAMED) focusFirstEmpty();
store.start();
