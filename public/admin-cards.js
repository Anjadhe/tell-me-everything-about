// The card manager (/admin/cards): every card Explore can show, by where it
// lives. Daily lists and collections were written by Claude and can be
// corrected or trimmed; pinned and sponsored cards are written here. Saves go
// through the Worker's checks (adminCard in src/explore.js?v=ce4a88d427), the same as a
// generated card. Uses the admin key from /admin.

import { CATEGORIES, categoryById, KINDS, DEPTHS, STEPS, ORIGINS } from './categories.js?v=ce4a88d427';
import { motif } from './explore.js?v=ce4a88d427';

const KEY = 'tmea:admin-key';
const LIMITS = { topic: 70, hook: 110, angle: 140, figure: 10, figureLabel: 40 };
const $ = s => document.querySelector(s);

const COLLECTIONS = {
  daily: { title: 'Daily lists', note: 'The list everyone got on a day, as Claude wrote it. Fix a card, take one out, or add one; the page picks up changes within 15 minutes. Carried cards are copies of earlier days’ cards.' },
  pinned: { title: 'Pinned', note: 'Your own cards, shown to everyone at the top of For you and of their category, between the dates you set. Pause one by switching it off.' },
  sponsored: { title: 'Sponsored', note: 'Labelled “Sponsored”, sent to everyone with the list; each browser shows at most one in about eight cards, and only where the visitor’s own choices allow. Views and clicks are on /admin.' },
  pack: { title: 'Collection', note: '' },
  packs: { title: 'Collections', note: 'Learning paths Claude writes for a subject you give it: ways in, deeper ideas, rabbit holes. Their cards are published into the day’s list, through the same checks as the day’s own cards, and from then on are shown, carried and retired like any other card. Edits here reach the published copies too; writing one again publishes a fresh set. Open one to edit its cards, write it again for fresh topics, or delete it.' },
};

let collection = 'daily';
let day = null;
let packKey = null;
let cards = [];
let packs = [];
let editing = null;   // { id } of the card in the editor, or { id: null } for a new one

// ---------- talking to the Worker ----------

function key() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
function setKey(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ignore */ } }

