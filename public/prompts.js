// The prompts page (/prompts): write prompts, and keep settings and the
// account. #<id> edits a prompt, #new starts one, #settings shows the rest.
//
// Everything saves as you type. A new prompt is kept once it has words.

import * as store from './store.js?v=c4d4666288';
import { ENGINES, engineById } from './engines.js?v=c4d4666288';
import { describe, AUTO_FILLS, autoValues, fill, defaultLabel, highlight } from './template.js?v=c4d4666288';
import { buildSentence, wireSentence, valuesOf } from './sentence.js?v=c4d4666288';
import { CATEGORIES } from './categories.js?v=c4d4666288';

const EXAMPLES = [
  { label: 'Compare', template: 'Compare {thing} with {other thing}: how they differ, where each one wins, and which to choose when' },
  { label: 'Like I am five', template: 'Explain {} as if I were five years old' },
  { label: 'Trip', template: 'Plan a {days}-day trip to {city} for someone who loves {interests}' },
  { label: 'As of today', template: "What's the latest on {topic} as of {today}? Only what happened in {year}, with dates" },
  { label: 'For and against', template: 'Give the strongest case for and against {}, then say which side the evidence favours' },
  { label: 'In my language', template: 'Explain {} in {language}, in plain words, with one example' },
];
// Names for a new blank, in the order + Blank offers them.
const BLANK_NAMES = ['topic', 'thing', 'other thing', 'place', 'person', 'detail'];

const $ = s => document.querySelector(s);
const listEl = $('#pp-list');
const countEl = $('#pp-count');
const newLink = $('#pp-new');
const settingsLink = $('#pp-settings');
const editorEl = $('#editor');
const settingsEl = $('#settings');
const headingEl = $('#ed-heading');
const statusEl = $('#ed-status');
const tplEl = $('#ed-template');
const mirrorEl = $('#ed-mirror');
const toolsEl = $('#ed-tools');
const helpEl = $('#ed-help');
const nameEl = $('#ed-name');
const enginesEl = $('#ed-engines');
const previewEl = $('#ed-sentence');
const queryEl = $('#ed-query');
const tryBtn = $('#ed-try');
const examplesEl = $('#ed-examples');

let currentId = null;      // null while a new prompt has no words yet
let engine = 'google-ai';
let previewInputs = [];
const tried = {};          // what was typed into the preview, by blank
let saveTimer = null;
let statusTimer = null;

// ---------- routing ----------

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'settings') return showSettings();
  const list = store.prompts();
  if (h === 'new') {
    if (list.length >= store.MAX_PROMPTS) { history.replaceState(null, '', `#${list[0].id}`); return showEditor(list[0].id); }
    return showEditor(null);
  }
  const p = store.promptById(h) || list[0];
  if (!p) return showEditor(null);
  if (h !== p.id) history.replaceState(null, '', `#${encodeURIComponent(p.id)}`);
  showEditor(p.id);
}

window.addEventListener('hashchange', () => { commit(); route(); });
window.addEventListener('pagehide', commit);

// ---------- the list ----------

function renderList() {
  const list = store.prompts();
  const onSettings = !settingsEl.hidden;
  listEl.innerHTML = '';
  list.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'pp-row';
    const a = document.createElement('a');
    a.className = 'pp-item';
    a.href = `#${encodeURIComponent(p.id)}`;
    if (!onSettings && p.id === currentId) a.setAttribute('aria-current', 'page');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = p.label || defaultLabel(p.template);
    const sub = document.createElement('span');
    sub.className = 's';
    const blanks = describe(p.template).blanks.length;
    sub.textContent = `${engineById(p.engine || store.setting('defaultEngine', 'google-ai')).name}${blanks > 1 ? ` · ${blanks} blanks` : ''}`;
    a.append(n, sub);
    li.appendChild(a);

    const move = document.createElement('span');
    move.className = 'pp-move';
    move.append(
      moveButton('up', `Move ${n.textContent} up`, i === 0, () => shift(p.id, -1)),
      moveButton('down', `Move ${n.textContent} down`, i === list.length - 1, () => shift(p.id, 1)),
    );
    li.appendChild(move);
    listEl.appendChild(li);
  });
  if (!onSettings && !currentId) {
    const li = document.createElement('li');
    li.className = 'pp-row';
    li.innerHTML = '<span class="pp-item draft" aria-current="page"><span class="n">New prompt</span><span class="s">Not saved until it has words</span></span>';
    listEl.appendChild(li);
  }
  const full = list.length >= store.MAX_PROMPTS;
  countEl.textContent = `${list.length} of ${store.MAX_PROMPTS}${full ? ', the most there can be' : ''}`;
  newLink.classList.toggle('disabled', full);
  newLink.setAttribute('aria-disabled', String(full));
  newLink.title = full ? 'Delete a prompt to make room for a new one' : '';
  if (onSettings) settingsLink.setAttribute('aria-current', 'page'); else settingsLink.removeAttribute('aria-current');
}

