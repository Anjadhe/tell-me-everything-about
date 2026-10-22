// Explore: the day's topics, the same for everyone.
//
// Once a day the Worker reads what the world is looking at (Wikipedia's
// featured feed, the Hacker News front page), asks Claude to pick the topics
// worth exploring and write a line about each, and stores the result. The
// page fetches that one list. Nothing about any visitor goes into it, and no
// visitor's topic ever comes back out: a card is just a topic the page drops
// into the visitor's own prompt.
//
// Everything here except generate() and gatherSources() is pure and pinned by
// test/explore.test.js.

import Anthropic from '@anthropic-ai/sdk';
import { CATEGORY_IDS, ORIGINS } from '../public/categories.js';

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
export const MAX_CARDS = 30;
const ORIGIN_IDS = Object.keys(ORIGINS);
const LIMITS = { topic: 80, hook: 140, figure: 12, figureLabel: 40, angle: 160 };
const USER_AGENT = 'tmea.space/1.0 (https://tmea.space/about; explore feed)';

// ---------- sources ----------

export async function gatherSources(day, fetchImpl = fetch) {
  const [y, m, d] = day.split('-');
  const [wiki, hn] = await Promise.all([
    getJson(fetchImpl, `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`),
    getJson(fetchImpl, 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30'),
  ]);
  return sourcesFrom(wiki, hn);
}

async function getJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(JSON.stringify({ level: 'warn', event: 'explore_source_failed', url, message: err?.message }));
    return null;
  }
}

