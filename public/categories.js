// The Explore categories. Shared by the page (labels, colours, interests) and
// the Worker (the only values a generated card may carry). Each hue tints that
// category's covers in both themes; the order is the order of the chips.

export const CATEGORIES = [
  { id: 'science', name: 'Science', hue: 258 },
  { id: 'technology', name: 'Technology', hue: 205 },
  { id: 'nature', name: 'Nature', hue: 150 },
  { id: 'history', name: 'History', hue: 55 },
  { id: 'culture', name: 'Culture', hue: 340 },
  { id: 'society', name: 'Society', hue: 25 },
  { id: 'ideas', name: 'Ideas', hue: 295 },
  { id: 'sport', name: 'Sport', hue: 115 },
];

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);

export const categoryById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];

// Where a card's topic came from, shown small on the card.
export const ORIGINS = {
  news: 'In the news',
  trending: 'Trending',
  onthisday: 'On this day',
  featured: 'Featured',
  hn: 'Hacker News',
  timeless: 'Timeless',
};
