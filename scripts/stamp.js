// Stamp asset URLs with a content hash so a page and its CSS/JS can never be
// served from different releases. Runs before every deploy; idempotent.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['public/app.css', 'public/app.js', 'public/merge.js'];
const hash = createHash('sha256');
// Hash the sources with any previous stamp stripped, so re-running is a no-op.
for (const f of files) hash.update(readFileSync(f, 'utf8').replace(/\?v=[a-f0-9]+/g, ''));
const v = hash.digest('hex').slice(0, 10);

const targets = ['public/index.html', 'public/about.html', 'public/app.js'];
for (const f of targets) {
  const before = readFileSync(f, 'utf8');
  const after = before.replace(/(\/?(?:app\.css|app\.js|merge\.js))(\?v=[a-f0-9]+)?/g, `$1?v=${v}`);
  if (after !== before) writeFileSync(f, after);
}
console.log(`assets stamped ?v=${v}`);
