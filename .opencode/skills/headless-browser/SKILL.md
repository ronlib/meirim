---
name: headless-browser
description: Use when you need a headless browser to inspect the running app UI — checking the page for browser console errors, JavaScript errors, uncaught exceptions, failed network requests, or taking a screenshot of localhost:3000. Covers `scripts/ui-check.js`, which drives Chrome over the Chrome DevTools Protocol instead of puppeteer or playwright.
---

# Headless Browser UI Checks

Run a headless Chrome against the running client and report JS errors, console output, failed requests and a screenshot. The tool is `scripts/ui-check.js`.

## Quick start

```bash
# 1. Is the client dev server up? Expect 200, not 000.
docker exec meirim-dev sh -c 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/plans/'

# 2. Is there memory headroom for chromium in the container?
docker exec meirim-dev sh -c 'free -m'

# 3a. Enough headroom (>~600MB available): run in the container.
docker exec -w /app meirim-dev node scripts/ui-check.js http://localhost:3000/plans/

# 3b. Not enough: run on the host against the mapped port.
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/ui-check.js http://localhost:3000/plans/
```

If step 1 returns `000`, go to [Trap: the dev server dies on `docker exec`](#trap-the-dev-server-dies-on-docker-exec) before anything else.

## What the tool reports

`scripts/ui-check.js` attaches to Chrome over the raw Chrome DevTools Protocol using `ws` from the repo-root `node_modules`. It deliberately does **not** use puppeteer (see [Why raw CDP](#why-raw-cdp-and-not-puppeteer)).

| Section | CDP source | Notes |
| ------- | ---------- | ----- |
| `UNCAUGHT PAGE ERRORS` | `Runtime.exceptionThrown` | Includes up to 8 stack frames. |
| `CONSOLE ERRORS` / `CONSOLE WARNINGS` | `Runtime.consoleAPICalled` + `Log.entryAdded` | Includes the `url:line:col` origin. |
| `FAILED REQUESTS` | `Network.loadingFailed` | Shows the CDP `errorText`, e.g. `net::ERR_CONNECTION_REFUSED`. Cancelled requests are skipped. |
| `HTTP >= 400` | `Network.responseReceived` | Fetches and truncates the response body via `Network.getResponseBody`. |
| `IMAGE RESPONSES BY HOST` | `Network.responseReceived` | Image counts grouped by host, `data:` bucketed separately. |
| `LEAFLET MAPS` | DOM eval | Per `.leaflet-container`: size, `backgroundColor`, tile-pane layer count, each tile's `src` / `complete` / `naturalWidth`, plus non-tile images. This app renders many maps, so this is usually the most informative section. |
| `SNAPSHOT` | DOM eval | `title`, `url`, leaflet container count, broken images vs total images, first 300 chars of visible text. |
| Screenshot | `Page.captureScreenshot` | Written to `scripts/ui-check.png`. |

`scripts/ui-check.png` is a regenerated artifact and is overwritten on every run. Do not treat it as source.

### Arguments and environment

Usage: `node scripts/ui-check.js [url]`. The URL defaults to `http://localhost:3000/plans/`.

| Env var | Default | Purpose |
| ------- | ------- | ------- |
| `CHROME_PATH` | `/usr/bin/chromium` | Chrome/chromium binary. Override on the host. |
| `CDP_PORT` | `9333` | Remote debugging port. |
| `UI_CHECK_WAIT` | `15000` | Settle time in ms after navigation. |
| `REPO_ROOT` | resolved from the script path | Where `node_modules/ws` and the screenshot output live. |

Raise `UI_CHECK_WAIT` for pages that lazy-load, paginate or fetch maps late:

```bash
docker exec -w /app -e UI_CHECK_WAIT=30000 meirim-dev node scripts/ui-check.js http://localhost:3000/plans/
```

## Preferred: run inside the container

Per `.opencode/skills/run-in-docker/SKILL.md`, node commands belong inside the running `meirim-dev` container, where chromium is already installed at `/usr/bin/chromium`:

```bash
docker exec -w /app meirim-dev node scripts/ui-check.js http://localhost:3000/plans/
```

## Trap: the dev server dies on `docker exec`

Create React App's `start.js` registers a `process.stdin.on('end')` handler that closes the dev server and calls `process.exit()`. `docker exec` **without** `-i` hands the process an already-closed stdin, so the server prints `Starting the development server...` and then exits **with code 0** seconds later. It looks identical to a silent crash or an OOM kill. The tell is **exit code 0 with no error output**.

Wrong — dies immediately:

```bash
docker exec -d -w /app meirim-dev npm start --prefix client
```

Right — `CI=true` makes CRA skip the stdin-end handler:

```bash
docker exec -d -w /app \
  -e NODE_OPTIONS=--openssl-legacy-provider \
  -e BROWSER=none \
  -e CI=true \
  -e HOST=0.0.0.0 \
  meirim-dev sh -c 'npm start --prefix client > /tmp/client-dev.log 2>&1'
```

`docker exec -i` also keeps stdin open, but `CI=true` is the practical choice for a detached long-running server.

### Waiting for the compile

The client dev server takes roughly **60-120 seconds** to compile before port 3000 answers. Poll, do not assume:

```bash
docker exec meirim-dev sh -c 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/plans/'
```

Watch progress and compile errors:

```bash
docker exec meirim-dev sh -c 'tail -30 /tmp/client-dev.log'
```

### Confirming the dev server is not running

Two independent signals:

```bash
# Nothing printed => no dev server process
docker exec meirim-dev sh -c 'ps aux | grep "[r]eact-app-rewired"'

# 000 => nothing listening on port 3000
docker exec meirim-dev sh -c 'curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/plans/'
```

## Trap: chromium and webpack-dev-server do not fit in memory together

The Docker VM has only ~2GB total:

```bash
docker info --format '{{.MemTotal}}'
```

`webpack-dev-server` alone sits at roughly **1.35GB**. Launching chromium in the same container pushes past the limit and the **dev server gets OOM-killed**. The browser report then shows `net::ERR_CONNECTION_REFUSED` on the document, which misleadingly looks like an app bug.

Check headroom before launching chromium in the container:

```bash
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}'
docker exec meirim-dev sh -c 'free -m'
```

If available memory is under roughly **600MB**, do not launch chromium inside the container.

### Fallback: run on the host

The container publishes port 3000, so `http://localhost:3000` resolves from the host. Point `CHROME_PATH` at a local Chrome:

```bash
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/ui-check.js http://localhost:3000/plans/
```

The real remedy is to raise the Docker Desktop memory allocation so chromium and webpack can coexist. The host fallback is a workaround.

## Why raw CDP and not puppeteer

The host fallback is only possible because the script avoids puppeteer:

- The repo's puppeteer is `22.6.5` (in `server/node_modules`). It pulls an `@puppeteer/browsers` that depends on an old `yargs` whose extensionless `yargs` entry file breaks modern Node's ESM resolution. On the host's Node v26 it throws `ReferenceError: require is not defined in ES module scope`.
- Puppeteer's bundled chromium is a Linux build, unusable on macOS.

Raw CDP over `ws` works on every Node version we have, in the container and on the host, so one script serves both. Do not "modernise" it to puppeteer or playwright.

## Interpreting results

| Symptom | Meaning |
| ------- | ------- |
| `net::ERR_CONNECTION_REFUSED` on the document | The dev server died. See the stdin-EOF and memory traps above. Not a code bug. |
| `403 /api/me` | Expected while logged out. Not a bug. |
| Uniform pale-blue map, tiles present | Leaflet tile URLs encode location. A tile path of `/17/65535/65535.png` is lat 0 / lng 0 — "Null Island" — i.e. the geometry is `[0,0]` ocean, **not** a tile-loading failure. Confirm tiles actually loaded via `complete: true` and `naturalWidth: 256` in the `LEAFLET MAPS` dump. This exact bug was found on `/plans/`. |
| Image `src` like `data:image/png;base64,...")marker-icon.png` with `ERR_INVALID_URL` | Leaflet 1.7's `_detectIconPath` breaks when webpack inlines the marker PNG as a data URI. Known Leaflet + webpack issue, not a network problem. |
| Hotjar errors about the user agent | Hotjar refuses to run under a `HeadlessChrome` UA. Third-party noise. |
| `You have included the Google Maps JavaScript API multiple times`, plus dozens of `Element with name "gmp-*" already defined` warnings | A real app bug, not noise. `client/src/services/location-autocomplete.js` guards on `window.google`, which is only set *after* the script loads, so concurrent `init()` calls both inject a `<script>`. Both `scenes/Plans.jsx` and `pages/Homepage/SearchBox.jsx` call `init()` on mount and Plans renders SearchBox. |
| Material-UI deprecation notices | Third-party noise. |

Always separate real app errors from third-party noise before reporting. Stack frames pointing into `client/src` are ours; frames in `static.hotjar.com`, `maps.googleapis.com` or `node_modules` usually are not.
