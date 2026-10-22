// Explore: the day's topics, the same for everyone.
//
// Once a day the Worker reads what the world is looking at (Wikipedia's
// featured feed, Hacker News, Reddit's Today I Learned, and a few feeds for
// each category: new research, new releases, sport, essays), then asks Claude
// for about ten cards per category, one call each. Topics used in the last
// two weeks are left out. The result is stored with the previous days' cards
// carried along, and the page fetches that one list. Nothing about any
// visitor goes into it: each browser picks and orders cards from its own
// preferences (public/interests.js), and a card is just a topic the page
// drops into the visitor's own prompt.
//
// Everything here except generate() and gatherSources() is pure and pinned by
// test/explore.test.js.

import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, CATEGORY_IDS, TAG_IDS, ORIGINS, KINDS, DEPTHS } from '../public/categories.js';

// The model is EXPLORE_MODEL in wrangler.jsonc; this is the fallback when it
// is unset. Server-side refusal fallback is only accepted by some models, so
// it is sent only to those.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const REFUSAL_FALLBACK_MODELS = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'];

export function exploreModel(env) {
  return String(env?.EXPLORE_MODEL || '').trim() || DEFAULT_MODEL;
}

export function modelRequest(model) {
  return REFUSAL_FALLBACK_MODELS.includes(model)
    ? { model, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
    : { model };
}

export const PER_CATEGORY = 10;
const MAX_PER_CATEGORY = 14;
export const MAX_CARRIED = 60;
const MIN_TODAY = 24;
const ORIGIN_IDS = Object.keys(ORIGINS);
const KIND_IDS = Object.keys(KINDS);
const DEPTH_IDS = Object.keys(DEPTHS);
const LIMITS = { topic: 80, hook: 140, figure: 12, figureLabel: 40, angle: 160 };
const USER_AGENT = 'tmea.space/1.0 (https://tmea.space/about; explore feed)';

// ---------- sources ----------

// Feeds beyond Wikipedia, each read for its titles only. A feed that fails
// or changes shape is skipped; the day still has the others.
export const FEEDS = {
  hn: { title: 'Hacker News front page', origin: 'hn', type: 'hn', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30' },
  til: { title: "Reddit's Today I Learned", origin: 'til', type: 'reddit', url: 'https://www.reddit.com/r/todayilearned/top.json?t=day&limit=25' },
  apod: { title: "NASA's astronomy picture of the day", origin: 'science', type: 'apod', url: env => `https://api.nasa.gov/planetary/apod?api_key=${env?.NASA_API_KEY || 'DEMO_KEY'}` },
  quanta: { title: 'Quanta Magazine', origin: 'science', type: 'rss', url: 'https://www.quantamagazine.org/feed/' },
  sciencedaily: { title: 'ScienceDaily', origin: 'science', type: 'rss', url: 'https://www.sciencedaily.com/rss/top/science.xml' },
  arxiv: { title: 'New papers on arXiv', origin: 'science', type: 'rss', url: 'https://export.arxiv.org/api/query?search_query=cat:astro-ph.EP+OR+cat:q-bio.PE+OR+cat:physics.pop-ph&sortBy=submittedDate&sortOrder=descending&max_results=15' },
  wildlife: { title: 'ScienceDaily: plants and animals', origin: 'science', type: 'rss', url: 'https://www.sciencedaily.com/rss/plants_animals.xml' },
  smithsonian: { title: 'Smithsonian Magazine: history', origin: 'essays', type: 'rss', url: 'https://www.smithsonianmag.com/rss/history/' },
  openlibrary: { title: 'Books people are reading on Open Library', origin: 'culture', type: 'openlibrary', url: 'https://openlibrary.org/trending/daily.json?limit=20' },
  nprbooks: { title: 'NPR Books', origin: 'culture', type: 'rss', url: 'https://feeds.npr.org/1032/rss.xml' },
  nprmovies: { title: 'NPR Movies', origin: 'culture', type: 'rss', url: 'https://feeds.npr.org/1045/rss.xml' },
  nprmusic: { title: 'NPR Music', origin: 'culture', type: 'rss', url: 'https://feeds.npr.org/1039/rss.xml' },
  bbcsport: { title: 'BBC Sport', origin: 'sport', type: 'rss', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  conversation: { title: 'The Conversation', origin: 'essays', type: 'rss', url: 'https://theconversation.com/global/articles.atom' },
  aeon: { title: 'Aeon essays', origin: 'essays', type: 'rss', url: 'https://aeon.co/feed.rss' },
};

// Which feeds each category's call sees, besides the shared material.
export const CATEGORY_FEEDS = {
  science: ['quanta', 'sciencedaily', 'apod', 'arxiv'],
  technology: ['hn'],
  nature: ['wildlife'],
  history: ['smithsonian'],
  culture: ['openlibrary', 'nprbooks', 'nprmovies', 'nprmusic'],
  society: ['conversation'],
  ideas: ['aeon', 'conversation'],
  sport: ['bbcsport'],
};

export async function gatherSources(day, fetchImpl = fetch, env = {}) {
  const [y, m, d] = day.split('-');
  const wikiUrl = `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`;
  const ids = Object.keys(FEEDS);
  const [wiki, ...bodies] = await Promise.all([
    getBody(fetchImpl, wikiUrl, 'json'),
    ...ids.map(id => {
      const f = FEEDS[id];
      return getBody(fetchImpl, typeof f.url === 'function' ? f.url(env) : f.url, f.type === 'rss' ? 'text' : 'json');
    }),
  ]);
  const feeds = {};
  ids.forEach((id, i) => { feeds[id] = feedLines(FEEDS[id].type, bodies[i]); });
  return { wiki: wikiLines(wiki), feeds };
}

async function getBody(fetchImpl, url, as) {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: as === 'json' ? 'application/json' : 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!res.ok) throw new Error(`${res.status}`);
    return as === 'json' ? await res.json() : await res.text();
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', event: 'explore_source_failed', url: url.replace(/api_key=[^&]+/, 'api_key=…'), message: err?.message }));
    return null;
  }
}

// Wikipedia's featured feed, boiled down to short lines by section.
export function wikiLines(wiki) {
  const out = { featured: [], news: [], trending: [], onthisday: [] };
  if (wiki?.tfa) out.featured.push(line(wiki.tfa.titles?.normalized, wiki.tfa.description || wiki.tfa.extract));
  for (const n of wiki?.news || []) {
    out.news.push(line(stripHtml(n.story), (n.links || []).map(l => l.titles?.normalized).filter(Boolean).slice(0, 4).join('; ')));
  }
  for (const a of (wiki?.mostread?.articles || []).slice(0, 30)) {
    const title = a.titles?.normalized || '';
    if (!title || /^(Main Page|Special:|Wikipedia:|Portal:|File:)/.test(title)) continue;
    out.trending.push(line(title, a.description));
  }
  for (const e of (wiki?.onthisday || []).slice(0, 20)) {
    out.onthisday.push(line(`${e.year}: ${e.text}`, (e.pages || []).map(p => p.titles?.normalized).filter(Boolean).slice(0, 3).join('; ')));
  }
  for (const k of Object.keys(out)) out[k] = out[k].filter(Boolean);
  return out;
}

// One feed's body, boiled down to at most 20 title lines.
export function feedLines(type, body) {
  if (!body) return [];
  let lines = [];
  try {
    if (type === 'rss') lines = rssTitles(body);
    else if (type === 'hn') lines = (body.hits || []).map(h => line(h.title));
    else if (type === 'reddit') lines = (body.data?.children || []).map(c => line(String(c.data?.title || '').replace(/^TIL( that)?:?\s*/i, '')));
    else if (type === 'apod') lines = [line(body.title, clip(body.explanation, 200))];
    else if (type === 'openlibrary') lines = (body.works || []).map(w => line(w.title, (w.author_name || []).slice(0, 2).join(', ')));
  } catch { lines = []; }
  return lines.filter(Boolean).slice(0, 20);
}

// Titles out of RSS or Atom, without an XML parser (there is none in a
// Worker). Only item and entry titles; the channel's own title is skipped.
export function rssTitles(xml) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const m = b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) continue;
    const t = decodeXml(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).replace(/<[^>]*>/g, '');
    if (t.trim()) out.push(line(t));
  }
  return out;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function line(main, detail) {
  const a = clip(main, 240);
  if (!a) return '';
  const b = clip(detail, 200);
  return b ? `${a} (${b})` : a;
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ---------- prompt ----------

export const SYSTEM = `You are an editor of Explore, a set of topic cards shown under a search box on a browser home page. The visitor clicks a topic and it is dropped into one of their own prompts, such as "Tell me everything about ___", "Explain ___ simply" or "What's the latest on ___?", and opened in an AI assistant. Your job is to make them curious enough to click, and to give them range: over a week they should meet things they would never have thought to ask about.

Pick topics that reward a deep answer: things with a mechanism, a history, a surprise or a debate inside them. Mix what is in the world today (from the material provided) with timeless topics. Prefer the subject behind a headline to the headline itself: "The Kessler syndrome" rather than "Satellite collision on Tuesday".

Leave out celebrity gossip, deaths presented as spectacle, graphic violence, sexual content, partisan framing and anything a reader would feel manipulated by. Leave out topics that only make sense for one country unless they are interesting everywhere. Never repeat a topic from the list of recent topics, even under another name.

Each card has:
- topic: a noun phrase that reads naturally after "Tell me everything about". No question, no trailing punctuation, at most 70 characters.
- hook: one sentence, at most 110 characters, concrete and specific. Make the reader want the answer; never tease, never use an exclamation mark, never start with "Discover" or "Learn".
- kind: "topic" for most cards. Use "debate" for a question where informed people disagree, "myth" for a popular belief worth checking, and "number" for the story behind a striking figure. About a third of the cards should be one of these three.
- depth: "quick" if a few minutes' answer does it justice, "deep" if it deserves a long one.
- surprise: "familiar" for topics most curious readers have heard of, "surprising" for ones they almost certainly have not. Include several of each.
- tags: one to three tags from the list given, the ones a reader who likes them would want this card for.
- origin: where the topic came from, as labelled in the material. Use "timeless" for topics you chose that are not in the material.
- figure: one short striking number or date that belongs to the topic, at most 10 characters, such as "1977", "17 km/s", "86 billion" or "c. 1831". It is printed large on the card, so it must be accurate: use a figure only if it appears in the material or is long-established fact. When you are not certain, use an empty string. A "number" card must have one.
- figureLabel: three to six words saying what the figure is, such as "launched, still transmitting". Empty when figure is empty.
- angle: one specific question a curious person would ask next, at most 140 characters, complete on its own (name the topic in it). For a debate, the question that divides people; for a myth, whether it is true.

Return the cards best first.`;

// The part every category's call shares, so it can be cached: the date, the
// day's general material, and what has been used recently.
export function sharedMessage(day, sources, avoid = []) {
  const w = sources.wiki;
  const body = [
    section('Featured article on Wikipedia (origin: featured)', w.featured),
    section('In the news (origin: news)', w.news),
    section('Most read on Wikipedia yesterday (origin: trending)', w.trending),
    section('On this day (origin: onthisday)', w.onthisday),
    section("Reddit's Today I Learned (origin: til)", sources.feeds.til || []),
  ].filter(Boolean).join('\n\n');
  const recent = avoid.length ? `\n\nTopics used in the last two weeks. Do not repeat any of them:\n${avoid.join('; ')}` : '';
  return `Today is ${day}. Here is what the world is reading today.\n\n${body || '(The general sources could not be reached today.)'}${recent}`;
}

export function categoryMessage(category, sources) {
  const c = CATEGORIES.find(x => x.id === category);
  const feeds = (CATEGORY_FEEDS[category] || [])
    .map(id => section(`${FEEDS[id].title} (origin: ${FEEDS[id].origin})`, sources.feeds[id] || []))
    .filter(Boolean)
    .join('\n\n');
  const tags = c.tags.map(t => `${t.id} (${t.name})`).join(', ');
  return `Write ${PER_CATEGORY} cards for ${c.name}: ${c.blurb}. Cover several different tags rather than many cards on one.

Tags for ${c.name}: ${tags}. A card may also carry a tag from another category when it truly fits; all tags: ${TAG_IDS.join(', ')}.

${feeds ? `Material for ${c.name}:\n\n${feeds}` : `There is no extra material for ${c.name} today; use the shared material and timeless topics.`}`;
}

function section(title, lines) {
  return lines.length ? `## ${title}\n${lines.map(l => `- ${l}`).join('\n')}` : '';
}

export const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'hook', 'kind', 'depth', 'surprise', 'tags', 'origin', 'figure', 'figureLabel', 'angle'],
        properties: {
          topic: { type: 'string' },
          hook: { type: 'string' },
          kind: { type: 'string', enum: KIND_IDS },
          depth: { type: 'string', enum: DEPTH_IDS },
          surprise: { type: 'string', enum: ['familiar', 'surprising'] },
          tags: { type: 'array', items: { type: 'string', enum: TAG_IDS } },
          origin: { type: 'string', enum: ORIGIN_IDS },
          figure: { type: 'string' },
          figureLabel: { type: 'string' },
          angle: { type: 'string' },
        },
      },
    },
  },
};

