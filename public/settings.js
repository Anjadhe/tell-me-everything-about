// The settings page (/settings): one list of grouped rows, and a page for
// each row with ›. #prompts lists the prompts, #<id> edits one, #new starts
// one, #saved shows saved cards, #engine, #appearance, #topics and #account
// are the rest; no hash is the list itself. (/prompts redirects here, and
// its old #settings/<name> addresses still work.)
//
// Everything saves as you type. A new prompt is kept once it has words.

import * as store from './store.js?v=98c9fd8e4d';
import { ENGINES, engineById } from './engines.js?v=98c9fd8e4d';
import { describe, AUTO_FILLS, autoValues, fill, defaultLabel, highlight, parse } from './template.js?v=98c9fd8e4d';
import { buildSentence, wireSentence, valuesOf } from './sentence.js?v=98c9fd8e4d';
import { CATEGORIES, categoryById, KINDS } from './categories.js?v=98c9fd8e4d';
import { prefsFrom, topicsValue, setCategory, setTag, DEFAULT_TOPICS } from './interests.js?v=98c9fd8e4d';
import { withContext } from './context.js?v=98c9fd8e4d';

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
const listEl = $('#prompt-list');
const promptsEl = $('#prompts-panel');
const editorEl = $('#editor');
const settingsEl = $('#settings-panel');
const savedEl = $('#saved-panel');
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
  const h = decodeURIComponent(location.hash.slice(1)).replace(/^settings\/?/, '');
  if (!h) return showSettings('');
  if (DETAILS[h]) return showSettings(h);
  if (h === 'saved') return showSaved();
  if (h === 'prompts') return showPrompts();
  if (h === 'new') {
    if (store.prompts().length >= store.MAX_PROMPTS) { history.replaceState(null, '', '#prompts'); return showPrompts(); }
    return showEditor(null);
  }
  if (store.promptById(h)) return showEditor(h);
  history.replaceState(null, '', '#settings');
  showSettings('');
}

// One view at a time.
function show(view) {
  for (const el of [promptsEl, editorEl, savedEl, settingsEl]) el.hidden = el !== view;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => { commit(); route(); });
window.addEventListener('pagehide', commit);

// ---------- the list ----------

function showPrompts() {
  commit();
  show(promptsEl);
  renderList();
}

// The prompts as rows (each opens the editor, arrows reorder), the row to
// start a new one, and the counts shown on the settings list.
// Every prompt, each ticked or not: the ticked one is the home page's.
function renderList() {
  const list = store.prompts();
  const home = homePrompt()?.id;
  listEl.innerHTML = '';
  listEl.setAttribute('role', 'radiogroup');
  listEl.setAttribute('aria-label', 'The prompt on your home page');
  list.forEach(p => {
    const li = document.createElement('li');
    li.className = 'ios-split';
    const a = document.createElement('a');
    a.className = 'ios-row';
    a.href = `#${encodeURIComponent(p.id)}`;
    const name = p.label || defaultLabel(p.template);
    const blanks = describe(p.template).blanks.length;
    a.innerHTML = '<span class="ios-name"></span><span class="ios-value"></span><span class="ios-chev" aria-hidden="true">›</span>';
    a.querySelector('.ios-name').textContent = name;
    a.querySelector('.ios-value').textContent = `${engineById(p.engine || store.setting('defaultEngine', 'google-ai')).name}${blanks > 1 ? ` · ${blanks} blanks` : ''}`;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'ios-pick';
    pick.setAttribute('role', 'radio');
    pick.setAttribute('aria-checked', String(p.id === home));
    pick.setAttribute('aria-label', `Use ${name} on the home page`);
    pick.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
    pick.addEventListener('click', () => {
      store.setSelectedId(p.id);
      renderList();
      listEl.querySelector('.ios-pick[aria-checked="true"]')?.focus();
    });
    li.append(pick, a);
    listEl.appendChild(li);
  });
  const full = list.length >= store.MAX_PROMPTS;
  const add = $('#prompt-new');
  add.innerHTML = full
    ? '<li><span class="ios-row ios-static ios-dim">Six is the most there can be. Delete one to add another.</span></li>'
    : '<li><a class="ios-row ios-action" href="#new">New prompt</a></li>';
  $('#prompts-count').textContent = `${list.length} of ${store.MAX_PROMPTS}`;
  $('#v-prompts').textContent = String(list.length);
  const n = store.savedCards().length;
  $('#v-saved').textContent = n ? String(n) : 'None yet';
}

