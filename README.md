# Tell me everything about

Live at [tmea.space](https://tmea.space). MIT licensed.

A home page that finishes your prompt for you. Pick a prompt, type a topic,
press Enter, and it opens in Google AI Mode, Perplexity, ChatGPT, Claude or
wherever you like. Up to six prompts, each with its own destination.

Under the box, **Explore** shows the day's topics as cards, the way Firefox's
new tab once showed Pocket stories. A card is only a topic: it opens with
whichever prompt is selected, in that prompt's engine. Each morning a cron in
the Worker reads Wikipedia's featured feed and the Hacker News front page and
asks Claude to pick the topics and write the cards; everyone gets the same
list.

The page is static and loads from the edge cache with no framework and no web
fonts. Everything lives in the browser's localStorage. Signing in (a link by
email, no password) adds a server copy so the same prompts appear in every
browser you use. No topic ever passes through this server: launching is a
plain redirect from the browser to the engine.

## Layout

| Path | What |
|------|------|
| `public/index.html`, `app.css`, `app.js` | The home page: the sentence, launching, Explore. Vanilla modules, no build. |
| `public/prompts.html`, `prompts.js` | `/prompts`: write and order prompts with a live preview; settings and account. |
| `public/template.js` | What a prompt means: `{}` and named blanks like `{city}` (up to four), and `{today}`, `{month}`, `{year}`, `{language}`, which fill themselves in. |
| `public/sentence.js` | Draws a prompt as the sentence with a box per blank; shared by the home page and the preview. |
| `public/store.js` | State, settings, sync and the account, shared by both pages. Tabs stay in step through the storage event. |
| `public/engines.js` | The destinations. |
| `public/merge.js` | The one merge (per prompt, newest wins, tombstones). Runs in the page and the Worker. |
| `public/explore.js` | Explore cards: links aimed through the selected prompt, hover previews, and the generated covers. |
| `public/categories.js` | Explore's categories and their colours. Shared by the page and the Worker. |
| `src/explore.js` | The daily job: sources, the prompt and schema for Claude, cleaning, and the evergreen fallback list. |
| `public/_headers` | Cache headers: HTML briefly, versioned assets for a year. |
| `extension/` | Browser extension that opens the page in every new tab. See [New tabs](#new-tabs). |
| `scripts/extension-icons.js` | Renders `favicon.svg` to the PNG sizes the extension needs. |
| `scripts/stamp.js` | Stamps `?v=<content hash>` on asset URLs before every deploy so a page never pairs with a stale stylesheet. |
| `src/index.js` | Cloudflare Worker: magic-link sign-in, sessions, one state blob per user. |
| `migrations/` | D1 schema. |
| `test/` | `node --test` over the merge, usage tagging and Explore. |

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

## Explore

Without `ANTHROPIC_API_KEY` the page shows a built-in evergreen list, so
Explore works out of the box. To get a fresh list each day:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
npm run db:migrate                    # adds the explore table
npm run deploy                        # the cron in wrangler.jsonc runs at 05:10 UTC
```

To write today's list right away (first deploy, or after changing the
prompt), use **Write today's list now** on `/admin`, or:

```sh
curl -X POST -H "x-admin-key: $ADMIN_KEY" https://tmea.space/api/admin/explore
```

Locally, put the key in `.dev.vars`, run `npm run dev`, and do the same with
`http://localhost:8787`, or trigger the cron with
`curl "localhost:8787/__scheduled?cron=10+5+*+*+*"` (wrangler dev runs with
`--test-scheduled`). A failed run keeps the previous day's list.

The model is `EXPLORE_MODEL` in `wrangler.jsonc` (default `claude-sonnet-5-5`);
change it and redeploy, or override it for one environment with
`npx wrangler secret put EXPLORE_MODEL`, or locally in `.dev.vars`. One call a
day, roughly 2,000 tokens in and 3,000 out. Covers are drawn in the browser, so there are no images to host.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create tmea           # paste the database_id into wrangler.jsonc
npm run db:migrate
npm run deploy                        # stamps asset versions, then wrangler deploy
```

Then pick ONE way to send the sign-in email and set `MAIL_FROM` in
`wrangler.jsonc` to an address on that domain:

- **Cloudflare Email Service**: `npx wrangler email sending enable <domain>`,
  then uncomment the `send_email` binding in `wrangler.jsonc` and redeploy.
- **Resend**: `npx wrangler secret put RESEND_API_KEY`.

Leave `DEV_LINKS` at `0` in production; with it on, the link is returned to
the page, which is fine on your laptop and not fine on the internet.

## New tabs

Safari can open new tabs on the home page by itself (Settings, General, New
tabs open with: Homepage). Chrome, Edge, Brave and Firefox cannot, so
`extension/` holds a Manifest V3 extension whose new-tab page is tmea.space
in a full-window frame. Two files plus icons; no permissions.

It is a frame rather than a redirect on purpose: a new tab that is still the
extension's own page keeps the browser's focus in the address bar, the way
the built-in new tab does, so typing goes to the address bar and clicking
the sentence goes to tmea. (The page skips its usual autofocus when framed,
`public/app.js`.) One consequence: browsers partition storage by top-level
site, so prompts edited inside a new tab and prompts edited at tmea.space
directly are two local copies; signing in syncs them through the server.

Load it without a store:

- **Chrome, Edge, Brave**: open `chrome://extensions` (`edge://extensions`,
  `brave://extensions`), turn on Developer mode, Load unpacked, pick the
  `extension/` folder. Chrome warns about the `browser_specific_settings`
  key, which is Firefox's; ignore it.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, Load Temporary
  Add-on, pick `extension/manifest.json`. Temporary add-ons last until Firefox
  quits; a permanent install needs the zip signed at addons.mozilla.org.

`npm run extension:pack` writes `tmea-newtab.zip` for the Chrome Web Store or
addons.mozilla.org. `npm run extension:icons` regenerates the PNG icons from
`public/favicon.svg` (only needed if the icon changes).

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

## Usage dashboard

`/admin` shows launches per day and per engine, page loads by people
(Cloudflare's edge analytics with scanners, probes, unfurlers and assets
filtered out by `src/usage.js`, which says how much it dropped), accounts and
sign-ins. It needs two secrets:

```sh
npx wrangler secret put ADMIN_KEY            # what you type into the page
npx wrangler secret put CF_ANALYTICS_TOKEN   # API token with Analytics: Read on the zone
```

`CF_ZONE_TAG` in `wrangler.jsonc` is the zone id. Without the token the
dashboard still shows launches and accounts.

The page counts a launch with one anonymous request carrying the engine name
only. No topic, no id, no cookie.

## Data

The server stores an email address, a session hash, and one JSON blob of
prompts and settings per user. Sign-in links and session ids are stored as
SHA-256 hashes only. "Delete account" in the Prompts sheet removes all of it.
