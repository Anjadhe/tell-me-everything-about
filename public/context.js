// What a card adds to its prompt in an AI engine: what the card shows (its
// hook and figure), framed by where it came from, so the answer starts where
// the card did. A card from the news asks for what just happened; one from
// history or a timeless topic needs no such framing. Search engines get the
// prompt alone, since a paragraph of background spoils a keyword search.
// Pure; pinned by test/context.test.js.

// How each origin explains why someone is asking, and whether the answer
// should lead with what is new.
const FRAMES = {
  news: { why: when => `It is in the news${when}.`, ask: 'Lead with the latest developments: what just happened, the background needed to follow it, and what to watch for next.' },
  sport: { why: when => `It is in this week's sport${when}.`, ask: 'Start with what just happened, then the story behind it.' },
  hn: { why: () => 'It is being discussed on Hacker News.', ask: 'Include anything recent that explains why people are talking about it.' },
  science: { why: () => 'It came up in new research.', ask: 'Include what the recent research found and how it changes what was known.' },
  culture: { why: () => 'It came up in new books, films or music.', ask: 'Include the recent release and why it is getting attention.' },
  trending: { why: () => 'Many people are reading about it today.', ask: 'If something recent explains the interest, start there.' },
  onthisday: { why: () => 'It is an anniversary today.' },
  featured: { why: () => "It is today's featured article on Wikipedia." },
  til: { why: () => 'I just learned something surprising about it.' },
  essays: { why: () => 'It came up in an essay I was reading.' },
};

const KIND_ASKS = {
  debate: 'Informed people disagree about this: give the strongest case on each side and where the evidence stands.',
  myth: 'It is a popular belief: say plainly what is true, what is not, and how we know.',
  number: 'Explain the story behind the figure.',
};

export function cardContext(c) {
  if (!c?.hook) return '';
  const origin = c.news ? 'news' : c.origin;
  const frame = FRAMES[origin];
  const lines = [];
  lines.push(frame ? `Why I'm asking: ${frame.why(c.day ? ` (${longDay(c.day)})` : '')} ${c.hook}` : `What caught my eye: ${c.hook}`);
  if (c.figure) lines.push(`Key figure: ${c.figure}${c.figureLabel ? `, ${c.figureLabel}` : ''}.`);
  if (c.source?.title) lines.push(`Source: ${c.source.from ? `${c.source.from}, ` : ''}"${c.source.title}"${c.source.url ? ` ${c.source.url}` : ''}`);
  const asks = [KIND_ASKS[c.kind], frame?.ask].filter(Boolean);
  if (asks.length) lines.push(asks.join(' '));
  return lines.join('\n');
}

// The prompt with the card's context under it, for an engine that reads it.
export function withContext(prompt, c, engine) {
  const ctx = engine?.ai ? cardContext(c) : '';
  return ctx ? `${prompt}\n\n${ctx}` : prompt;
}

function longDay(day) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : day;
}