newLink.addEventListener('click', e => { if (newLink.classList.contains('disabled')) e.preventDefault(); });

function moveButton(dir, label, disabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon';
  b.disabled = disabled;
  b.setAttribute('aria-label', label);
  b.innerHTML = dir === 'up'
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>'
    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  b.addEventListener('click', onClick);
  return b;
}

function shift(id, dir) {
  commit();
  const ids = store.prompts().map(p => p.id);
  const i = ids.indexOf(id), j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  store.reorder(ids);
  renderList();
  listEl.querySelectorAll('.pp-row')[j]?.querySelector(`.pp-move button:${dir < 0 ? 'first-child' : 'last-child'}:not(:disabled)`)?.focus();
}

// ---------- the editor ----------

function showEditor(id) {
  editorEl.hidden = false;
  settingsEl.hidden = true;
  currentId = id;
  const p = id ? store.promptById(id) : null;
  nameEl.value = p?.label || '';
  tplEl.value = p?.template || '';
  engine = p?.engine || store.setting('defaultEngine', 'google-ai');
  for (const k of Object.keys(tried)) delete tried[k];
  if (p) store.setSelectedId(p.id);
  $('#ed-foot').hidden = !p || store.prompts().length < 2;
  $('#ed-confirm').hidden = true;
  $('#ed-delete').hidden = false;
  examplesEl.hidden = !!p;
  statusEl.textContent = '';
  renderEngines();
  templateChanged();
  renderList();
  if (!p) tplEl.focus();
}

function templateChanged() {
  const t = tplEl.value;
  mirrorEl.replaceChildren(...highlight(t).map(r => {
    if (r.kind === 'text') return document.createTextNode(r.text);
    const m = document.createElement('mark');
    m.className = `tk tk-${r.kind}`;
    m.textContent = r.text;
    return m;
  }), document.createTextNode('​'));
  tplEl.style.height = 'auto';
  tplEl.style.height = `${tplEl.scrollHeight}px`;
  nameEl.placeholder = t.trim() ? defaultLabel(t) : 'Short name, like "Compare"';
  headingEl.textContent = nameEl.value.trim() || (t.trim() ? defaultLabel(t) : 'New prompt');
  renderHelp(t);
  renderPreview();
}

function renderHelp(t) {
  helpEl.replaceChildren();
  if (!t.trim()) {
    helpEl.append(line('Write it the way you would ask. Put a blank where your topic goes, like {city}, and the home page gives it a box.'));
    return;
  }
  const d = describe(t);
  if (d.appended) {
    helpEl.append(line('No blanks yet, so the box goes at the end. Add one with ', strong('+ Blank'), ', or write {} where it goes.'));
  } else {
    const parts = [`${d.blanks.length} ${d.blanks.length === 1 ? 'box' : 'boxes'} to fill in: `];
    d.blanks.forEach((b, i) => parts.push(...(i ? [', '] : []), token('blank', b.name)));
    if (d.blanks.length > 1) parts.push('. Explore cards fill the first one.');
    helpEl.append(line(...parts));
  }
  if (d.autos.length) {
    const now = autoValues();
    const parts = ['Filled in for you: '];
    d.autos.forEach((k, i) => parts.push(...(i ? ['; '] : []), token('auto', k), ` is ${now[k]}`));
    helpEl.append(line(...parts, '.'));
  }
  for (const p of d.problems) {
    const l = line(p);
    l.className = 'warn';
    helpEl.append(l);
  }
}

