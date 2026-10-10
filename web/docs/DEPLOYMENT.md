# Deploying QBind Select

The web app is a **fully static site**. There is no server, no database, no API
and no account system. Every calculation runs in the visitor's browser in a Web
Worker. That means any static host will do, and the whole thing works offline
once loaded.

> **NOT CURRENTLY DEPLOYED.** No hosting credentials were available in the
> environment where this was built, so nothing has been published to any domain.
> Everything below is prepared and the production build is verified locally, but
> the live-URL step needs the repository owner's account access. Do not describe
> this site as live until someone has actually run one of the recipes below.

---

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | >= 20 (built and tested on 24.18) | Vite 5 requires 18+; 20 is the LTS baseline used in CI |
| npm | >= 10 (built on 11.16) | lockfile v3 |
| Python | 3.11 | Only needed to regenerate the scoring model, not to build or serve the site |

## Local development

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

If `npm install` warns that `esbuild` has an unapproved install script, run
`npm approve-scripts esbuild && npm rebuild esbuild`. Vite cannot start without
the esbuild binary.

## Generated assets (run automatically, but worth knowing about)

Two build steps generate files that are not committed in full:

| Step | Script | Produces | Runs from |
| --- | --- | --- | --- |
| RDKit runtime | `scripts/sync-rdkit.mjs` | `public/rdkit/RDKit_minimal.{js,wasm}` — copied out of `node_modules`, ~7 MB | `predev`, `prebuild`, `pretest` |
| Landing depiction | `scripts/prerender-depictions.mjs` | `src/generated/depictions.ts` — the reference structure diagram, rendered at build time by the same RDKit build the browser uses | `predev`, `prebuild` |

`src/generated/depictions.ts` **is** committed, because `tsc --noEmit` runs
before `vite build` in CI and would fail without it. `public/rdkit/` is not:
it is a vendored binary that `npm ci` already pins through the lockfile.

The wasm binary is only fetched when a visitor opens a structure the
pre-rendered diagram does not cover, so it is never on the critical path for a
first page view. Hosts that read `public/_headers` get a one-year immutable
cache rule for it; on GitHub Pages, which ignores that file, the browser's own
heuristics apply and the binary is re-validated rather than re-downloaded.

## Production build

```bash
cd web
npm run build        # tsc --noEmit && vite build && node scripts/spa-fallback.mjs
npm run preview      # serve dist/ exactly as a host would
```

Output lands in `web/dist` (about 500 KB total, ~110 KB gzipped JavaScript).
The build fails if TypeScript does not typecheck, so a broken build cannot be
published by accident.

### What the build produces

```
dist/
  index.html                          the app shell
  404.html                            copy of index.html, for GitHub Pages deep links
  model/potts_6class_8mer.json        the scoring coefficients (49 KB)
  assets/index-*.js                   shell + router + state
  assets/react-*.js                   React runtime (separate chunk, cached across deploys)
  assets/<Screen>-*.js                one lazily-loaded chunk per screen
  assets/pipeline.worker-*.js         the computation worker
  assets/index-*.css                  the whole stylesheet
```

## Full verification before publishing

```bash
cd web
npm run verify       # build + full test suite + assertion count
```

This runs the production build, the complete test suite, and prints the measured
executed-assertion count. All three must pass before a deploy is worth making.

---

## The `QBIND_BASE` variable

`vite.config.ts` reads `process.env.QBIND_BASE` and defaults to `/`. Set it when
the site is served from a sub-path rather than a domain root — which is exactly
the GitHub Pages project-site case.

**bash / Git Bash:**

```bash
QBIND_BASE=/your-repo-name/ npm run build
```

**PowerShell:**

```powershell
$env:QBIND_BASE = '/your-repo-name/'
npm run build
Remove-Item Env:\QBIND_BASE      # so a later root build is not silently wrong
```

Getting this wrong is the single most common static-deploy failure: the page
loads but every asset 404s, because the HTML asks for `/assets/...` while the
files actually live at `/your-repo-name/assets/...`.

---

## Routing: why the SPA fallback matters

The app uses **path-based** client routing (`/`, `/build`, `/optimise`,
`/compare`, `/understand`, `/results`) via the History API. There is no hash in
the route, so a visitor who opens `https://host/compare` directly, or refreshes
on it, makes a real HTTP request for `/compare`. A static host has no such file.
Without a fallback that request 404s.

