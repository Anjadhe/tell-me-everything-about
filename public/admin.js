// Usage dashboard. One call to /api/admin/usage returns every request row
// Cloudflare saw (tagged), the launch counters and the account counts. All
// filtering happens here, in the browser, so nothing is ever dropped.

const KEY = 'tmea:admin-key';
const FILTERS_KEY = 'tmea:admin-filters';
const $ = s => document.querySelector(s);
const ENGINE_NAMES = { 'google-ai': 'Google AI Mode', google: 'Google Search', perplexity: 'Perplexity', chatgpt: 'ChatGPT', claude: 'Claude', grok: 'Grok', duckduckgo: 'DuckDuckGo', other: 'Other' };
const REGION = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const FILTER_IDS = ['days', 'who', 'what', 'path', 'browser', 'device', 'country'];

let data = null;

function getKey() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
function setKey(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* ignore */ } }

function showGate(msg = '') {
  $('#gate').hidden = false; $('#dash').hidden = true;
  $('#refresh').hidden = true; $('#lock').hidden = true;
  $('#gate-err').textContent = msg;
  $('#key').focus();
}

async function load() {
  const key = getKey();
  if (!key) return showGate();
  const res = await fetch('/api/admin/usage', { headers: { 'x-admin-key': key } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { setKey(''); return showGate('That key was not accepted.'); }
  if (!res.ok) return showGate(body.error || `The Worker answered ${res.status}.`);
  data = body;
  $('#generated').textContent = `As of ${new Date(data.generatedAt).toLocaleString()} · days in UTC`;
  fillFilterOptions();
  restoreFilters();
  render();
  $('#gate').hidden = true; $('#dash').hidden = false;
  $('#refresh').hidden = false; $('#lock').hidden = false;
}

// ---------- filters ----------

function allRows() {
  const t = data.traffic;
  if (!t.available) return [];
  const out = [];
  for (const day of data.days) for (const r of (t.byDay[day]?.rows || [])) out.push({ day, ...r });
  return out;
}

function filters() {
  const f = {};
  for (const id of FILTER_IDS) f[id] = $(`#f-${id}`).value;
  return f;
}

function fillFilterOptions() {
  const rows = allRows();
  const fill = (id, values, label = v => v) => {
    const sel = $(`#f-${id}`);
    const cur = sel.value;
    sel.innerHTML = '<option value="">Any</option>' + values.map(v => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
    sel.value = values.includes(cur) ? cur : '';
  };
  const uniq = k => [...new Set(rows.map(r => r[k]))].sort();
  fill('path', uniq('path'));
  fill('browser', uniq('browser'));
  fill('device', uniq('device'));
  fill('country', uniq('country'), regionName);
}

function matches(r, f) {
  return (!f.who || r.who === f.who)
    && (!f.what || r.what === f.what)
    && (!f.path || r.path === f.path)
    && (!f.browser || r.browser === f.browser)
    && (!f.device || r.device === f.device)
    && (!f.country || r.country === f.country);
}

function saveFilters() { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters())); } catch { /* ignore */ } }
function restoreFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTERS_KEY) || 'null');
    if (!f) return;
    for (const id of FILTER_IDS) {
      if (f[id] === undefined) continue;
      const sel = $(`#f-${id}`);
      if ([...sel.options].some(o => o.value === f[id])) sel.value = f[id];
    }
  } catch { /* ignore */ }
}
function resetFilters() {
  $('#f-days').value = '14'; $('#f-who').value = 'person'; $('#f-what').value = 'page';
  for (const id of ['path', 'browser', 'device', 'country']) $(`#f-${id}`).value = '';
  saveFilters(); render();
}

// ---------- render ----------

