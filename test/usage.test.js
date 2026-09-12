import test from 'node:test';
import assert from 'node:assert/strict';
import { isHumanUA, classifyDay, lastDays } from '../src/usage.js';

const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0';

test('real browsers count', () => {
  for (const ua of [chrome, iphone, firefox]) assert.equal(isHumanUA(ua), true, ua);
});

test('scanners, probes, unfurlers and our own test runs do not', () => {
  const bots = [
    'vercel-fetch', 'okhttp/5.3.0', 'curl/8.4.0', 'Twitterbot/1.0', 'python-requests/2.31',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '',
  ];
  for (const ua of bots) assert.equal(isHumanUA(ua), false, ua);
});

test('classifyDay keeps page loads by people and reports what it dropped', () => {
  const r = classifyDay([
    { userAgent: chrome, clientRequestPath: '/', clientCountryName: 'US', count: 5 },
    { userAgent: iphone, clientRequestPath: '/about', clientCountryName: 'IN', count: 2 },
    { userAgent: chrome, clientRequestPath: '/app.js', clientCountryName: 'US', count: 5 },
    { userAgent: 'okhttp/5.3.0', clientRequestPath: '/', clientCountryName: 'DE', count: 40 },
    { userAgent: chrome, clientRequestPath: '/robots.txt', clientCountryName: 'US', count: 1 },
  ]);
  assert.equal(r.human, 7);
  assert.equal(r.filtered, 46);
  assert.equal(r.droppedAssets, 6);
  assert.equal(r.droppedBots, 40);
  assert.deepEqual(r.countries, [{ name: 'US', n: 5 }, { name: 'IN', n: 2 }]);
  assert.equal(r.browsers, 2);
});

test('lastDays ends today in UTC', () => {
  const d = lastDays(3, new Date('2026-09-11T23:30:00Z'));
  assert.deepEqual(d, ['2026-09-09', '2026-09-10', '2026-09-11']);
});
