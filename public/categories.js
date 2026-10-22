// What Explore's cards can be about, shared by the page (labels, colours,
// preferences) and the Worker (the only values a generated card may carry).
// Each hue tints that category's covers in both themes; the order is the
// order of the pills and chips. Tags sit under one category each but a card
// may carry tags from any, so a story about Roman engineering can be both
// History and Engineering.

export const CATEGORIES = [
  { id: 'science', name: 'Science', hue: 258, blurb: 'discoveries, the universe, the body and how things work',
    tags: [['space', 'Space'], ['physics', 'Physics'], ['biology', 'Biology'], ['health', 'Health and medicine'], ['maths', 'Maths']] },
  { id: 'technology', name: 'Technology', hue: 205, blurb: 'computing, AI, the internet, engineering and inventions',
    tags: [['ai', 'AI'], ['computing', 'Computing'], ['internet', 'The internet'], ['engineering', 'Engineering'], ['inventions', 'Inventions']] },
  { id: 'nature', name: 'Nature', hue: 150, blurb: 'animals, plants, oceans, weather, climate and the living planet',
    tags: [['animals', 'Animals'], ['plants', 'Plants and fungi'], ['oceans', 'Oceans'], ['climate', 'Climate'], ['earth', 'Earth and weather']] },
  { id: 'history', name: 'History', hue: 55, blurb: 'people, events and objects from the past, and how we know about them',
    tags: [['ancient', 'Ancient world'], ['medieval', 'Medieval'], ['modern-history', 'Modern history'], ['war', 'War and conflict'], ['archaeology', 'Archaeology']] },
  { id: 'culture', name: 'Culture', hue: 340, blurb: 'books, film, music, art, design and food',
    tags: [['books', 'Books'], ['film', 'Film and TV'], ['music', 'Music'], ['art', 'Art and design'], ['food', 'Food and drink']] },
  { id: 'society', name: 'Society', hue: 25, blurb: 'how people live together: money, cities, law, language and travel',
    tags: [['economics', 'Economics'], ['cities', 'Cities'], ['law', 'Law and rights'], ['language', 'Language'], ['travel', 'Travel and places']] },
  { id: 'ideas', name: 'Ideas', hue: 295, blurb: 'philosophy, the mind, beliefs, paradoxes and the future',
    tags: [['philosophy', 'Philosophy'], ['psychology', 'Psychology'], ['beliefs', 'Religion and myth'], ['paradoxes', 'Puzzles and paradoxes'], ['future', 'The future']] },
  { id: 'sport', name: 'Sport', hue: 115, blurb: 'games, athletes, records, tactics and the science of sport',
    tags: [['football', 'Football'], ['olympics', 'Olympic sports'], ['motorsport', 'Motorsport'], ['endurance', 'Running and endurance'], ['games', 'Chess and games']] },
].map(c => ({ ...c, tags: c.tags.map(([id, name]) => ({ id, name, category: c.id })) }));

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);

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