function sumBy(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + r.n);
  return [...m].sort((a, b) => b[1] - a[1]);
}
function total(rows) { return rows.reduce((a, r) => a + r.n, 0); }
function fmtDay(d) { const [, m, day] = d.split('-'); return `${Number(m)}/${Number(day)}`; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function regionName(code) { if (!REGION || !/^[A-Z]{2}$/.test(code)) return code; try { return REGION.of(code); } catch { return code; } }
function bars(el, pairs, label = k => k, limit = 12) {
  const top = pairs.slice(0, limit);
  const max = Math.max(1, ...top.map(p => p[1]));
  el.innerHTML = top.length
    ? top.map(([k, n]) => `<div class="row"><span class="k" title="${esc(k)}">${esc(label(k))}</span><div class="track"><div class="fill" style="width:${Math.round((n / max) * 100)}%"></div></div><span class="v">${n}</span></div>`).join('')
    : '<p class="note">Nothing matches.</p>';
}

function render() {
  const f = filters();
  const days = data.days.slice(-Number(f.days));
  const t = data.traffic;
  const everything = allRows().filter(r => days.includes(r.day));
  const rows = everything.filter(r => matches(r, f));
  const byDay = Object.fromEntries(days.map(d => [d, 0]));
  for (const r of rows) byDay[r.day] += r.n;

  const shown = total(rows), all = total(everything);
  $('#showing').innerHTML = t.available ? `Showing <b>${shown}</b> of <b>${all}</b> requests` : 'Edge analytics not connected';
  const launches = days.reduce((a, d) => a + (data.launchByDay[d] || 0), 0);
  const signins = days.reduce((a, d) => a + (data.signinByDay[d] || 0), 0);
  const tiles = [
    { n: t.available ? shown : '–', l: 'Requests matching filter', dsc: `of ${t.available ? all : '–'} in ${days.length} days` },
    { n: launches, l: 'Launches', dsc: `${days.length} days, all visitors` },
    { n: data.accounts.users, l: 'Accounts', dsc: `${data.accounts.sessions} signed-in browser${data.accounts.sessions === 1 ? '' : 's'}` },
    { n: signins, l: 'Sign-ins', dsc: `${days.length} days` },
  ];
  $('#tiles').innerHTML = tiles.map(x => `<div class="tile"><div class="n">${x.n}</div><div class="l">${x.l}</div><div class="d">${x.dsc}</div></div>`).join('');

  const maxV = Math.max(1, ...days.map(d => Math.max(byDay[d], data.launchByDay[d] || 0)));
  $('#days').innerHTML = days.map(d => {
    const p = byDay[d], l = data.launchByDay[d] || 0;
    return `<div class="day" tabindex="0"><div class="bar pv" data-n="${p}" style="height:${Math.round((p / maxV) * 100)}%"></div><div class="bar la" data-n="${l}" style="height:${Math.round((l / maxV) * 100)}%"></div><div class="tip">${fmtDay(d)} · ${p} requests · ${l} launches</div></div>`;
  }).join('');
  $('#xlabels').innerHTML = days.map((d, i) => `<span>${i % 2 === 0 || days.length <= 7 ? fmtDay(d) : ''}</span>`).join('');
  const errs = days.filter(d => t.byDay?.[d]?.error);
  $('#traffic-note').textContent = !t.available ? `Edge analytics are not connected: ${t.reason || ''}` : errs.length ? `Cloudflare returned an error for ${errs.length} day(s): ${t.byDay[errs[0]].error}` : '';

  bars($('#paths'), sumBy(rows, 'path'));
  bars($('#countries'), sumBy(rows, 'country'), regionName);
  bars($('#browsers'), sumBy(rows, 'browser'));
  const engines = Object.entries(data.launchByEngine).sort((a, b) => b[1] - a[1]);
  bars($('#engines'), engines, k => ENGINE_NAMES[k] || k);

  const uas = sumBy(rows, 'ua').slice(0, 25);
  const tagOf = ua => { const r = rows.find(x => x.ua === ua); return r ? `<span class="tag">${r.who === 'person' ? 'person' : 'not a person'}</span><span class="tag">${esc(r.browser)}</span><span class="tag">${esc(r.device)}</span>` : ''; };
  $('#uas').innerHTML = `<thead><tr><th>User agent</th><th>Tags</th><th class="num">Requests</th></tr></thead><tbody>` +
    (uas.length ? uas.map(([ua, n]) => `<tr><td class="ua">${esc(ua) || '<i>(empty)</i>'}</td><td>${tagOf(ua)}</td><td class="num">${n}</td></tr>`).join('') : '<tr><td colspan="3" class="note">Nothing matches.</td></tr>') + '</tbody>';

  $('#table').innerHTML = `<thead><tr><th>Day</th><th class="num">Matching</th><th class="num">All requests</th><th class="num">People, pages</th><th class="num">Not people</th><th class="num">Launches</th><th class="num">Sign-ins</th></tr></thead><tbody>` +
    [...days].reverse().map(d => {
      const dayRows = everything.filter(r => r.day === d);
      const people = total(dayRows.filter(r => r.who === 'person' && r.what === 'page'));
      const bots = total(dayRows.filter(r => r.who !== 'person'));
      return `<tr><td>${d}</td><td class="num">${byDay[d]}</td><td class="num">${total(dayRows)}</td><td class="num">${people}</td><td class="num">${bots}</td><td class="num">${data.launchByDay[d] || 0}</td><td class="num">${data.signinByDay[d] || 0}</td></tr>`;
    }).join('') + '</tbody>';
}

for (const id of FILTER_IDS) $(`#f-${id}`).addEventListener('change', () => { saveFilters(); render(); });
$('#f-reset').addEventListener('click', resetFilters);
$('#gate-form').addEventListener('submit', e => { e.preventDefault(); setKey($('#key').value.trim()); $('#key').value = ''; load(); });
$('#refresh').addEventListener('click', load);
$('#lock').addEventListener('click', () => { setKey(''); showGate(); });
load();