// ---------- the editor ----------

function showEditor(id) {
  show(editorEl);
  currentId = id;
  const p = id ? store.promptById(id) : null;
  nameEl.value = p?.label || '';
  tplEl.value = p?.template || '';
  engine = p?.engine || store.setting('defaultEngine', 'google-ai');
  for (const k of Object.keys(tried)) delete tried[k];
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
  const wasHome = homePrompt()?.id === currentId;
  store.deletePrompt(currentId);
  const next = store.prompts()[0];
  if (wasHome && next) store.setSelectedId(next.id);
  // Empty the fields first: the hash change saves, and must find nothing.
  currentId = null;
  tplEl.value = '';
  nameEl.value = '';
  location.hash = 'prompts';
});

// ---------- saved cards ----------

function showSaved() {
  commit();
  show(savedEl);
  renderSaved();
  renderList();
}

// The prompt the home page uses, which a saved card asks with too.
function homePrompt() {
  const list = store.prompts();
  return list.find(p => p.id === store.selectedId()) || list[0] || null;
}

function renderSaved() {
  const cards = store.savedCards();
  const list = $('#saved-list');
  list.innerHTML = '';
  $('#saved-foot').hidden = !cards.length;
  if (!cards.length) {
    const li = document.createElement('li');
    li.className = 'saved-empty';
    li.innerHTML = 'Nothing saved yet. Use the bookmark on any card under the box on the <a href="/">home page</a>.';
    list.appendChild(li);
    return;
  }
  const p = homePrompt();
  const tpl = p?.template || 'Tell me everything about {}';
  const { blanks } = parse(tpl);
  const engine = engineById(p?.engine || store.setting('defaultEngine', 'google-ai'));
  for (const c of cards) {
    const cat = categoryById(c.category);
    const li = document.createElement('li');
    li.className = 'saved-row';
    li.style.setProperty('--h', cat.hue);
    const text = document.createElement('div');
    text.className = 'saved-text';
    const kicker = document.createElement('span');
    kicker.className = 'kicker';
    kicker.textContent = cat.name + (KINDS[c.kind] ? ` · ${KINDS[c.kind]}` : '');
    const title = document.createElement('span');
    title.className = 'saved-title';
    title.textContent = c.topic;
    const hook = document.createElement('span');
    hook.className = 'saved-hook';
    hook.textContent = c.hook;
    text.append(kicker, title, hook);
    const actions = document.createElement('div');
    actions.className = 'saved-actions';
    if (blanks.length === 1) {
      const ask = document.createElement('a');
      ask.className = 'pill';
      ask.href = engine.url(encodeURIComponent(withCard(fill(tpl, { [blanks[0].id]: c.topic }), c, engine)));
      ask.target = '_blank';
      ask.rel = 'noopener';
      ask.textContent = `${p?.label || defaultLabel(tpl)} ↗`;
      ask.title = `Ask with "${p?.label || defaultLabel(tpl)}" in ${engine.name}`;
      actions.appendChild(ask);
    }
    if (c.angle) {
      const q = document.createElement('a');
      q.className = 'quiet';
      q.href = engine.url(encodeURIComponent(withCard(c.angle, c, engine)));
      q.target = '_blank';
      q.rel = 'noopener';
      q.textContent = 'Its question ↗';
      q.title = c.angle;
      actions.appendChild(q);
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon';
    rm.setAttribute('aria-label', `Remove ${c.topic} from saved`);
    rm.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    rm.addEventListener('click', () => { store.unsaveCard(c.id); renderSaved(); renderList(); });
    actions.appendChild(rm);
    li.append(text, actions);
    list.appendChild(li);
  }
}

$('#saved-clear').addEventListener('click', () => {
  if (!confirm('Remove all saved cards? This removes them everywhere you are signed in.')) return;
  store.unsaveAll();
  renderSaved();
  renderList();
});

// ---------- settings ----------

// One list of grouped rows; a row with › opens its own page at
// #<name>, with a way back. Switches change at once.

const THEMES = [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']];
const DETAILS = { engine: 'New prompts open in', appearance: 'Appearance', topics: 'Topics', account: 'Account' };
let detail = '';

function showSettings(name = '') {
  commit();
  show(settingsEl);
  detail = DETAILS[name] ? name : '';
  renderSettings();
  renderList();
}

function renderSettings() {
  $('#settings-root').hidden = !!detail;
  $('#settings-detail').hidden = !detail;
  if (detail) return renderDetail();
  $('#v-engine').textContent = engineById(store.setting('defaultEngine', 'google-ai')).name;
  $('#s-newtab').checked = !!store.setting('newTab', false);
  $('#v-theme').textContent = THEMES.find(t => t[0] === store.setting('theme', 'system'))[1];
  $('#s-explore').checked = store.setting('explore', true) !== false;
  $('#s-news').checked = store.setting('news', true) !== false;
  $('#s-context').checked = store.setting('cardContext', true) !== false;
  $('#v-topics').textContent = `${prefsFrom(store.setting).categories.size} of ${CATEGORIES.length}`;
  $('#s-recent').checked = store.recentOn();
  const user = store.currentUser();
  $('#v-account-name').textContent = user ? user.email : 'Sign in';
  $('#v-account').textContent = user ? 'Synced' : '';
  $('#v-account-foot').textContent = user
    ? 'Prompts, settings and saved cards sync to every browser you sign in on.'
    : 'Keep your prompts, settings and saved cards on every device.';
}

$('#s-newtab').addEventListener('change', e => store.updateSettings({ newTab: e.target.checked }));
$('#s-explore').addEventListener('change', e => store.updateSettings({ explore: e.target.checked }));
$('#s-news').addEventListener('change', e => store.updateSettings({ news: e.target.checked }));
// A saved card asks with its background, as on the home page.
function withCard(prompt, c, engine) {
  return store.setting('cardContext', true) !== false ? withContext(prompt, c, engine) : prompt;
}

$('#s-context').addEventListener('change', e => store.updateSettings({ cardContext: e.target.checked }));
$('#s-recent').addEventListener('change', e => store.setRecentOn(e.target.checked));

function renderDetail() {
  $('#detail-heading').textContent = DETAILS[detail];
  const body = $('#detail-body');
  body.innerHTML = '';
  if (detail === 'engine') {
    body.append(choiceGroup(ENGINES.map(e => [e.id, e.name, e.host]), store.setting('defaultEngine', 'google-ai'), id => store.updateSettings({ defaultEngine: id })));
    body.append(foot('Each prompt can open somewhere of its own; this is where new ones start.'));
  } else if (detail === 'appearance') {
    body.append(choiceGroup(THEMES, store.setting('theme', 'system'), id => { store.updateSettings({ theme: id }); store.applyTheme(id); }));
  } else if (detail === 'topics') {
    renderTopics(body);
  } else if (detail === 'account') {
    renderAccount(body);
  }
}

// A group of rows with a tick on the one chosen.
function choiceGroup(options, current, onPick) {
  const ul = group();
  for (const [id, name, sub] of options) {
    const b = rowButton(name, sub);
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(id === current));
    b.addEventListener('click', () => { onPick(id); renderDetail(); });
    ul.appendChild(li(b));
  }
  return ul;
}

function group() { const ul = document.createElement('ul'); ul.className = 'ios-group'; return ul; }
function li(child) { const l = document.createElement('li'); l.appendChild(child); return l; }
function label(text) { const d = document.createElement('div'); d.className = 'ios-label'; d.textContent = text; return d; }
function foot(text) { const p = document.createElement('p'); p.className = 'ios-foot'; p.textContent = text; return p; }
function rowButton(name, sub) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ios-row';
  b.innerHTML = '<span class="ios-name"></span><span class="ios-value"></span><span class="ios-tick" aria-hidden="true">✓</span>';
  b.querySelector('.ios-name').textContent = name;
  b.querySelector('.ios-value').textContent = sub || '';
  return b;
}
function switchRow(name, checked, onChange, cls = '') {
  const l = document.createElement('label');
  l.className = `ios-row ${cls}`;
  l.innerHTML = '<span class="ios-name"></span><input type="checkbox" class="switch">';
  l.querySelector('.ios-name').textContent = name;
  const input = l.querySelector('input');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return l;
}

