// What a prompt's wording means. Pure; pinned by test/template.test.js.
//
//   {}            the blank, as before ("something")
//   {city}        a named blank: its own box on the home page, named "city"
//   {today} …     filled in automatically (AUTO_FILLS)
//
// The same name twice is one blank used twice. A prompt with no blank gets
// one at the end, which is how a plain sentence has always worked.

export const MAX_BLANKS = 4;
const DEFAULT_BLANK = 'something';
const TOKEN = /\{([^{}\n]{0,40})\}/g;

export const AUTO_FILLS = {
  today: { label: "Today's date", value: (now, locale) => now.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) },
  month: { label: 'This month', value: (now, locale) => now.toLocaleDateString(locale, { month: 'long', year: 'numeric' }) },
  year: { label: 'This year', value: now => String(now.getFullYear()) },
  language: { label: 'Your language', value: (now, locale) => languageName(locale) },
};

export function autoValues(now = new Date(), locale = defaultLocale()) {
  const out = {};
  for (const [k, a] of Object.entries(AUTO_FILLS)) out[k] = a.value(now, locale);
  return out;
}

function defaultLocale() {
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}

function languageName(locale) {
  const code = String(locale || 'en').split('-')[0];
  try { return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code; } catch { return code; }
}

// parts: [{ type: 'text', text } | { type: 'auto', key } | { type: 'blank', id, name }]
// blanks: the distinct blanks in order, at most MAX_BLANKS. Blanks past the
// limit stay in the sentence as plain text (counted in extra). appended: the
// wording had no blank, so one was added at the end.
export function parse(template) {
  const t = String(template || '').trim();
  const parts = [];
  const blanks = [];
  let extra = 0;
  let last = 0;
  for (const m of t.matchAll(TOKEN)) {
    if (m.index > last) parts.push({ type: 'text', text: t.slice(last, m.index) });
    last = m.index + m[0].length;
    const name = m[1].trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (AUTO_FILLS[key]) { parts.push({ type: 'auto', key }); continue; }
    const id = key || DEFAULT_BLANK;
    let blank = blanks.find(b => b.id === id);
    if (!blank) {
      if (blanks.length >= MAX_BLANKS) { extra++; parts.push({ type: 'text', text: m[0] }); continue; }
      blank = { id, name: name || DEFAULT_BLANK };
      blanks.push(blank);
    }
    parts.push({ type: 'blank', id, name: blank.name });
  }
  if (last < t.length) parts.push({ type: 'text', text: t.slice(last) });
  const appended = !blanks.length;
  if (appended) {
    if (parts.length) parts.push({ type: 'text', text: ' ' });
    blanks.push({ id: DEFAULT_BLANK, name: DEFAULT_BLANK });
    parts.push({ type: 'blank', id: DEFAULT_BLANK, name: DEFAULT_BLANK });
  }
  return { parts, blanks, extra, appended };
}

// The sentence that goes to the engine. values: { [blankId]: text }.
export function fill(template, values = {}, autos = autoValues()) {
  return parse(template).parts.map(p => {
    if (p.type === 'text') return p.text;
    if (p.type === 'auto') return autos[p.key] ?? '';
    return String(values[p.id] ?? '').trim();
  }).join('').replace(/\s+/g, ' ').trim();
}

// What the editor says about a wording: its blanks, what fills itself in,
// and anything that will not work the way it looks.
export function describe(template) {
  const t = String(template || '');
  const { blanks, parts, extra, appended } = parse(t);
  const autos = [...new Set(parts.filter(p => p.type === 'auto').map(p => p.key))];
  const problems = [];
  if (extra) problems.push(`Only the first ${MAX_BLANKS} blanks become boxes; the rest stay as written.`);
  const stripped = t.replace(TOKEN, '');
  if (stripped.includes('{') || stripped.includes('}')) problems.push('A { or } is not part of a placeholder. Placeholders look like {city}.');
  return { blanks, autos, appended, problems };
}

// A tab name for a prompt with none: its words up to the first placeholder.
export function defaultLabel(template) {
  const lead = String(template || '').split('{')[0].trim();
  return (lead.length > 32 ? lead.slice(0, 31).trim() + '…' : lead) || 'Untitled';
}

// The wording as typed, cut into runs for the editor to colour: 'blank',
// 'auto', 'extra' (a blank past the limit, which stays text) or 'text'.
// Untrimmed, so the runs line up with the textarea character for character.
export function highlight(text) {
  const s = String(text || '');
  const runs = [];
  const seen = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) runs.push({ kind: 'text', text: s.slice(last, m.index) });
    last = m.index + m[0].length;
    const key = m[1].trim().replace(/\s+/g, ' ').toLowerCase();
    let kind = 'blank';
    if (AUTO_FILLS[key]) kind = 'auto';
    else if (!seen.includes(key || DEFAULT_BLANK)) {
      if (seen.length >= MAX_BLANKS) kind = 'extra';
      else seen.push(key || DEFAULT_BLANK);
    }
    runs.push({ kind, text: m[0] });
  }
  if (last < s.length) runs.push({ kind: 'text', text: s.slice(last) });
  return runs;
}