// Boil the two feeds down to short lines, grouped by where they came from.
export function sourcesFrom(wiki, hn) {
  const out = { featured: [], news: [], trending: [], onthisday: [], hn: [] };
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
  for (const h of (hn?.hits || []).slice(0, 30)) out.hn.push(line(h.title));
  for (const k of Object.keys(out)) out[k] = out[k].filter(Boolean);
  return out;
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

export const SYSTEM = `You are the editor of Explore, a short list of topics shown under a search box on a browser home page. The visitor clicks a topic and it is dropped into one of their own prompts, such as "Tell me everything about ___", "Explain ___ simply" or "What's the latest on ___?", and opened in an AI assistant. Your job is to make them curious enough to click.

Pick topics that reward a deep answer: things with a mechanism, a history, a surprise or a debate inside them. Mix what is in the world today (from the material provided) with a few timeless topics. Prefer the subject behind a headline to the headline itself: "The Kessler syndrome" rather than "Satellite collision on Tuesday".

Leave out celebrity gossip, deaths presented as spectacle, graphic violence, sexual content, partisan framing and anything a reader would feel manipulated by. Leave out topics that only make sense for one country unless they are interesting everywhere.

For each card:
- topic: a noun phrase that reads naturally after "Tell me everything about". No question, no trailing punctuation, at most 70 characters.
- hook: one sentence, at most 110 characters, concrete and specific. Make the reader want the answer; never tease, never use an exclamation mark, never start with "Discover" or "Learn".
- category: the best fit of ${CATEGORY_IDS.join(', ')}.
- origin: where the topic came from: ${ORIGIN_IDS.join(', ')}. Use "timeless" for topics you chose that are not in the material.
- figure: one short striking number or date that belongs to the topic, at most 10 characters, such as "1977", "17 km/s", "86 billion" or "c. 1831". It is printed large on the card, so it must be accurate: use a figure only if it appears in the material or is long-established fact. When you are not certain, use an empty string.
- figureLabel: three to six words saying what the figure is, such as "launched, still transmitting". Empty when figure is empty.
- angle: one specific question about the topic that a curious person would ask next, at most 140 characters, complete on its own (name the topic in it).

Return between 20 and 24 cards, best first. The first card leads the page, so make it the most inviting one. Spread them across categories, with at least two in each category where the material allows.`;

export function userMessage(day, sources) {
  const section = (title, lines) => (lines.length ? `## ${title}\n${lines.map(l => `- ${l}`).join('\n')}` : '');
  const body = [
    section('Featured article (origin: featured)', sources.featured),
    section('In the news (origin: news)', sources.news),
    section('Most read on Wikipedia yesterday (origin: trending)', sources.trending),
    section('On this day (origin: onthisday)', sources.onthisday),
    section('Hacker News front page (origin: hn)', sources.hn),
  ].filter(Boolean).join('\n\n');
  return `Today is ${day}. Here is what the world is reading.\n\n${body || '(The sources could not be reached today. Choose timeless topics.)'}\n\nWrite today's Explore cards.`;
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
        required: ['topic', 'hook', 'category', 'origin', 'figure', 'figureLabel', 'angle'],
        properties: {
          topic: { type: 'string' },
          hook: { type: 'string' },
          category: { type: 'string', enum: CATEGORY_IDS },
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

// Asks Claude for the day's cards. Throws if the reply is unusable; the caller
// keeps the previous day's list in that case.
export async function generate(env, day, fetchImpl = fetch) {
  const sources = await gatherSources(day, fetchImpl);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = exploreModel(env);
  const response = await client.beta.messages.create({
    ...modelRequest(model),
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: CARD_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: userMessage(day, sources) }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category || 'unknown'}`);
  if (response.stop_reason === 'max_tokens') throw new Error('reply was cut off');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const cards = cleanCards(JSON.parse(text)?.cards);
  if (cards.length < 8) throw new Error(`only ${cards.length} usable cards`);
  return { day, source: 'daily', generatedAt: new Date().toISOString(), model: response.model || model, cards };
}

// ---------- cleaning ----------

// The model's reply is data for a page, so every field is trimmed, capped and
// checked against the allowed values; a card that fails is dropped, not fixed.
export function cleanCards(raw) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const topic = clip(c.topic, LIMITS.topic).replace(/[.?!:;,]+$/, '');
    const hook = clip(c.hook, LIMITS.hook);
    if (!topic || !hook || !CATEGORY_IDS.includes(c.category)) continue;
    const key = slug(topic);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const figure = clip(c.figure, LIMITS.figure);
    out.push({
      id: key,
      topic,
      hook,
      category: c.category,
      origin: ORIGIN_IDS.includes(c.origin) ? c.origin : 'timeless',
      figure,
      figureLabel: figure ? clip(c.figureLabel, LIMITS.figureLabel) : '',
      angle: clip(c.angle, LIMITS.angle),
    });
    if (out.length >= MAX_CARDS) break;
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
export const EVERGREEN = cleanCards([
  { topic: 'The Voyager Golden Record', hook: 'A gold-plated record of sounds and images from Earth, now past the edge of the solar system.', category: 'science', origin: 'timeless', figure: '1977', figureLabel: 'launched aboard Voyager', angle: 'Who chose what went on the Voyager Golden Record, and what was left off?' },
  { topic: 'The Antikythera mechanism', hook: 'A shoebox of corroded bronze gears from a shipwreck that predicted eclipses.', category: 'history', origin: 'timeless', figure: '2,000+', figureLabel: 'years old', angle: 'How did the Antikythera mechanism predict eclipses?' },
  { topic: 'Tardigrades', hook: 'Eight-legged micro-animals that can dry out completely and still come back to life.', category: 'nature', origin: 'timeless', figure: '0.5 mm', figureLabel: 'long, at the largest', angle: 'How do tardigrades survive being completely dried out?' },
  { topic: 'The transistor', hook: 'The tiny switch inside every chip, and how it ended the age of the vacuum tube.', category: 'technology', origin: 'timeless', figure: '1947', figureLabel: 'first one, at Bell Labs', angle: 'Why did the transistor change computing so completely?' },
  { topic: 'The trolley problem', hook: 'A runaway tram, five lives, one lever and more than half a century of argument.', category: 'ideas', origin: 'timeless', figure: '1967', figureLabel: 'posed by Philippa Foot', angle: 'What does the trolley problem mean for self-driving cars?' },
  { topic: 'The Great Wave off Kanagawa', hook: 'A woodblock print sold cheaply in Edo that became one of the best-known images on Earth.', category: 'culture', origin: 'timeless', figure: 'c. 1831', figureLabel: 'printed by Hokusai', angle: 'How were prints like The Great Wave made and sold in Edo Japan?' },
  { topic: "Dunbar's number", hook: 'The claim that we can keep about 150 meaningful relationships, and why critics doubt it.', category: 'society', origin: 'timeless', figure: '150', figureLabel: 'stable relationships', angle: "What does the evidence say for and against Dunbar's number?" },
  { topic: 'The marathon', hook: 'From a Greek legend to a race millions run, and the royal reason for its odd length.', category: 'sport', origin: 'timeless', figure: '42.195 km', figureLabel: 'since London 1908', angle: 'Why is a marathon exactly 42.195 kilometres?' },
  { topic: 'The first image of a black hole', hook: 'Telescopes across the planet acted as one dish the size of Earth to see a shadow.', category: 'science', origin: 'timeless', figure: '2019', figureLabel: 'M87* revealed', angle: 'How did the Event Horizon Telescope photograph a black hole?' },
  { topic: 'The Rosetta Stone', hook: 'One decree written three ways, and the key that let us read hieroglyphs again.', category: 'history', origin: 'timeless', figure: '196 BC', figureLabel: 'when the decree was issued', angle: 'How did Champollion use the Rosetta Stone to decipher hieroglyphs?' },
  { topic: 'Octopus intelligence', hook: 'Most of an octopus’s neurons are in its arms, which seem to make some decisions alone.', category: 'nature', origin: 'timeless', figure: '500 million', figureLabel: 'neurons', angle: 'How does an octopus think with its arms?' },
  { topic: 'Undersea internet cables', hook: 'Glass fibres thinner than a hair, laid on the sea floor, carry nearly all traffic between continents.', category: 'technology', origin: 'timeless', figure: '', figureLabel: '', angle: 'What happens when an undersea internet cable is cut?' },
  { topic: 'The Ship of Theseus', hook: 'If you replace every plank of a ship one by one, is it still the same ship?', category: 'ideas', origin: 'timeless', figure: '', figureLabel: '', angle: 'What does the Ship of Theseus say about personal identity?' },
  { topic: 'The Goldberg Variations', hook: 'One aria, thirty variations, then the aria again, and somehow it sounds different the second time.', category: 'culture', origin: 'timeless', figure: '30', figureLabel: 'variations on one aria', angle: 'Why are Glenn Gould’s recordings of the Goldberg Variations so famous?' },
  { topic: 'The 15-minute city', hook: 'Everything you need within a short walk or ride: sensible planning, or a slogan?', category: 'society', origin: 'timeless', figure: '15 min', figureLabel: 'on foot or by bike', angle: 'Which cities have tried the 15-minute city, and what happened?' },
  { topic: 'Moneyball', hook: 'How a baseball team with little money used statistics to compete with the rich clubs.', category: 'sport', origin: 'timeless', figure: '2002', figureLabel: "the Oakland A's season", angle: 'How did analytics change professional sport after Moneyball?' },
  { topic: 'CRISPR gene editing', hook: 'A defence bacteria use against viruses, turned into a tool for rewriting DNA.', category: 'science', origin: 'timeless', figure: '2020', figureLabel: 'Nobel Prize in Chemistry', angle: 'How does CRISPR find and cut one exact spot in a genome?' },
  { topic: 'Stoicism', hook: 'A philosophy from a painted porch in Athens about what is and is not up to you.', category: 'ideas', origin: 'timeless', figure: 'c. 300 BC', figureLabel: 'founded by Zeno in Athens', angle: 'What did the Stoics mean by focusing on what you can control?' },
]);

export function evergreenFeed(day) {
  return { day, source: 'evergreen', generatedAt: null, cards: EVERGREEN };
}
