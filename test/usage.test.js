import test from 'node:test';
import assert from 'node:assert/strict';
import { isHumanUA, browserFamily, requestKind, deviceKind, tagRows, lastDays } from '../src/usage.js';

const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:148.0) Gecko/20100101 Firefox/148.0';
const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 Edg/144.0.0.0';

test('real browsers are people', () => {
  for (const ua of [chrome, iphone, firefox, edge]) assert.equal(isHumanUA(ua), true, ua);
});

test('scanners, probes, unfurlers and headless runs are not', () => {
  const bots = [
    'vercel-fetch', 'okhttp/5.3.0', 'curl/8.4.0', 'Twitterbot/1.0', 'python-requests/2.31',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '',
  ];
  for (const ua of bots) assert.equal(isHumanUA(ua), false, ua);
});

test('browser family and device', () => {
  assert.equal(browserFamily(chrome), 'Chrome');
  assert.equal(browserFamily(iphone), 'Safari');
  assert.equal(browserFamily(firefox), 'Firefox');
  assert.equal(browserFamily(edge), 'Edge');
  assert.equal(browserFamily('okhttp/5.3.0'), 'Not a browser');
  assert.equal(deviceKind(iphone), 'Phone');
  assert.equal(deviceKind(chrome), 'Desktop');
  assert.equal(deviceKind('curl/8'), 'None');
});

test('request kind by path', () => {
  assert.equal(requestKind('/'), 'page');
  assert.equal(requestKind('/about'), 'page');
  assert.equal(requestKind('/app.js'), 'asset');
  assert.equal(requestKind('/api/state'), 'api');
  assert.equal(requestKind('/auth/verify'), 'api');
  assert.equal(requestKind('/robots.txt'), 'other');
  assert.equal(requestKind('/wp-login.php'), 'other');
});

test('tagRows keeps every row and every count', () => {
  const rows = tagRows([
    { userAgent: chrome, clientRequestPath: '/', clientCountryName: 'US', count: 5 },
    { userAgent: 'okhttp/5.3.0', clientRequestPath: '/', clientCountryName: 'DE', count: 40 },
    { userAgent: chrome, clientRequestPath: '/app.js', clientCountryName: 'US', count: 5 },
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((a, r) => a + r.n, 0), 50);
  assert.deepEqual(rows.map(r => [r.who, r.what]), [['person', 'page'], ['not-person', 'page'], ['person', 'asset']]);
  assert.equal(rows[0].browser, 'Chrome');
  assert.equal(rows[1].browser, 'Not a browser');
});

test('lastDays ends today in UTC', () => {
  const d = lastDays(3, new Date('2026-09-11T23:30:00Z'));
  assert.deepEqual(d, ['2026-09-09', '2026-09-10', '2026-09-11']);
});