function line(...parts) {
  const p = document.createElement('p');
  p.append(...parts);
  return p;
}
function strong(text) {
  const b = document.createElement('b');
  b.textContent = text;
  return b;
}
function token(kind, name) {
  const m = document.createElement('mark');
  m.className = `tk tk-${kind}`;
  m.textContent = name;
  return m;
}

function renderPreview() {
  const t = tplEl.value.trim();
  Object.assign(tried, valuesOf(previewInputs));
  ({ inputs: previewInputs } = buildSentence(previewEl, t || EXAMPLES[0].template, { values: tried }));
  previewEl.classList.toggle('example', !t);
  $('#ed-try-engine').textContent = engineById(engine).name;
  renderQuery();
}

function renderQuery() {
  const t = tplEl.value.trim() || EXAMPLES[0].template;
  const values = valuesOf(previewInputs);
  const shown = {};
  for (const i of previewInputs) shown[i.dataset.blank] = values[i.dataset.blank].trim() || `[${i.getAttribute('aria-label')}]`;
  queryEl.textContent = fill(t, shown);
}

wireSentence(previewEl);
previewEl.addEventListener('input', renderQuery);
previewEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); tryIt(); }
});
previewEl.addEventListener('mousedown', e => {
  if (e.target.tagName === 'INPUT') return;
  e.preventDefault();
  (previewInputs.find(i => !i.value.trim()) || previewInputs[0])?.focus();
});

function tryIt() {
  const empty = previewInputs.find(i => !i.value.trim());
  if (empty) {
    empty.focus();
    const slot = empty.parentElement;
    slot.classList.remove('nudge');
    void slot.offsetWidth;
    slot.classList.add('nudge');
    return;
  }
  const t = tplEl.value.trim() || EXAMPLES[0].template;
  window.open(engineById(engine).url(encodeURIComponent(fill(t, valuesOf(previewInputs)))), '_blank', 'noopener');
}
tryBtn.addEventListener('click', tryIt);

tplEl.addEventListener('input', () => { templateChanged(); scheduleSave(); });
tplEl.addEventListener('scroll', () => { mirrorEl.scrollTop = tplEl.scrollTop; });
nameEl.addEventListener('input', () => {
  headingEl.textContent = nameEl.value.trim() || (tplEl.value.trim() ? defaultLabel(tplEl.value) : 'New prompt');
  scheduleSave();
});
tplEl.addEventListener('blur', commit);
nameEl.addEventListener('blur', commit);
window.addEventListener('resize', () => { tplEl.style.height = 'auto'; tplEl.style.height = `${tplEl.scrollHeight}px`; });

// Toolbar: + Blank, then one button per automatic value.
for (const [key, a] of Object.entries(AUTO_FILLS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool tool-auto';
  b.dataset.insert = key;
  b.textContent = a.label;
  b.title = `Inserts {${key}}, which becomes "${autoValues()[key]}"`;
  toolsEl.appendChild(b);
}
// Toolbar buttons never take focus, so the caret and selection stay put.
toolsEl.addEventListener('mousedown', e => { if (e.target.closest('[data-insert]')) e.preventDefault(); });
toolsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-insert]');
  if (!b) return;
  if (b.dataset.insert === 'blank') {
    const used = new Set(describe(tplEl.value).blanks.map(x => x.id));
    const name = BLANK_NAMES.find(n => !used.has(n)) || `detail ${used.size + 1}`;
    insert(`{${name}}`, 1, 1 + name.length);
  } else {
    insert(`{${b.dataset.insert}}`);
  }
});

// Puts text at the caret, with a space either side where words would touch,
// and selects [from, to) within it (a new blank's name, ready to retype).
function insert(text, from, to) {
  const start = tplEl.selectionStart ?? tplEl.value.length;
  const end = tplEl.selectionEnd ?? start;
  const before = tplEl.value.slice(0, start), after = tplEl.value.slice(end);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^[\s.,;:!?)'"]/.test(after) ? ' ' : '';
  tplEl.focus();
  tplEl.setRangeText(pre + text + post, start, end, 'end');
  const at = start + pre.length;
  if (from !== undefined) tplEl.setSelectionRange(at + from, at + to);
  tplEl.dispatchEvent(new Event('input', { bubbles: true }));
}

