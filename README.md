# Tell me everything about

A home page that finishes your prompt for you. Pick a prompt, type a topic,
press Enter, and it opens in Google AI Mode, Perplexity, ChatGPT, Claude or
wherever you like. Up to six prompts, each with its own destination.

The page is static and loads from the edge cache with no framework and no web
fonts. Everything lives in the browser's localStorage. Signing in (a link by
email, no password) adds a server copy so the same prompts appear in every
browser you use. No topic ever passes through this server: launching is a
plain redirect from the browser to the engine.

## Layout

| Path | What |
|------|------|
| `public/index.html`, `app.css`, `app.js` | The whole page. Vanilla, one module script. |
| `public/merge.js` | The one merge (per prompt, newest wins, tombstones). Runs in the page and the Worker. |
| `public/_headers` | Cache headers so repeat opens come from the browser cache. |
| `src/index.js` | Cloudflare Worker: magic-link sign-in, sessions, one state blob per user. |
| `migrations/` | D1 schema. |
| `test/` | `node --test` over the merge. |

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars        # DEV_LINKS=1 prints the sign-in link instead of emailing it
npm run db:migrate:local
npm run dev                           # http://localhost:8787
npm test
```

With `DEV_LINKS=1` the sign-in dialog shows an "Open the dev link" link after
you ask for one, so the whole account flow works with no mail provider.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create tmea           # paste the database_id into wrangler.jsonc
npm run db:migrate
npx wrangler deploy
```

Then pick ONE way to send the sign-in email and set `MAIL_FROM` in
`wrangler.jsonc` to an address on that domain:

- **Cloudflare Email Service**: `npx wrangler email sending enable <domain>`,
  then uncomment the `send_email` binding in `wrangler.jsonc` and redeploy.
- **Resend**: `npx wrangler secret put RESEND_API_KEY`.

Leave `DEV_LINKS` at `0` in production; with it on, the link is returned to
the page, which is fine on your laptop and not fine on the internet.

## Engines

Each is a URL with the finished prompt in the query string (`public/app.js`,
`ENGINES`). Google AI Mode is `google.com/search?udm=50&q=`; ChatGPT, Claude,
Perplexity and Grok all accept `?q=` and submit on load. Adding an engine is
one line.

## Sync rules

- A prompt is `{ id, label, template, engine, order, updatedAt }`. `{}` in the
  template marks where the topic goes; without it the topic is appended.
- Two browsers editing the list merge per prompt by `updatedAt`. Deleting
  writes a tombstone so the other browser cannot resurrect the prompt; an edit
  newer than the tombstone wins over the delete. Settings merge whole.
- The three starter prompts have fixed ids and an old stamp so a fresh browser
  never duplicates them and any real edit anywhere beats them.
- A signed-out visitor makes no network request beyond the cached assets. A
  signed-in one calls `/api/me` and `/api/state` after the page has painted.

## Data

The server stores an email address, a session hash, and one JSON blob of
prompts and settings per user. Sign-in links and session ids are stored as
SHA-256 hashes only. "Delete account" in the Prompts sheet removes all of it.
