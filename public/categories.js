// What Explore's cards can be about, shared by the page (labels, colours,
// preferences) and the Worker (the only values a generated card may carry).
// Each hue tints that category's covers in both themes; the order is the
// order of the pills and chips. Tags sit under one category each but a card
// may carry tags from any, so a story about Roman engineering can be both
// History and Engineering.

export const CATEGORIES = [
  { id: 'science', name: 'Science', hue: 258, blurb: 'discoveries, the universe, the body and how things work',
    tags: [['space', 'Space'], ['physics', 'Physics'], ['biology', 'Biology'], ['chemistry', 'Chemistry'], ['maths', 'Maths']] },
  { id: 'health', name: 'Health', hue: 178, blurb: 'medicine, the body, the mind, food and fitness, and the health of whole populations',
    tags: [['medicine', 'Medicine'], ['body', 'The body'], ['mind', 'Mind and mental health'], ['fitness', 'Food and fitness'], ['public-health', 'Public health']] },
  { id: 'technology', name: 'Technology', hue: 205, blurb: 'computing, AI, the internet, engineering and inventions',
    tags: [['ai', 'AI'], ['computing', 'Computing'], ['internet', 'The internet'], ['engineering', 'Engineering'], ['inventions', 'Inventions']] },
  { id: 'nature', name: 'Nature', hue: 150, blurb: 'animals, plants, oceans, weather, climate and the living planet',
    tags: [['animals', 'Animals'], ['plants', 'Plants and fungi'], ['oceans', 'Oceans'], ['climate', 'Climate'], ['earth', 'Earth and weather']] },
  { id: 'history', name: 'History', hue: 55, blurb: 'people, events and objects from the past, and how we know about them',
    tags: [['ancient', 'Ancient world'], ['medieval', 'Medieval'], ['modern-history', 'Modern history'], ['war', 'War and conflict'], ['archaeology', 'Archaeology']] },
  { id: 'culture', name: 'Culture', hue: 340, blurb: 'books, film, music, art, design and food',
    tags: [['books', 'Books'], ['film', 'Film and TV'], ['music', 'Music'], ['art', 'Art and design'], ['food', 'Food and drink']] },
  { id: 'business', name: 'Business', hue: 85, blurb: 'the economy, companies, money and markets, work, and new ventures',
    tags: [['economy', 'Economy'], ['companies', 'Companies'], ['markets', 'Money and markets'], ['careers', 'Work and careers'], ['startups', 'Startups and innovation']] },
  { id: 'society', name: 'Society', hue: 25, blurb: 'how people live together: cities, law, language, education and travel',
    tags: [['cities', 'Cities'], ['law', 'Law and rights'], ['language', 'Language'], ['education', 'Education'], ['travel', 'Travel and places']] },
  { id: 'ideas', name: 'Ideas', hue: 295, blurb: 'philosophy, the mind, beliefs, paradoxes and the future',
    tags: [['philosophy', 'Philosophy'], ['psychology', 'Psychology'], ['beliefs', 'Religion and myth'], ['paradoxes', 'Puzzles and paradoxes'], ['future', 'The future']] },
  { id: 'sport', name: 'Sport', hue: 115, blurb: 'games, athletes, records, tactics and the science of sport',
    tags: [['football', 'Football'], ['olympics', 'Olympic sports'], ['motorsport', 'Motorsport'], ['endurance', 'Running and endurance'], ['games', 'Chess and games']] },
].map(c => ({ ...c, tags: c.tags.map(([id, name]) => ({ id, name, category: c.id })) }));

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);

// Sub-topics that moved: Science's "Health and medicine" became the Health
// topic's Medicine, Society's "Economics" became Business's Economy.
export const MOVED_TAGS = { health: { tag: 'medicine', category: 'health' }, economics: { tag: 'economy', category: 'business' } };

// A card from before the move, brought up to date: old sub-topics renamed,
// and a card that was only in Science or Society because of one of them
// filed under the new topic.
export function currentCard(c) {
  if (!c || !Array.isArray(c.tags) || !c.tags.some(t => MOVED_TAGS[t])) return c;
  const tags = [...new Set(c.tags.map(t => MOVED_TAGS[t]?.tag || t))];
  const moved = c.tags.map(t => MOVED_TAGS[t]).find(Boolean);
  const own = CATEGORIES.find(x => x.id === c.category)?.tags.map(t => t.id) || [];
  const category = tags.some(t => own.includes(t)) ? c.category : moved.category;
  return { ...c, tags, category };
}

export const categoryById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];

export const TAGS = CATEGORIES.flatMap(c => c.tags);
export const TAG_IDS = TAGS.map(t => t.id);
export const tagById = id => TAGS.find(t => t.id === id) || null;

// Where a card's topic came from, shown small on the card.
export const ORIGINS = {
  news: 'In the news',
  trending: 'Trending',
  onthisday: 'On this day',
  featured: 'Featured',
  hn: 'Hacker News',
  til: 'Today I learned',
  science: 'New research',
  culture: 'New releases',
  sport: 'This week in sport',
  essays: 'Essays',
  timeless: 'Timeless',
};

// What kind of card it is. A plain topic says nothing; the others say so on
// the card and shape its question.
export const KINDS = {
  topic: '',
  debate: 'A debate',
  myth: 'Myth or fact',
  number: 'Behind the number',
};

export const DEPTHS = { quick: '5-minute', deep: 'Deep dive' };

// A card about something happening now: written by the daily news call, or
// taken from the news by a topic's own call. It sits under its topic like
// any card, lasts a day, and can be left out as a whole ("current events").
export const isNews = c => !!c && (c.news === true || c.origin === 'news');

// Where a card sits on the path through an interest someone asked for.
export const STEPS = { start: 'Start here', deeper: 'Go deeper', rabbithole: 'Rabbit hole' };