function renderEngines() {
  enginesEl.innerHTML = '';
  for (const e of ENGINES) {
    const label = document.createElement('label');
    label.className = 'engine-opt';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'engine';
    input.value = e.id;
    input.checked = e.id === engine;
    input.addEventListener('change', () => {
      engine = e.id;
      $('#ed-try-engine').textContent = e.name;
      commit();
    });
    const box = document.createElement('span');
    box.className = 'box';
    box.innerHTML = `<span class="name"></span><span class="host"></span>`;
    box.querySelector('.name').textContent = e.name;
    box.querySelector('.host').textContent = e.host;
    label.append(input, box);
    enginesEl.appendChild(label);
  }
}

function renderExamples() {
  const list = $('#ed-example-list');
  list.innerHTML = '';
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'example';
    const n = document.createElement('span');
    n.className = 'ex-name';
    n.textContent = ex.label;
    const t = document.createElement('span');
    t.className = 'ex-tpl';
    for (const r of highlight(ex.template)) {
      if (r.kind === 'text') t.append(r.text);
      else t.append(token(r.kind, r.text));
    }
    b.append(n, t);
    b.addEventListener('click', () => {
      tplEl.value = ex.template;
      if (!nameEl.value.trim()) nameEl.value = ex.label;
      tplEl.dispatchEvent(new Event('input', { bubbles: true }));
      commit();
      tplEl.focus();
    });
    list.appendChild(b);
  }
}

// ---------- saving ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 400);
}

function commit() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (editorEl.hidden) return;
  const label = nameEl.value.trim();
  const template = tplEl.value.trim();
  if (!currentId) {
    if (!template || store.prompts().length >= store.MAX_PROMPTS) return;
    const id = store.newId();
    store.upsertPrompt({ id, label, template, engine, order: store.prompts().length });
    currentId = id;
    store.setSelectedId(id);
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    $('#ed-foot').hidden = store.prompts().length < 2;
    saved();
    return;
  }
  const cur = store.promptById(currentId);
  if (!cur) return;
  if (!template) { status('A prompt needs some words; the last ones are kept.'); return; }
  if (cur.label === label && cur.template === template && cur.engine === engine) return;
  store.upsertPrompt({ ...cur, label, template, engine });
  saved();
}

function saved() {
  status(store.currentUser() ? 'Saved and synced' : 'Saved');
  renderList();
}

function status(text) {
  statusEl.textContent = text;
  statusEl.classList.add('on');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove('on'), 2200);
}

$('#ed-delete').addEventListener('click', () => {
  $('#ed-delete').hidden = true;
  $('#ed-confirm').hidden = false;
  $('#ed-delete-no').focus();
});
$('#ed-delete-no').addEventListener('click', () => {
  $('#ed-confirm').hidden = true;
  $('#ed-delete').hidden = false;
});
$('#ed-delete-yes').addEventListener('click', () => {
  if (!currentId) return;
  store.deletePrompt(currentId);
  const next = store.prompts()[0];
  if (next) store.setSelectedId(next.id);
  // Empty the fields first: the hash change saves, and must find nothing.
  currentId = null;
  tplEl.value = '';
  nameEl.value = '';
  location.hash = next ? encodeURIComponent(next.id) : 'new';
});

// ---------- settings ----------

function showSettings() {
  commit();
  editorEl.hidden = true;
  settingsEl.hidden = false;
  renderSettings();
  renderList();
}

function renderSettings() {
  const sel = $('#s-engine');
  sel.innerHTML = '';
  for (const e of ENGINES) {
    const o = document.createElement('option');
    o.value = e.id;
    o.textContent = e.name;
    o.selected = e.id === store.setting('defaultEngine', 'google-ai');
    sel.appendChild(o);
  }
  $('#s-newtab').checked = !!store.setting('newTab', false);
  $('#s-theme').value = store.setting('theme', 'system');
  $('#s-explore').checked = store.setting('explore', true) !== false;
  $('#s-recent').checked = store.recentOn();
  renderInterests();
  renderAccount();
}