// Topics: a switch for each, its sub-topics ticked underneath while it is on.
function renderTopics(body) {
  const p = prefsFrom(store.setting);
  body.append(foot('Explore shows cards from the topics switched on. Untick a sub-topic to leave it out.'));
  for (const c of CATEGORIES) {
    const ul = group();
    ul.style.setProperty('--h', c.hue);
    const on = p.categories.has(c.id);
    const head = switchRow(c.name, on, v => saveTopics(setCategory(prefsFrom(store.setting), c.id, v)), 'ios-topic');
    ul.appendChild(li(head));
    if (on) {
      for (const t of c.tags) {
        const b = rowButton(t.name);
        b.classList.add('ios-sub');
        b.setAttribute('role', 'menuitemcheckbox');
        b.setAttribute('aria-checked', String(p.tags.has(t.id)));
        b.addEventListener('click', () => saveTopics(setTag(prefsFrom(store.setting), t.id, !p.tags.has(t.id))));
        ul.appendChild(li(b));
      }
    }
    body.append(ul);
  }
  const reset = group();
  const b = rowButton('Reset to Defaults');
  b.classList.add('ios-action');
  b.addEventListener('click', () => { store.updateSettings({ topics: DEFAULT_TOPICS }); renderDetail(); });
  reset.appendChild(li(b));
  body.append(label(' '), reset);
}

