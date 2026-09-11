// Tell me everything about — the page.
//
// Local first: the whole state lives in localStorage and the page works with
// no account. Signing in adds a server copy, merged per prompt by the same
// merge.js?v=d9b3e890d7 the Worker runs, so two browsers can edit the list without one
// clobbering the other.

import { merge, emptyState, normalize, sameState, MAX_PROMPTS } from './merge.js?v=d9b3e890d7';

const STORE_KEY = 'tmea:state';
const THEME_KEY = 'tmea:theme';
const SELECTED_KEY = 'tmea:selected';
const SIGNED_IN_KEY = 'tmea:signed-in'; // hint only; the cookie is the truth

// Every destination is a plain URL with the whole prompt in the query, so
// no topic ever passes through this app's server.
const ENGINES = [
  { id: 'google-ai', name: 'Google AI Mode', host: 'google.com', url: q => `https://www.google.com/search?udm=50&q=${q}` },
  { id: 'google', name: 'Google Search', host: 'google.com', url: q => `https://www.google.com/search?q=${q}` },
  { id: 'perplexity', name: 'Perplexity', host: 'perplexity.ai', url: q => `https://www.perplexity.ai/search?q=${q}` },
  { id: 'chatgpt', name: 'ChatGPT', host: 'chatgpt.com', url: q => `https://chatgpt.com/?q=${q}` },
  { id: 'claude', name: 'Claude', host: 'claude.ai', url: q => `https://claude.ai/new?q=${q}` },
  { id: 'grok', name: 'Grok', host: 'grok.com', url: q => `https://grok.com/?q=${q}` },
  { id: 'duckduckgo', name: 'DuckDuckGo', host: 'duckduckgo.com', url: q => `https://duckduckgo.com/?q=${q}` },
];
const engineById = id => ENGINES.find(e => e.id === id) || ENGINES[0];

// Starters carry FIXED ids and an old stamp: every fresh browser seeds the
// same three records, so merging two browsers never duplicates them, and any
// real edit or deletion made anywhere is newer and wins.
const STARTER_STAMP = '2026-01-01T00:00:00.000Z';
const STARTER_PROMPTS = [
  { id: 'starter-everything', label: 'Everything about', template: 'Tell me everything about {}' },
  { id: 'starter-explain', label: 'Explain simply', template: 'Explain {} simply, as if to a smart friend who knows nothing about it' },
  { id: 'starter-latest', label: 'Latest', template: "What's the latest on {}? Only recent developments, with dates" },
];

// ---------- state ----------

let state = null;
let user = null;          // { email } when signed in
let syncTimer = null;
let selectedId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* fall through */ }
  const s = emptyState();
  s.prompts = STARTER_PROMPTS.map((p, i) => ({ ...p, engine: 'google-ai', order: i, updatedAt: STARTER_STAMP }));
  s.settings = { defaultEngine: 'google-ai', newTab: false, theme: 'system', updatedAt: STARTER_STAMP };
  save(s, { sync: false });
  return s;
}