function renderInterests() {
  const el = $('#s-interests');
  const want = new Set(store.setting('interests', []));
  el.innerHTML = '';
  for (const c of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.style.setProperty('--h', c.hue);
    b.setAttribute('aria-pressed', String(want.has(c.id)));
    b.textContent = c.name;
    b.addEventListener('click', () => {
      const next = new Set(store.setting('interests', []));
      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
      store.updateSettings({ interests: CATEGORIES.map(x => x.id).filter(id => next.has(id)) });
      renderInterests();
    });
    el.appendChild(b);
  }
}

$('#s-engine').addEventListener('change', e => store.updateSettings({ defaultEngine: e.target.value }));
$('#s-newtab').addEventListener('change', e => store.updateSettings({ newTab: e.target.checked }));
$('#s-theme').addEventListener('change', e => { store.updateSettings({ theme: e.target.value }); store.applyTheme(e.target.value); });
$('#s-explore').addEventListener('change', e => store.updateSettings({ explore: e.target.checked }));
$('#s-recent').addEventListener('change', e => store.setRecentOn(e.target.checked));

function renderAccount() {
  const el = $('#account-panel');
  const user = store.currentUser();
  el.innerHTML = '';
  if (user) {
    el.innerHTML = `
      <div class="account-row">
        <div><div class="who"></div><div class="sub">Prompts and settings sync to every browser you sign in on.</div></div>
        <div class="account-actions">
          <button type="button" class="pill" id="signout">Sign out</button>
          <button type="button" class="pill danger" id="delete-account">Delete account</button>
        </div>
      </div>`;
    el.querySelector('.who').textContent = user.email;
    el.querySelector('#signout').addEventListener('click', () => store.signOut());
    el.querySelector('#delete-account').addEventListener('click', async () => {
      if (!confirm('Delete your account and the synced copy of your prompts? The prompts in this browser stay.')) return;
      try { await store.deleteAccount(); } catch (err) { alert(err.message); }
    });
    return;
  }
  el.innerHTML = `
    <p class="setting-note account-intro">Your prompts are saved in this browser only. Sign in with a link sent to your email, no password, to keep them on every device.</p>
    <form class="field" id="signin-form">
      <input type="email" id="signin-email" placeholder="you@example.com" required autocomplete="email" inputmode="email" aria-label="Email">
      <button type="submit" class="pill solid" id="signin-send">Email me a link</button>
    </form>
    <p id="signin-status" class="status" aria-live="polite"></p>`;
  el.querySelector('#signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = el.querySelector('#signin-email').value.trim();
    const btn = el.querySelector('#signin-send');
    const out = el.querySelector('#signin-status');
    btn.disabled = true;
    out.className = 'status';
    out.textContent = 'Sending…';
    try {
      const res = await store.requestLink(email);
      out.className = 'status ok';
      out.textContent = `Check ${email} for a link. It works once and expires in 15 minutes.`;
      if (res.devLink) {
        const a = document.createElement('a');
        a.href = res.devLink;
        a.textContent = 'Open the dev link.';
        out.append(' ', a);
      }
    } catch (err) {
      out.className = 'status err';
      out.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- changes from elsewhere ----------

store.subscribe(what => {
  if (what === 'busy') $('#sync-dot').classList.add('busy');
  else if (what === 'idle') $('#sync-dot').classList.remove('busy');
  else if (what === 'user') {
    const user = store.currentUser();
    $('#sync-dot').hidden = !user;
    $('#foot-note').textContent = user ? `Synced to ${user.email}.` : 'Saved in this browser.';
    if (!settingsEl.hidden) renderAccount();
  } else if (what === 'state') {
    // Another tab or browser changed the list. Leave a field alone while
    // someone is typing in it; otherwise show the newer copy.
    const typing = document.activeElement === tplEl || document.activeElement === nameEl;
    if (!settingsEl.hidden) renderSettings();
    else if (currentId && !store.promptById(currentId)) route();
    else if (currentId && !typing) showEditor(currentId);
    renderList();
  }
});

// ---------- boot ----------

renderExamples();
route();
store.start();