Each host needs its own fix, and all three are already committed:

| Host | Mechanism | File |
| --- | --- | --- |
| Netlify | rewrite rule | `web/public/_redirects` |
| Vercel | rewrite rule | `web/vercel.json` |
| GitHub Pages | 404 page served for unknown paths | generated by `web/scripts/spa-fallback.mjs` |

GitHub Pages has no rewrite engine at all, which is why the build copies
`index.html` to `404.html`. Pages serves that file for any unmatched path, the
app boots, reads `location.pathname`, and renders the right screen. The URL bar
stays correct and the browser's back button works normally.

---

## Option 1 — GitHub Pages

A ready workflow is committed at `.github/workflows/pages.yml`. It has **not
been run**; it requires the repository owner to enable Pages first.

1. In the repository: **Settings → Pages → Build and deployment → Source →
   GitHub Actions**.
2. Push to the default branch, or run the workflow manually from the Actions
   tab.
3. The workflow sets `QBIND_BASE` from the repository name automatically, builds
   `web/`, and publishes `web/dist`.

The site then appears at `https://<owner>.github.io/<repo>/`.

If you prefer to publish from a branch instead of Actions, build locally with
the correct `QBIND_BASE` and push the contents of `web/dist` to a `gh-pages`
branch. Add an empty `.nojekyll` file at its root, or Jekyll will discard the
`assets` directory because of the underscore-prefixed files it sometimes
generates.

## Option 2 — Netlify

Settings, either in the dashboard or `netlify.toml`:

- **Base directory:** `web`
- **Build command:** `npm run build`
- **Publish directory:** `web/dist`
- **Environment:** leave `QBIND_BASE` unset (Netlify serves from the root)

`web/public/_redirects` and `web/public/_headers` are copied into `dist` by Vite
and picked up automatically — the first gives the SPA fallback, the second
applies the Content-Security-Policy described in [SECURITY.md](./SECURITY.md).

## Option 3 — Vercel

- **Root directory:** `web`
- **Framework preset:** Vite
- **Build command:** `npm run build`
- **Output directory:** `dist`

`web/vercel.json` already declares the SPA rewrite and the security headers, so
no dashboard configuration is needed beyond the root directory.

## Option 4 — any other static host

Upload the contents of `web/dist`. Configure two things:

1. Serve `index.html` for any path that does not match a file (SPA fallback).
2. Serve `.json` as `application/json` and `.js` as `text/javascript`. The
   worker will not start if the JavaScript MIME type is wrong.

No other server configuration is required.

---

## What a visitor gets

- **Anonymous.** No sign-up, no login, no account, no email.
- **No backend.** Nothing is sent anywhere. The only network request after load
  is the app fetching its own `model/potts_6class_8mer.json`.
- **No analytics, no tracking, no cookies.** None are present in the bundle;
  `web/docs/SECURITY.md` records how that was checked.
- **Local-only storage.** A single `localStorage` key
  (`qbind-select:prefs:v1`) holds theme, motion, detail level, whether the tour
  was seen, starred designs and saved scenarios. It is re-validated on every
  read and the Results screen has a button that clears it.
- **Offline-capable after first load**, because all computation is client-side.
  No service worker is registered, so a reload still needs the network.

## Verified locally

The production build was served with `vite preview` and checked:

| Check | Result |
| --- | --- |
| `GET /` | 200, 2490 bytes, correct `<title>`, `#root` present |
| `GET /compare` (deep link) | 200 via SPA fallback |
| `GET /model/potts_6class_8mer.json` | 200, 49840 bytes, `application/json` |
| `GET /assets/pipeline.worker-*.js` | 200, 28892 bytes |
| `GET /404.html` | 200 |
| Secret scan of first-party chunks | clean |

## Regenerating the scoring model

The browser's coefficients are generated from the Python benchmark so the two
cannot drift apart:

```bash
py scripts/export_web_model.py
```

That rewrites `web/public/model/potts_6class_8mer.json` and
`web/tests/fixtures/python_golden.json`. Run `npm test` afterwards: the parity
suite compares the browser scorer against 398 recorded Python values to within
1e-9 and fails if the export is stale.