function save(next = state, { sync = true } = {}) {
  state = normalize(next);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  if (sync && user) scheduleSync();
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

function prompts() {
  return [...state.prompts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function selected() {
  const list = prompts();
  return list.find(p => p.id === selectedId) || list[0] || null;
}

function setting(key, fallback) {
  const v = state.settings?.[key];
  return v === undefined ? fallback : v;
}

function updateSettings(patch) {
  save({ ...state, settings: { ...state.settings, ...patch, updatedAt: new Date().toISOString() } });
}

function upsertPrompt(p) {
  const rest = state.prompts.filter(x => x.id !== p.id);
  save({ ...state, prompts: [...rest, { ...p, updatedAt: new Date().toISOString() }] });
}

function deletePrompt(id) {
  save({
    ...state,
    prompts: state.prompts.filter(x => x.id !== id),
    tombstones: { ...state.tombstones, [id]: new Date().toISOString() },
  });
}

function reorder(ids) {
  const now = new Date().toISOString();
  const byId = new Map(state.prompts.map(p => [p.id, p]));
  const next = ids.map((id, i) => ({ ...byId.get(id), order: i, updatedAt: now }));
  save({ ...state, prompts: next });
}

state = load();

// ---------- page ----------

const $ = s => document.querySelector(s);
const tabsEl = $('#prompt-tabs');
const leadEl = $('#lead');
const tailEl = $('#tail');
const slotEl = $('#slot');
const topicEl = $('#topic');
const engineBtn = $('#engine-btn');
const engineName = $('#engine-name');
const engineMenu = $('#engine-menu');
const footNote = $('#foot-note');
const syncDot = $('#sync-dot');

function splitTemplate(template) {
  const t = (template || '').trim();
  const i = t.indexOf('{}');
  if (i === -1) return { lead: t ? t + ' ' : '', tail: '' };
  return { lead: t.slice(0, i), tail: t.slice(i + 2) };
}

function buildQuery(template, topic) {
  const t = (template || '').trim();
  return t.includes('{}') ? t.replace('{}', topic) : `${t} ${topic}`.trim();
}

function renderTabs() {
  const list = prompts();
  const cur = selected();
  tabsEl.innerHTML = '';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.role = 'tab';
    b.textContent = p.label || splitTemplate(p.template).lead.trim() || 'Untitled';
    b.setAttribute('aria-selected', String(cur && p.id === cur.id));
    b.tabIndex = cur && p.id === cur.id ? 0 : -1;
    b.addEventListener('click', () => select(p.id));
    tabsEl.appendChild(b);
  }
}

function renderSentence() {
  const p = selected();
  const { lead, tail } = splitTemplate(p?.template || 'Tell me everything about {}');
  leadEl.textContent = lead;
  tailEl.textContent = tail;
  const engine = engineById(p?.engine || setting('defaultEngine', 'google-ai'));
  engineName.textContent = engine.name;
  slotEl.dataset.value = topicEl.value;
}

function select(id, { focus = true } = {}) {
  selectedId = id;
  try { localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
  renderTabs();
  renderSentence();
  if (focus) topicEl.focus();
}

function launch({ newTab }) {
  const p = selected();
  const topic = topicEl.value.trim();
  if (!p || !topic) { topicEl.focus(); return; }
  const engine = engineById(p.engine || setting('defaultEngine', 'google-ai'));
  const url = engine.url(encodeURIComponent(buildQuery(p.template, topic)));
  document.body.classList.add('launching');
  if (newTab || setting('newTab', false)) {
    window.open(url, '_blank', 'noopener');
    topicEl.value = '';
    slotEl.dataset.value = '';
    setTimeout(() => document.body.classList.remove('launching'), 400);
  } else {
    window.location.assign(url);
  }
}

$('#ask').addEventListener('submit', e => { e.preventDefault(); launch({ newTab: false }); });
topicEl.addEventListener('input', () => { slotEl.dataset.value = topicEl.value; });
topicEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); launch({ newTab: true }); return; }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const list = prompts();
    if (list.length < 2) return;
    e.preventDefault();
    const i = list.findIndex(p => p.id === selected()?.id);
    const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    select(next.id);
  }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== topicEl && !e.metaKey && !e.ctrlKey && !isTyping(e.target)) {
    e.preventDefault();
    topicEl.focus();
  }
  if (e.key === 'Escape' && !engineMenu.hidden) closeMenu();
});
function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
window.addEventListener('pageshow', () => {
  document.body.classList.remove('launching');
  topicEl.focus();
});