// ---------- generation ----------

// history: earlier stored feeds, newest first ([{ day, cards }]). Their topics
// are not repeated, and their cards fill out the list as "carried".
// Throws if too few cards came back; the caller keeps the previous list.
export async function generate(env, day, { fetchImpl = fetch, history = [] } = {}) {
  const sources = await gatherSources(day, fetchImpl, env);
  const avoid = recentTopics(history);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = exploreModel(env);
  const shared = sharedMessage(day, sources, avoid.map(a => a.topic));
  const results = await Promise.allSettled(CATEGORY_IDS.map(async category => {
    const response = await client.beta.messages.create({
      ...modelRequest(model),
      max_tokens: 8000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: shared, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: categoryMessage(category, sources) },
        ],
      }],
    });
    if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category || 'unknown'}`);
    if (response.stop_reason === 'max_tokens') throw new Error('reply was cut off');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { model: response.model, cards: cleanCards(JSON.parse(text)?.cards, { category }).slice(0, MAX_PER_CATEGORY) };
  }));
  const byCategory = {};
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') byCategory[CATEGORY_IDS[i]] = r.value.cards;
    else failed.push(`${CATEGORY_IDS[i]}: ${r.reason?.message || r.reason}`);
  });
  if (failed.length) console.error(JSON.stringify({ level: 'warn', event: 'explore_category_failed', day, failed }));
  const usedModel = results.find(r => r.status === 'fulfilled')?.value.model || model;
  const feed = assembleFeed(day, byCategory, history, new Set(avoid.map(a => a.id)));
  const today = feed.cards.filter(c => !c.carried).length;
  if (today < MIN_TODAY) throw new Error(`only ${today} usable cards${failed.length ? ` (${failed.join('; ')})` : ''}`);
  return { ...feed, source: 'daily', generatedAt: new Date().toISOString(), model: usedModel };
}

// Topics shown in the stored feeds, without duplicates: what not to repeat.
export function recentTopics(history) {
  const seen = new Map();
  for (const f of history) for (const c of f.cards || []) if (!seen.has(c.id)) seen.set(c.id, { id: c.id, topic: c.topic });
  return [...seen.values()].slice(0, 300);
}

// Today's cards, taken a category at a time in turn so the list is varied
// from the top (the leading category rotates by day), then earlier days'
// cards marked carried. Each browser re-ranks this for its visitor.
export function assembleFeed(day, byCategory, history = [], avoid = new Set()) {
  const seen = new Set();
  const lists = CATEGORY_IDS.map(id => (byCategory[id] || []).filter(c => !avoid.has(c.id)));
  const turn = dayNumber(day) % CATEGORY_IDS.length;
  const order = [...lists.slice(turn), ...lists.slice(0, turn)];
  const cards = [];
  for (let i = 0; order.some(l => i < l.length); i++) {
    for (const l of order) {
      const c = l[i];
      if (c && !seen.has(c.id)) { seen.add(c.id); cards.push(c); }
    }
  }
  let carried = 0;
  for (const f of history) {
    for (const c of f.cards || []) {
      if (carried >= MAX_CARRIED) break;
      if (c.carried || seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push({ ...c, carried: true, day: f.day });
      carried++;
    }
  }
  return { day, cards };
}

function dayNumber(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 86400_000) : 0;
}

// ---------- cleaning ----------

// The model's reply is data for a page, so every field is trimmed, capped and
// checked against the allowed values; a card that fails is dropped, not fixed.
// With { category } every card belongs to that category (one call each).
export function cleanCards(raw, { category } = {}) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const cat = category || c.category;
    const topic = clip(c.topic, LIMITS.topic).replace(/[.?!:;,]+$/, '');
    const hook = clip(c.hook, LIMITS.hook);
    if (!topic || !hook || !CATEGORY_IDS.includes(cat)) continue;
    const key = slug(topic);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const figure = clip(c.figure, LIMITS.figure);
    const tags = [...new Set((Array.isArray(c.tags) ? c.tags : []).filter(t => TAG_IDS.includes(t)))].slice(0, 3);
    out.push({
      id: key,
      topic,
      hook,
      category: cat,
      tags,
      kind: KIND_IDS.includes(c.kind) ? c.kind : 'topic',
      depth: DEPTH_IDS.includes(c.depth) ? c.depth : 'quick',
      surprise: c.surprise === 'surprising' ? 'surprising' : 'familiar',
      origin: ORIGIN_IDS.includes(c.origin) ? c.origin : 'timeless',
      figure,
      figureLabel: figure ? clip(c.figureLabel, LIMITS.figureLabel) : '',
      angle: clip(c.angle, LIMITS.angle),
    });
  }
  return out;
}

// Whitespace collapsed, control characters gone, cut at a word near the cap.
export function clip(v, max) {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ---------- evergreen ----------

// What the page shows before the first daily run, or when there is no API
// key (local dev). Every figure here is long-established; check before adding.
const T = (category, tags, kind, depth, surprise, card) => ({ ...card, category, tags, kind, depth, surprise, origin: 'timeless' });
export const EVERGREEN = cleanCards([
  T('science', ['space'], 'topic', 'quick', 'familiar', { topic: 'The Voyager Golden Record', hook: 'A gold-plated record of sounds and images from Earth, now past the edge of the solar system.', figure: '1977', figureLabel: 'launched aboard Voyager', angle: 'Who chose what went on the Voyager Golden Record, and what was left off?' }),
  T('history', ['ancient', 'archaeology', 'engineering'], 'topic', 'deep', 'surprising', { topic: 'The Antikythera mechanism', hook: 'A shoebox of corroded bronze gears from a shipwreck that predicted eclipses.', figure: '2,000+', figureLabel: 'years old', angle: 'How did the Antikythera mechanism predict eclipses?' }),
  T('nature', ['animals', 'biology'], 'topic', 'quick', 'surprising', { topic: 'Tardigrades', hook: 'Eight-legged micro-animals that can dry out completely and still come back to life.', figure: '0.5 mm', figureLabel: 'long, at the largest', angle: 'How do tardigrades survive being completely dried out?' }),
  T('technology', ['computing', 'inventions'], 'topic', 'deep', 'familiar', { topic: 'The transistor', hook: 'The tiny switch inside every chip, and how it ended the age of the vacuum tube.', figure: '1947', figureLabel: 'first one, at Bell Labs', angle: 'Why did the transistor change computing so completely?' }),
  T('ideas', ['philosophy', 'ai'], 'debate', 'quick', 'familiar', { topic: 'The trolley problem', hook: 'A runaway tram, five lives, one lever and more than half a century of argument.', figure: '1967', figureLabel: 'posed by Philippa Foot', angle: 'Is it ever right to pull the lever, and what should a self-driving car do?' }),
  T('culture', ['art'], 'topic', 'quick', 'familiar', { topic: 'The Great Wave off Kanagawa', hook: 'A woodblock print sold cheaply in Edo that became one of the best-known images on Earth.', figure: 'c. 1831', figureLabel: 'printed by Hokusai', angle: 'How were prints like The Great Wave made and sold in Edo Japan?' }),
  T('society', ['psychology', 'cities'], 'myth', 'quick', 'familiar', { topic: "Dunbar's number", hook: 'The claim that we can keep about 150 meaningful relationships, and why critics doubt it.', figure: '150', figureLabel: 'stable relationships', angle: "Is Dunbar's number real, or a neat figure that does not hold up?" }),
  T('sport', ['endurance', 'olympics'], 'number', 'quick', 'familiar', { topic: 'The marathon', hook: 'From a Greek legend to a race millions run, and the royal reason for its odd length.', figure: '42.195 km', figureLabel: 'since London 1908', angle: 'Why is a marathon exactly 42.195 kilometres?' }),
  T('science', ['space', 'physics'], 'topic', 'deep', 'familiar', { topic: 'The first image of a black hole', hook: 'Telescopes across the planet acted as one dish the size of Earth to see a shadow.', figure: '2019', figureLabel: 'M87* revealed', angle: 'How did the Event Horizon Telescope photograph a black hole?' }),
  T('history', ['ancient', 'language', 'archaeology'], 'topic', 'quick', 'familiar', { topic: 'The Rosetta Stone', hook: 'One decree written three ways, and the key that let us read hieroglyphs again.', figure: '196 BC', figureLabel: 'when the decree was issued', angle: 'How did Champollion use the Rosetta Stone to decipher hieroglyphs?' }),
  T('nature', ['animals', 'oceans'], 'number', 'quick', 'surprising', { topic: 'Octopus intelligence', hook: 'Most of an octopus’s neurons are in its arms, which seem to make some decisions alone.', figure: '500 million', figureLabel: 'neurons', angle: 'How does an octopus think with its arms?' }),
  T('technology', ['internet', 'engineering', 'oceans'], 'topic', 'quick', 'surprising', { topic: 'Undersea internet cables', hook: 'Glass fibres thinner than a hair, laid on the sea floor, carry nearly all traffic between continents.', figure: '', figureLabel: '', angle: 'What happens when an undersea internet cable is cut?' }),
  T('ideas', ['paradoxes', 'philosophy'], 'topic', 'quick', 'familiar', { topic: 'The Ship of Theseus', hook: 'If you replace every plank of a ship one by one, is it still the same ship?', figure: '', figureLabel: '', angle: 'What does the Ship of Theseus say about personal identity?' }),
  T('culture', ['music'], 'topic', 'deep', 'surprising', { topic: 'The Goldberg Variations', hook: 'One aria, thirty variations, then the aria again, and somehow it sounds different the second time.', figure: '30', figureLabel: 'variations on one aria', angle: 'Why are Glenn Gould’s recordings of the Goldberg Variations so famous?' }),
  T('society', ['cities'], 'debate', 'quick', 'familiar', { topic: 'The 15-minute city', hook: 'Everything you need within a short walk or ride: sensible planning, or a slogan?', figure: '15 min', figureLabel: 'on foot or by bike', angle: 'Does the 15-minute city work, and why does it make some people angry?' }),
  T('sport', ['economics', 'games'], 'topic', 'quick', 'familiar', { topic: 'Moneyball', hook: 'How a baseball team with little money used statistics to compete with the rich clubs.', figure: '2002', figureLabel: "the Oakland A's season", angle: 'How did analytics change professional sport after Moneyball?' }),
  T('science', ['biology', 'health'], 'topic', 'deep', 'familiar', { topic: 'CRISPR gene editing', hook: 'A defence bacteria use against viruses, turned into a tool for rewriting DNA.', figure: '2020', figureLabel: 'Nobel Prize in Chemistry', angle: 'How does CRISPR find and cut one exact spot in a genome?' }),
  T('ideas', ['philosophy', 'psychology'], 'topic', 'quick', 'familiar', { topic: 'Stoicism', hook: 'A philosophy from a painted porch in Athens about what is and is not up to you.', figure: 'c. 300 BC', figureLabel: 'founded by Zeno in Athens', angle: 'What did the Stoics mean by focusing on what you can control?' }),
  T('culture', ['food'], 'topic', 'quick', 'surprising', { topic: 'The Maillard reaction', hook: 'The browning that makes toast, steak and coffee taste like themselves.', figure: '1912', figureLabel: 'described by Louis-Camille Maillard', angle: 'What actually happens to food in the Maillard reaction?' }),
  T('sport', ['games', 'ai'], 'topic', 'quick', 'familiar', { topic: 'Deep Blue versus Kasparov', hook: 'The chess matches that made a computer beating a world champion front-page news.', figure: '1997', figureLabel: 'the rematch Deep Blue won', angle: 'Did Deep Blue really out-think Kasparov, or something else?' }),
  T('sport', ['motorsport', 'engineering'], 'myth', 'quick', 'surprising', { topic: 'Formula 1 aerodynamics', hook: 'Wings and floors that press a car into the track harder the faster it goes.', figure: '', figureLabel: '', angle: 'Could a Formula 1 car really drive upside down on a ceiling?' }),
  T('history', ['ancient', 'books'], 'myth', 'deep', 'familiar', { topic: 'The Library of Alexandria', hook: 'The ancient world’s great library, and the stubborn story of how it was lost.', figure: '', figureLabel: '', angle: 'Was the Library of Alexandria really destroyed in a single fire?' }),
  T('nature', ['animals'], 'topic', 'quick', 'surprising', { topic: 'Starling murmurations', hook: 'Thousands of birds turning as one cloud, with no leader and no plan.', figure: '', figureLabel: '', angle: 'How do starlings in a murmuration avoid crashing into each other?' }),
  T('science', ['health', 'psychology'], 'debate', 'deep', 'familiar', { topic: 'The placebo effect', hook: 'Pills with nothing in them that still help, sometimes even when you know.', figure: '', figureLabel: '', angle: 'Is the placebo effect real healing, or just a quirk of how trials are measured?' }),
]);

export function evergreenFeed(day) {
  return { day, source: 'evergreen', generatedAt: null, cards: EVERGREEN };
}

// ---------- sponsored ----------

// A row of the sponsored table as a card, checked like a generated one. The
// url, if any, must be plain https; nothing is added to it.
export function sponsoredCard(row) {
  let tags = [];
  try { tags = JSON.parse(row.tags || '[]'); } catch { /* none */ }
  const [card] = cleanCards([{ ...row, tags, figureLabel: row.figure_label, kind: 'topic', depth: 'quick', origin: 'timeless' }]);
  if (!card || !/^[a-z0-9-]{1,40}$/.test(row.id || '')) return null;
  const sponsor = clip(row.sponsor, 40);
  if (!sponsor) return null;
  let url = '';
  try { const u = new URL(row.url); if (u.protocol === 'https:') url = u.toString(); } catch { /* none */ }
  return { ...card, id: `sp-${row.id}`, sponsor, url };
}