function saveTopics(p) {
  store.updateSettings({ topics: topicsValue(p) });
  const y = window.scrollY;
  renderDetail();
  window.scrollTo(0, y);
}

function renderAccount(body) {
  const user = store.currentUser();
  if (user) {
    const ul = group();
    const who = rowButton('Signed in as', user.email);
    who.disabled = true;
    who.classList.add('ios-static');
    ul.appendChild(li(who));
    body.append(ul, foot('Prompts, settings and saved cards sync to every browser you sign in on.'));
    const actions = group();
    const out = rowButton('Sign out');
    out.classList.add('ios-action');
    out.addEventListener('click', () => store.signOut());
    const del = rowButton('Delete account');
    del.classList.add('ios-action', 'danger');
    del.addEventListener('click', async () => {
      if (!confirm('Delete your account and the synced copy of your prompts and saved cards? What is in this browser stays.')) return;
      try { await store.deleteAccount(); } catch (err) { alert(err.message); }
    });
    actions.append(li(out), li(del));
    body.append(label(' '), actions);
    return;
  }
  body.append(foot('Sign in with a link sent to your email, no password. Your prompts, settings and saved cards then follow you to every browser you sign in on.'));
  const form = document.createElement('form');
  form.className = 'field ios-signin';
  form.innerHTML = `
    <input type="email" placeholder="you@example.com" required autocomplete="email" inputmode="email" aria-label="Email">
    <button type="submit" class="pill solid">Email me a link</button>`;
  const out = document.createElement('p');
  out.className = 'status';
  out.setAttribute('aria-live', 'polite');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = form.querySelector('input').value.trim();
    const btn = form.querySelector('button');
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
  body.append(form, out);
}

// ---------- changes from elsewhere ----------

store.subscribe(what => {
  if (what === 'busy') $('#sync-dot').classList.add('busy');
  else if (what === 'idle') $('#sync-dot').classList.remove('busy');
  else if (what === 'user') {
    const user = store.currentUser();
    $('#sync-dot').hidden = !user;
    $('#foot-note').textContent = user ? `Synced to ${user.email}.` : 'Saved in this browser.';
    if (!settingsEl.hidden) renderSettings();
  } else if (what === 'state') {
    // Another tab or browser changed the list. Leave a field alone while
    // someone is typing in it; otherwise show the newer copy.
    const typing = document.activeElement === tplEl || document.activeElement === nameEl;
    if (!settingsEl.hidden) renderSettings();
    else if (!savedEl.hidden) renderSaved();
    else if (!editorEl.hidden && currentId && !store.promptById(currentId)) route();
    else if (!editorEl.hidden && currentId && !typing) showEditor(currentId);
    renderList();
  }
});

// ---------- boot ----------

renderExamples();
route();
store.start();