// Engine menu: per prompt, so "Latest" can live in Perplexity while
// "Everything about" stays in Google AI Mode.
engineBtn.addEventListener('click', () => (engineMenu.hidden ? openMenu() : closeMenu()));
function openMenu() {
  const p = selected();
  if (!p) return;
  engineMenu.innerHTML = '';
  const cur = p.engine || setting('defaultEngine', 'google-ai');
  for (const e of ENGINES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'menuitemradio';
    b.setAttribute('aria-checked', String(e.id === cur));
    b.innerHTML = `<span class="name">${e.name}</span><span class="host">${e.host}</span>`;
    b.addEventListener('click', () => {
      upsertPrompt({ ...p, engine: e.id });
      closeMenu();
      renderSentence();
      topicEl.focus();
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

// ---------- theme ----------

function applyTheme(theme) {
  const t = theme === 'light' || theme === 'dark' ? theme : 'system';
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
}

// ---------- manage sheet ----------

const manage = $('#manage');
const listEl = $('#prompt-list');
const addBtn = $('#add-prompt');
const countEl = $('#prompt-count');
const rowTpl = $('#prompt-row');

$('#manage-btn').addEventListener('click', () => { renderManage(); manage.showModal(); });
manage.addEventListener('close', () => { renderTabs(); renderSentence(); topicEl.focus(); });

function engineOptions(sel, current) {
  sel.innerHTML = '';
  for (const e of ENGINES) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    o.selected = e.id === current;
    sel.appendChild(o);
  }
}

function renderManage() {
  const list = prompts();
  listEl.innerHTML = '';
  list.forEach((p, i) => {
    const row = rowTpl.content.firstElementChild.cloneNode(true);
    row.dataset.id = p.id;
    const label = row.querySelector('.f-label');
    const template = row.querySelector('.f-template');
    const engine = row.querySelector('.f-engine');
    label.value = p.label || '';
    template.value = p.template || '';
    engineOptions(engine, p.engine || setting('defaultEngine', 'google-ai'));
    const commit = () => {
      const cur = state.prompts.find(x => x.id === p.id);
      if (!cur) return;
      const next = { ...cur, label: label.value.trim(), template: template.value.trim(), engine: engine.value };
      if (next.label === cur.label && next.template === cur.template && next.engine === cur.engine) return;
      upsertPrompt(next);
    };
    label.addEventListener('change', commit);
    template.addEventListener('change', commit);
    engine.addEventListener('change', commit);
    row.querySelector('.up').disabled = i === 0;
    row.querySelector('.down').disabled = i === list.length - 1;
    row.querySelector('.up').addEventListener('click', () => move(p.id, -1));
    row.querySelector('.down').addEventListener('click', () => move(p.id, 1));
    row.querySelector('.delete').addEventListener('click', () => {
      deletePrompt(p.id);
      if (selectedId === p.id) selectedId = null;
      renderManage();
    });
    listEl.appendChild(row);
  });
  const n = list.length;
  countEl.textContent = `${n} of ${MAX_PROMPTS}`;
  addBtn.disabled = n >= MAX_PROMPTS;
  renderSettings();
  renderAccount();
}

function move(id, dir) {
  const ids = prompts().map(p => p.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  reorder(ids);
  renderManage();
}

addBtn.addEventListener('click', () => {
  if (prompts().length >= MAX_PROMPTS) return;
  const p = { id: newId(), label: '', template: '', engine: setting('defaultEngine', 'google-ai'), order: prompts().length };
  upsertPrompt(p);
  renderManage();
  listEl.lastElementChild?.querySelector('.f-label')?.focus();
});

function renderSettings() {
  engineOptions($('#s-engine'), setting('defaultEngine', 'google-ai'));
  $('#s-newtab').checked = !!setting('newTab', false);
  $('#s-theme').value = setting('theme', 'system');
}
$('#s-engine').addEventListener('change', e => updateSettings({ defaultEngine: e.target.value }));
$('#s-newtab').addEventListener('change', e => updateSettings({ newTab: e.target.checked }));
$('#s-theme').addEventListener('change', e => { updateSettings({ theme: e.target.value }); applyTheme(e.target.value); });

function renderAccount() {
  const el = $('#account-panel');
  if (user) {
    el.innerHTML = `
      <div class="account-row">
        <div><div class="who">${escapeHtml(user.email)}</div><div class="sub">Prompts sync to every browser you sign in on.</div></div>
        <div class="account-actions">
          <button type="button" class="pill" id="signout">Sign out</button>
          <button type="button" class="pill danger" id="delete-account">Delete account</button>
        </div>
      </div>`;
    el.querySelector('#signout').addEventListener('click', signOut);
    el.querySelector('#delete-account').addEventListener('click', deleteAccount);
  } else {
    el.innerHTML = `
      <div class="account-row">
        <p>Your prompts are saved in this browser only. Sign in to keep them on every device.</p>
        <button type="button" class="pill solid" id="signin-open">Sign in with email</button>
      </div>`;
    el.querySelector('#signin-open').addEventListener('click', () => { manage.close(); openSignIn(); });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- account + sync ----------

const signin = $('#signin');
const signinForm = $('#signin-form');
const signinStatus = $('#signin-status');
const accountBtn = $('#account-btn');

accountBtn.addEventListener('click', () => (user ? (renderManage(), manage.showModal()) : openSignIn()));
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
    const res = await api('POST', '/api/auth/request', { email });
    signinStatus.className = 'status ok';
    signinStatus.textContent = `Check ${email} for a link. It works once and expires in 15 minutes.`;
    if (res.devLink) {
      signinStatus.innerHTML += ` <a href="${escapeHtml(res.devLink)}">Open the dev link.</a>`;
    }
  } catch (err) {
    signinStatus.className = 'status err';
    signinStatus.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// A signed-out visitor makes no network request at all: the page is its
// own cache. The hint flag is set by the sign-in redirect and cleared the
// first time the server says the session is gone.
async function whoAmI() {
  let hint = false;
  try { hint = localStorage.getItem(SIGNED_IN_KEY) === '1'; } catch { /* ignore */ }
  if (!hint) { user = null; renderUser(); return; }
  try {
    const me = await api('GET', '/api/me');
    user = me.signedIn ? { email: me.email } : null;
  } catch (err) {
    user = null;
    if (err.status === 401) setSignedInHint(false);
  }
  renderUser();
}

function setSignedInHint(on) {
  try { on ? localStorage.setItem(SIGNED_IN_KEY, '1') : localStorage.removeItem(SIGNED_IN_KEY); } catch { /* ignore */ }
}

function renderUser() {
  accountBtn.textContent = user ? user.email.split('@')[0] : 'Sign in';
  accountBtn.title = user ? user.email : 'Sign in to sync your prompts';
  syncDot.hidden = !user;
  footNote.textContent = user ? `Synced to ${user.email}.` : 'Saved in this browser.';
}

async function pullAndMerge() {
  if (!user) return;
  syncDot.classList.add('busy');
  try {
    const { state: remote } = await api('GET', '/api/state');
    const merged = merge(state, remote);
    const changedLocally = !sameState(merged, state);
    const changedRemotely = !remote || !sameState(merged, remote);
    if (changedLocally) {
      save(merged, { sync: false });
      applyTheme(setting('theme', 'system'));
      renderTabs();
      renderSentence();
    }
    if (changedRemotely) await push();
  } catch (err) {
    if (err.status === 401) { user = null; setSignedInHint(false); renderUser(); }
  } finally {
    syncDot.classList.remove('busy');
  }
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(push, 600);
}

async function push() {
  if (!user) return;
  syncDot.classList.add('busy');
  try {
    const { state: merged } = await api('PUT', '/api/state', { state });
    if (!sameState(merged, state)) {
      save(merged, { sync: false });
      renderTabs();
      renderSentence();
      if (manage.open) renderManage();
    }
  } catch (err) {
    if (err.status === 401) { user = null; setSignedInHint(false); renderUser(); }
  } finally {
    syncDot.classList.remove('busy');
  }
}

async function signOut() {
  try { await api('POST', '/api/auth/logout'); } catch { /* cookie is gone either way */ }
  user = null;
  setSignedInHint(false);
  renderUser();
  renderAccount();
}

async function deleteAccount() {
  if (!confirm('Delete your account and the synced copy of your prompts? The prompts in this browser stay.')) return;
  try { await api('DELETE', '/api/account'); } catch (err) { alert(err.message); return; }
  user = null;
  setSignedInHint(false);
  renderUser();
  renderAccount();
}

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

applyTheme(setting('theme', 'system'));
try { selectedId = localStorage.getItem(SELECTED_KEY); } catch { /* ignore */ }
renderTabs();
renderSentence();
renderUser();
topicEl.focus();

const params = new URLSearchParams(location.search);
if (params.has('signed-in')) { setSignedInHint(true); history.replaceState(null, '', '/'); }
whoAmI().then(pullAndMerge);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullAndMerge(); });
