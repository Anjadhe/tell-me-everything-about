// Usage dashboard. Everything on it comes from one call to /api/admin/usage,
// which the Worker only answers with the admin key.

const KEY = 'tmea:admin-key';
const $ = s => document.querySelector(s);
const ENGINE_NAMES = { 'google-ai': 'Google AI Mode', google: 'Google Search', perplexity: 'Perplexity', chatgpt: 'ChatGPT', claude: 'Claude', grok: 'Grok', duckduckgo: 'DuckDuckGo', other: 'Other' };
const COUNTRY = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

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
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setKey(''); return showGate('That key was not accepted.'); }
  if (!res.ok) return showGate(data.error || `The Worker answered ${res.status}.`);
  render(data);
  $('#gate').hidden = true; $('#dash').hidden = false;
  $('#refresh').hidden = false; $('#lock').hidden = false;
}

function sum(obj) { return Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0); }
function last(days, n) { return days.slice(-n); }
function fmtDay(d) { const [, m, day] = d.split('-'); return `${Number(m)}/${Number(day)}`; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function render(d) {
  const days = d.days;
  const week = last(days, 7);
  const t = d.traffic;
  const pv = day => (t.available && t.byDay[day] && !t.byDay[day].error) ? t.byDay[day].human : null;
  const dropped = day => (t.available && t.byDay[day] && !t.byDay[day].error) ? t.byDay[day].filtered : 0;

  $('#generated').textContent = `As of ${new Date(d.generatedAt).toLocaleString()} · days in UTC`;

  const pv7 = week.map(pv).some(v => v !== null) ? week.reduce((a, day) => a + (pv(day) || 0), 0) : null;
  const tiles = [
    { n: week.reduce((a, day) => a + (d.launchByDay[day] || 0), 0), l: 'Launches', dsc: 'last 7 days' },
    { n: pv7 === null ? '–' : pv7, l: 'Page loads by people', dsc: pv7 === null ? 'edge analytics not connected' : 'last 7 days' },
    { n: d.accounts.users, l: 'Accounts', dsc: `${d.accounts.sessions} signed-in browser${d.accounts.sessions === 1 ? '' : 's'}` },
    { n: week.reduce((a, day) => a + (d.signinByDay[day] || 0), 0), l: 'Sign-ins', dsc: 'last 7 days' },
  ];
  $('#tiles').innerHTML = tiles.map(x => `<div class="tile"><div class="n">${x.n}</div><div class="l">${x.l}</div><div class="d">${x.dsc}</div></div>`).join('');

  const maxV = Math.max(1, ...days.map(day => Math.max(pv(day) || 0, d.launchByDay[day] || 0)));
  $('#days').innerHTML = days.map(day => {
    const p = pv(day), l = d.launchByDay[day] || 0;
    const ph = p === null ? 0 : Math.round((p / maxV) * 100), lh = Math.round((l / maxV) * 100);
    return `<div class="day" tabindex="0"><div class="bar pv" data-n="${p ?? 0}" style="height:${ph}%"></div><div class="bar la" data-n="${l}" style="height:${lh}%"></div><div class="tip">${fmtDay(day)} · ${p === null ? '–' : p} loads · ${l} launches</div></div>`;
  }).join('');
  $('#xlabels').innerHTML = days.map((day, i) => `<span>${i % 2 === 0 || days.length <= 7 ? fmtDay(day) : ''}</span>`).join('');
  const part = k => days.reduce((a, day) => a + ((t.available && t.byDay[day] && !t.byDay[day].error) ? (t.byDay[day][k] || 0) : 0), 0);
  $('#filtered-note').textContent = t.available
    ? `Not counted over 14 days: ${part('droppedAssets')} requests that were visitors fetching the stylesheet, scripts, favicon or sync (about four per page load), and ${part('droppedBots')} from scanners, probes, link unfurlers and headless test runs.`
    : `Edge analytics are not connected: ${t.reason || ''}`;

  const engines = Object.entries(d.launchByEngine).sort((a, b) => b[1] - a[1]);
  const maxE = Math.max(1, ...engines.map(e => e[1]));
  $('#engines').innerHTML = engines.length
    ? engines.map(([k, n]) => `<div class="row"><span class="k">${esc(ENGINE_NAMES[k] || k)}</span><div class="track"><div class="fill" style="width:${Math.round((n / maxE) * 100)}%"></div></div><span class="v">${n}</span></div>`).join('')
    : '<p class="note">No launches counted yet.</p>';

  const countries = new Map();
  if (t.available) for (const day of days) for (const c of (t.byDay[day]?.countries || [])) countries.set(c.name, (countries.get(c.name) || 0) + c.n);
  const cs = [...countries].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxC = Math.max(1, ...cs.map(c => c[1]));
  $('#countries').innerHTML = cs.length
    ? cs.map(([code, n]) => `<div class="row"><span class="k">${esc(COUNTRY ? (safeRegion(code) || code) : code)}</span><div class="track"><div class="fill" style="width:${Math.round((n / maxC) * 100)}%"></div></div><span class="v">${n}</span></div>`).join('')
    : '<p class="note">No page loads by people recorded, or edge analytics not connected.</p>';

  $('#table').innerHTML = `<thead><tr><th>Day</th><th class="num">Page loads</th><th class="num">Browsers</th><th class="num">Launches</th><th class="num">Sign-ins</th><th class="num">Not people</th></tr></thead><tbody>` +
    [...days].reverse().map(day => `<tr><td>${day}</td><td class="num">${pv(day) ?? '–'}</td><td class="num">${t.byDay?.[day]?.browsers ?? '–'}</td><td class="num">${d.launchByDay[day] || 0}</td><td class="num">${d.signinByDay[day] || 0}</td><td class="num">${(t.byDay?.[day]?.droppedBots) ?? '–'}</td></tr>`).join('') + '</tbody>';
}

function safeRegion(code) { try { return COUNTRY.of(code); } catch { return null; } }

$('#gate-form').addEventListener('submit', e => { e.preventDefault(); setKey($('#key').value.trim()); $('#key').value = ''; load(); });
$('#refresh').addEventListener('click', load);
$('#lock').addEventListener('click', () => { setKey(''); showGate(); });
load();
