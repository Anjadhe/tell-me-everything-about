// Every destination is a plain URL with the whole prompt in the query, so
// no topic ever passes through this app's server. An ai engine reads the
// whole prompt as a question, so a card's context goes with it (context.js).
export const ENGINES = [
  { id: 'google-ai', name: 'Google AI Mode', ai: true, host: 'google.com', url: q => `https://www.google.com/search?udm=50&q=${q}` },
  { id: 'google', name: 'Google Search', host: 'google.com', url: q => `https://www.google.com/search?q=${q}` },
  { id: 'perplexity', name: 'Perplexity', ai: true, host: 'perplexity.ai', url: q => `https://www.perplexity.ai/search?q=${q}` },
  { id: 'chatgpt', name: 'ChatGPT', ai: true, host: 'chatgpt.com', url: q => `https://chatgpt.com/?q=${q}` },
  { id: 'claude', name: 'Claude', ai: true, host: 'claude.ai', url: q => `https://claude.ai/new?q=${q}` },
  { id: 'grok', name: 'Grok', ai: true, host: 'grok.com', url: q => `https://grok.com/?q=${q}` },
  { id: 'duckduckgo', name: 'DuckDuckGo', host: 'duckduckgo.com', url: q => `https://duckduckgo.com/?q=${q}` },
];

export const engineById = id => ENGINES.find(e => e.id === id) || ENGINES[0];