async function api(method, params, body) {
  const url = `/api/admin/cards${params ? `?${new URLSearchParams(params)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { 'x-admin-key': key(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setKey(''); showGate('That key was not accepted.'); throw new Error('locked'); }
  if (!res.ok) throw new Error(data.error || `The Worker answered ${res.status}.`);
  return data;
}

function showGate(msg = '') {
  $('#gate').hidden = false;
  $('#manager').hidden = true;
  $('#lock').hidden = true;
  $('#gate-err').textContent = msg;
  $('#key').focus();
}

$('#gate-form').addEventListener('submit', e => {
  e.preventDefault();
  setKey($('#key').value.trim());
  $('#key').value = '';
  route();
});
$('#lock').addEventListener('click', () => { setKey(''); showGate(); });

// ---------- the list ----------

async function route() {
  if (!key()) return showGate();
  const h = decodeURIComponent(location.hash.slice(1)) || 'daily';
  const [c, k] = h.split(':');
  collection = COLLECTIONS[c] || c === 'pack' ? c : 'daily';
  packKey = collection === 'pack' ? k : null;
  $('#gate').hidden = true;
  $('#manager').hidden = false;
  $('#lock').hidden = false;
  for (const a of document.querySelectorAll('.cm-nav a')) {
    const on = a.dataset.c === collection || (collection === 'pack' && a.dataset.c === 'packs');
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  }
  $('#search').value = '';
  await load();
}
window.addEventListener('hashchange', route);

async function load() {
  $('#list-error').textContent = '';
  try {
    if (collection === 'daily') {
      const data = await api('GET', { collection, ...(day ? { day } : {}) });
      day = data.day;
      cards = data.cards;
      const sel = $('#day');
      sel.hidden = !data.days.length;
      sel.innerHTML = data.days.map(d => `<option${d === day ? ' selected' : ''}>${d}</option>`).join('');
      $('#n-daily').textContent = day ? `${data.days.length} days kept` : 'None yet';
    } else if (collection === 'packs') {
      packs = (await api('GET', { collection })).packs;
      $('#n-packs').textContent = `${packs.length} packs`;
    } else if (collection === 'pack') {
      const data = await api('GET', { collection, key: packKey });
      cards = data.cards;
      packs = packs.length ? packs : (await api('GET', { collection: 'packs' })).packs;
      COLLECTIONS.pack = { title: data.name, note: `A collection: a path from ways in to rabbit holes.${data.suitable ? '' : ' Claude declined this subject, so it has no cards.'} Also found as: ${[packKey, ...(packs.find(p => p.key === packKey)?.aliases || [])].map(k => k.replace(/-/g, ' ')).join(', ')}.` };
    } else {
      cards = (await api('GET', { collection })).cards;
    }
  } catch (err) {
    if (err.message !== 'locked') $('#list-error').textContent = err.message;
    cards = [];
  }
  renderList();
}

$('#day').addEventListener('change', e => { day = e.target.value; load(); });
$('#search').addEventListener('input', renderList);

function renderList() {
  const info = COLLECTIONS[collection];
  $('#title').textContent = info.title;
  $('#note').textContent = info.note;
  const actions = $('#actions');
  actions.innerHTML = '';
  const list = $('#list');
  list.innerHTML = '';
  const q = $('#search').value.trim().toLowerCase();

  $('#gen-form').hidden = collection !== 'packs';
  if (collection === 'packs') {
    $('#search').hidden = false;
    const shown = packs.filter(p => !q || p.name.toLowerCase().includes(q) || p.key.includes(q));
    $('#count').textContent = `${packs.length} collection${packs.length === 1 ? '' : 's'}`;
    if (!shown.length) list.innerHTML = '<li class="cm-empty">No collections yet. Type a subject above and press Generate.</li>';
    for (const p of shown) {
      const li = document.createElement('li');
      li.className = 'cm-row' + (p.suitable ? '' : ' off');
      li.style.setProperty('--h', 295);
      li.innerHTML = `<div class="cm-swatch"></div><div class="cm-text"><span class="t"></span><span class="h"></span><span class="m"></span></div><div class="acts"></div>`;
      li.querySelector('.t').textContent = p.name;
      li.querySelector('.h').textContent = p.suitable ? `${p.cards} cards` : 'Declined by Claude';
      li.querySelector('.m').textContent = `Written ${new Date(p.createdAt).toLocaleDateString()}${p.aliases.length ? ` · also found as ${p.aliases.map(a => a.replace(/-/g, ' ')).join(', ')}` : ''}`;
      const acts = li.querySelector('.acts');
      if (p.suitable) acts.append(button('Open', 'pill', () => { location.hash = `pack:${p.key}`; }), button('Write again', 'quiet', () => writeAgain(p)));
      acts.append(button('Delete', 'quiet danger', () => deletePack(p)));
      list.appendChild(li);
    }
    return;
  }

  $('#search').hidden = false;
  const add = collection !== 'daily' || day;
  if (add) actions.append(button('Add a card', 'pill solid', () => openEditor(null)));
  if (collection === 'pack') {
    actions.append(button('All collections', 'quiet', () => { location.hash = 'packs'; }));
    actions.append(button('Write again', 'quiet', () => writeAgain(packs.find(p => p.key === packKey) || { key: packKey, name: COLLECTIONS.pack.title })));
    actions.append(button('Delete', 'quiet danger', () => deletePack(packs.find(p => p.key === packKey) || { key: packKey, name: COLLECTIONS.pack.title })));
  }
  const shown = cards.filter(c => !q || `${c.topic} ${c.hook} ${c.angle} ${c.sponsor || ''}`.toLowerCase().includes(q));
  $('#count').textContent = `${cards.length} card${cards.length === 1 ? '' : 's'}${collection === 'daily' && day ? ` on ${day}` : ''}`;
  if (!shown.length) {
    list.innerHTML = `<li class="cm-empty">${q ? 'No card matches.' : collection === 'daily' && !day ? 'No daily list yet. Write one from /admin.' : 'No cards here yet.'}</li>`;
  }
  for (const c of shown) list.appendChild(row(c));
}

function row(c) {
  const cat = categoryById(c.category);
  const li = document.createElement('li');
  li.className = 'cm-row' + (c.active === false ? ' off' : '');
  li.style.setProperty('--h', cat.hue);
  li.innerHTML = `<div class="cm-swatch">${motif(c.category, c.topic)}</div><div class="cm-text"><span class="t"></span><span class="h"></span><span class="m"></span></div><div class="acts"></div>`;
  li.querySelector('.t').textContent = c.topic;
  li.querySelector('.h').textContent = c.hook;
  const meta = [cat.name, KINDS[c.kind] || '', c.step ? STEPS[c.step] : '', c.figure ? `“${c.figure}”` : '',
    c.carried ? `carried from ${c.day || 'earlier'}` : '', c.sponsor ? `by ${c.sponsor}` : '',
    c.starts || c.ends ? `${c.starts || '…'} to ${c.ends || '…'}` : '', c.active === false ? 'off' : ''].filter(Boolean);
  const m = li.querySelector('.m');
  m.innerHTML = `<b></b>`;
  m.querySelector('b').textContent = meta.shift();
  m.append(meta.length ? ` · ${meta.join(' · ')}` : '');
  const acts = li.querySelector('.acts');
  acts.append(button('Edit', 'pill', () => openEditor(c)), button('Delete', 'quiet danger', () => deleteCard(c)));
  return li;
}

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function where() {
  return collection === 'daily' ? { day } : collection === 'pack' ? { key: packKey } : {};
}

async function deleteCard(c) {
  if (!confirm(`Delete “${c.topic}”? ${collection === 'daily' ? 'It leaves that day’s list.' : 'This cannot be undone.'}`)) return;
  try {
    await api('DELETE', null, { collection, id: c.id, ...where() });
    await load();
  } catch (err) { if (err.message !== 'locked') $('#list-error').textContent = err.message; }
}

// ---------- collections ----------

$('#gen-form').addEventListener('submit', async e => {
  e.preventDefault();
  const term = $('#gen-term').value.trim();
  if (!term) return;
  const btn = $('#gen-go');
  btn.disabled = true;
  $('#gen-status').textContent = `Claude is writing a learning path for “${term}”. This takes a few seconds…`;
  try {
    const r = await api('PUT', null, { collection: 'pack', generate: term });
    $('#gen-status').textContent = `Written: ${r.name}, ${r.cards} cards; ${r.published} went into today’s list${r.published < r.cards ? ' (the rest repeat cards already shown recently)' : ''}.`;
    $('#gen-term').value = '';
    await load();
  } catch (err) {
    if (err.message !== 'locked') $('#gen-status').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

async function writeAgain(p) {
  if (!confirm(`Write “${p.name}” again? Its cards are replaced with new ones on fresh topics; edits made here are lost.`)) return;
  $('#gen-status').textContent = `Claude is writing “${p.name}” again…`;
  try {
    const r = await api('PUT', null, { collection: 'pack', generate: p.key.replace(/-/g, ' '), again: true });
    $('#gen-status').textContent = `Written again: ${r.name}, ${r.cards} cards; ${r.published} went into today’s list.`;
    await load();
  } catch (err) {
    if (err.message !== 'locked') $('#gen-status').textContent = err.message;
  }
}

async function deletePack(p) {
  if (!confirm(`Delete the collection “${p.name}”? Visitors who had it switched on stop seeing it.`)) return;
  try {
    await api('DELETE', null, { collection: 'pack', key: p.key, whole: true });
    location.hash = 'packs';
    if (collection === 'packs') await load();
  } catch (err) { if (err.message !== 'locked') $('#list-error').textContent = err.message; }
}

// ---------- the editor ----------

const dialog = $('#editor');
const fieldsEl = $('#ce-fields');

function field(name, label, control, { wide = false, limit } = {}) {
  const f = document.createElement('div');
  f.className = 'ce-field' + (wide ? ' wide' : '');
  const l = document.createElement('label');
  l.htmlFor = `ce-${name}`;
  l.textContent = label;
  if (limit) {
    const n = document.createElement('span');
    n.className = 'n';
    n.dataset.for = name;
    l.appendChild(n);
  }
  control.id = `ce-${name}`;
  control.name = name;
  f.append(l, control);
  return f;
}

function input(type = 'text', cls = '') { const i = document.createElement('input'); i.type = type; i.className = cls; return i; }
function select(options) {
  const s = document.createElement('select');
  for (const [v, t] of options) { const o = document.createElement('option'); o.value = v; o.textContent = t; s.appendChild(o); }
  return s;
}

function openEditor(c) {
  editing = { id: c?.id || null, carried: c?.carried, day: c?.day };
  $('#ce-title').textContent = c ? 'Edit card' : `New card${collection === 'pack' ? ` for ${COLLECTIONS.pack.title}` : ''}`;
  $('#ce-error').textContent = '';
  $('#ce-delete').hidden = !c;
  fieldsEl.innerHTML = '';
  const v = c || { category: 'science', kind: 'topic', depth: 'quick', surprise: 'familiar', tags: [], active: true, step: 'start', origin: 'timeless' };

  const topic = input('text', 'serif'); topic.value = v.topic || ''; topic.required = true;
  const hook = document.createElement('textarea'); hook.value = v.hook || ''; hook.required = true; hook.rows = 2;
  const angle = input(); angle.value = v.angle || '';
  const category = select(CATEGORIES.map(x => [x.id, x.name])); category.value = v.category;
  const kind = select(Object.keys(KINDS).map(k => [k, KINDS[k] || 'A topic']));
  kind.value = v.kind || 'topic';
  const depth = select(Object.entries(DEPTHS)); depth.value = v.depth || 'quick';
  const surprise = select([['familiar', 'Familiar'], ['surprising', 'Surprising']]); surprise.value = v.surprise || 'familiar';
  const figure = input(); figure.value = v.figure || '';
  const figureLabel = input(); figureLabel.value = v.figureLabel || '';

  fieldsEl.append(
    field('topic', 'Topic', topic, { wide: true, limit: LIMITS.topic }),
    field('hook', 'Hook', hook, { wide: true, limit: LIMITS.hook }),
    field('angle', 'Follow-up question', angle, { wide: true, limit: LIMITS.angle }),
    field('category', 'Category', category),
    field('kind', 'Kind', kind),
    field('figure', 'Figure', figure, { limit: LIMITS.figure }),
    field('figureLabel', 'What the figure is', figureLabel, { limit: LIMITS.figureLabel }),
    field('depth', 'Depth', depth),
    field('surprise', 'Surprise', surprise),
  );
  fieldsEl.append(tagPicker(v.tags || []));

  if (collection === 'daily') {
    const origin = select(Object.entries(ORIGINS)); origin.value = v.origin || 'timeless';
    fieldsEl.append(field('origin', 'Where it came from', origin));
  }
  if (collection === 'pack') {
    const step = select(Object.entries(STEPS)); step.value = v.step || 'deeper';
    fieldsEl.append(field('step', 'Step on the path', step));
  }
  if (collection === 'sponsored') {
    const sponsor = input(); sponsor.value = v.sponsor || ''; sponsor.required = true;
    const url = input('url'); url.value = v.url || ''; url.placeholder = 'https://';
    fieldsEl.append(field('sponsor', 'Sponsor', sponsor), field('url', 'Sponsor’s page (optional)', url));
  }
  if (collection === 'pinned') {
    const position = input('number'); position.value = v.position ?? 0;
    fieldsEl.append(field('position', 'Order (lower first)', position));
  }
  if (collection === 'sponsored' || collection === 'pinned') {
    const starts = input('date'); starts.value = v.starts || '';
    const ends = input('date'); ends.value = v.ends || '';
    fieldsEl.append(field('starts', 'Starts', starts), field('ends', 'Ends', ends));
    if (!c) {
      const rowId = input(); rowId.placeholder = 'From the topic if empty'; rowId.pattern = '[a-z0-9-]{1,40}';
      fieldsEl.append(field('rowId', 'Id (a–z, 0–9, -)', rowId));
    }
    const on = document.createElement('div');
    on.className = 'ce-field';
    on.innerHTML = '<span class="lbl">Showing</span><label class="ce-check"><input type="checkbox" class="switch" id="ce-active" name="active"> On</label>';
    on.querySelector('input').checked = v.active !== false;
    fieldsEl.append(on);
  }
  // Category colours the tag rows and the preview.
  category.addEventListener('change', paint);
  fieldsEl.addEventListener('input', paint);
  fieldsEl.addEventListener('change', paint);
  paint();
  dialog.showModal();
  topic.focus();
}

function tagPicker(selected) {
  const f = document.createElement('div');
  f.className = 'ce-field wide';
  f.innerHTML = '<span class="lbl">Tags <span class="n">up to three</span></span>';
  const box = document.createElement('div');
  box.className = 'ce-tags';
  for (const c of CATEGORIES) {
    const r = document.createElement('div');
    r.className = 'row';
    r.style.setProperty('--h', c.hue);
    r.innerHTML = '<span class="cat"></span>';
    r.querySelector('.cat').textContent = c.name;
    for (const t of c.tags) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.style.setProperty('--h', c.hue);
      b.dataset.tag = t.id;
      b.textContent = t.name;
      b.setAttribute('aria-pressed', String(selected.includes(t.id)));
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') === 'true';
        if (!on && box.querySelectorAll('[aria-pressed="true"]').length >= 3) return;
        b.setAttribute('aria-pressed', String(!on));
        paint();
      });
      r.appendChild(b);
    }
    box.appendChild(r);
  }
  f.appendChild(box);
  return f;
}

function values() {
  const val = n => fieldsEl.querySelector(`[name="${n}"]`)?.value ?? '';
  const out = {
    topic: val('topic').trim(), hook: val('hook').trim(), angle: val('angle').trim(), category: val('category'),
    kind: val('kind'), depth: val('depth'), surprise: val('surprise'), figure: val('figure').trim(), figureLabel: val('figureLabel').trim(),
    tags: [...fieldsEl.querySelectorAll('.ce-tags [aria-pressed="true"]')].map(b => b.dataset.tag),
  };
  if (collection === 'daily') out.origin = val('origin');
  if (collection === 'pack') out.step = val('step');
  if (collection === 'sponsored') Object.assign(out, { sponsor: val('sponsor').trim(), url: val('url').trim() });
  if (collection === 'pinned') out.position = Number(val('position')) || 0;
  if (collection === 'sponsored' || collection === 'pinned') {
    Object.assign(out, { starts: val('starts'), ends: val('ends'), active: $('#ce-active').checked });
    if (!editing.id && val('rowId').trim()) out.rowId = val('rowId').trim();
  }
  if (editing.carried) Object.assign(out, { carried: true, day: editing.day });
  return out;
}

// The preview is the home page's card, drawn from the form as it stands.
function paint() {
  const v = values();
  for (const [name, limit] of Object.entries(LIMITS)) {
    const n = fieldsEl.querySelector(`.n[data-for="${name}"]`);
    if (!n) continue;
    const len = (v[name] || '').length;
    n.textContent = `${len} / ${limit}`;
    n.classList.toggle('over', len > limit);
  }
  const cat = categoryById(v.category);
  const second = collection === 'pinned' ? 'Editor’s pick' : collection === 'sponsored' ? '' : collection === 'pack' ? STEPS[v.step] : KINDS[v.kind] || (v.origin && v.origin !== 'timeless' ? ORIGINS[v.origin] : '');
  const kicker = collection === 'sponsored' ? `Sponsored · ${v.sponsor || 'Sponsor'}` : cat.name + (second ? ` · ${second}` : '');
  const box = $('#ce-preview');
  box.innerHTML = `
    <article class="card${collection === 'sponsored' ? ' sponsored' : ''}" style="--h:${cat.hue}">
      <div class="card-link">
        <div class="cover${v.figure ? ' has-figure' : ''}">${motif(v.category, v.topic || 'preview')}
          ${v.depth === 'deep' ? '<span class="depth">Deep dive</span>' : ''}
          ${v.figure ? '<div class="figure"><span class="figure-n"></span><span class="figure-l"></span></div>' : ''}
        </div>
        <div class="card-body"><span class="kicker"></span><h3 class="card-title"></h3><p class="card-hook"></p></div>
      </div>
      <div class="card-foot">${v.angle ? '<span class="angle"></span>' : ''}</div>
    </article>`;
  box.querySelector('.kicker').textContent = kicker;
  box.querySelector('.card-title').textContent = v.topic || 'Topic';
  box.querySelector('.card-hook').textContent = v.hook || 'The hook goes here.';
  if (v.figure) { box.querySelector('.figure-n').textContent = v.figure; box.querySelector('.figure-l').textContent = v.figureLabel; }
  if (v.angle) box.querySelector('.angle').textContent = v.angle;
  for (const r of fieldsEl.querySelectorAll('.ce-tags .row')) r.style.opacity = '';
}

$('#ce-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#ce-save');
  btn.disabled = true;
  $('#ce-error').textContent = '';
  try {
    await api('PUT', null, { collection, id: editing.id, card: values(), ...where() });
    dialog.close();
    await load();
  } catch (err) {
    if (err.message !== 'locked') $('#ce-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
$('#ce-close').addEventListener('click', () => dialog.close());
$('#ce-cancel').addEventListener('click', () => dialog.close());
$('#ce-delete').addEventListener('click', async () => {
  const c = cards.find(x => x.id === editing.id);
  if (!c) return;
  dialog.close();
  await deleteCard(c);
});

route();
