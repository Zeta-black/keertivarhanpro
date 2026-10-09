# Security review — QBind Select web app

Reviewed against the committed state of `web/`. Every number below was produced
by running the stated command, not estimated.

## Summary

| Area | Status |
| --- | --- |
| Known vulnerabilities, production dependencies | **0** |
| Known vulnerabilities, including dev dependencies | **0** |
| Secrets, tokens or credentials in the bundle | none |
| Outbound network calls | one, to the app's own `model/potts_6class_8mer.json` |
| Third-party scripts, fonts, styles, images, analytics | none |
| Cookies | none |
| Server-side attack surface | none — the site is static |
| Untrusted input surface | the URL hash and `localStorage`, both strictly validated |

## Dependency audit

```
$ npm audit --omit=dev
found 0 vulnerabilities

$ npm audit
found 0 vulnerabilities
```

This required a deliberate toolchain upgrade. The versions originally installed
carried six advisories, **all of them in dev-only tooling** that never reaches a
visitor (Vite's dev server, esbuild's dev server CORS handling, and
Vitest/tinypool prototype-pollution-to-RCE). Production dependencies were clean
throughout. They were nevertheless resolved rather than documented-and-left,
because a developer running the test suite was genuinely exposed:

| Package | Was | Now |
| --- | --- | --- |
| `vite` | 5.4.21 (1 high, 1 moderate) | 7.3.x (clean) |
| `vitest` | 2.1.9 (2 critical, 2 moderate) | 5.0.x (clean) |
| `@vitejs/plugin-react` | 4.3.x | 5.2.x |
| `esbuild` | 0.21.5 (moderate) | 0.28.2 (clean) |

Both are major-version upgrades, so the full suite and the production build were
re-run afterwards: 816 tests pass and the build is clean.

### Runtime dependency surface

```
$ npm ls --omit=dev --depth=1
qbind-select-web@1.0.0
+-- react@18.3.1
`-- react-dom@18.3.1
    +-- loose-envify@1.4.0
    +-- react@18.3.1 deduped
    `-- scheduler@0.23.2
```

Two runtime packages. `framer-motion` was removed during this review: it was
declared as a dependency but **never imported** — every animation in the app is
a CSS transition or the canvas draw loop. Removing it deleted a 7.6 KB chunk and
one supply-chain dependency for zero functional change.

Charts, the 3D hero and the router are all hand-written rather than pulled from
libraries, which is why the runtime tree is this small.

## Content-Security-Policy

The app loads no external resource of any kind, so it can run under a strict
policy. Both host configs are committed and apply it:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none'
```

Two directives need justifying rather than hand-waving:

- **`style-src 'unsafe-inline'`** is required because chart geometry, bar widths,
  slider fill percentages and class colours are set through inline `style`
  attributes computed from data. Those are numbers and CSS custom-property
  references, never strings from user input or the network, so the usual
  injection route is absent — but the directive is still a real relaxation and
  is called out here rather than buried. Eliminating it would mean moving to
  nonce-based inline styles or a per-value class system; neither is worth the
  complexity at this size, but both are the path if the policy must harden.
- **`worker-src blob:`** is required because Vite's module-worker output is
  instantiated from a blob URL in some browsers. Without it the computation
  worker fails to start and every score disappears.

Also set, on both hosts:

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()
```

| Host | File |
| --- | --- |
| Netlify | `web/public/_headers` |
| Vercel | `web/vercel.json` |
| GitHub Pages | not supported — Pages cannot set response headers. Add a `<meta http-equiv="Content-Security-Policy">` tag to `index.html` if Pages is the target, accepting that `frame-ancestors` and `X-Frame-Options` cannot be enforced that way. |

## Untrusted input

There are exactly two places where data the app did not generate enters it.

### 1. The URL hash

A shared design arrives as `#s=23002212&l=1`. It is parsed by `parseShareState`
in `src/state/persistence.ts`, which:

- never throws — the whole body is wrapped, and a parse failure returns defaults
  with a human-readable note rather than breaking the first paint;
- requires `s` to match `/^[0-5]{8}$/` exactly, then re-validates the result
  through `isValidCodes`, so an out-of-range class index cannot reach the scorer;
- requires `l` to be a finite number within `[0, 5]`;
- returns structured errors for anything else, which the app logs and ignores.

It is fuzzed with 400+ hostile inputs in
`tests/science/surrogate-and-io.test.ts`, including oversized payloads, script
tags, null bytes, unicode, duplicate keys, `1e999`, and `__proto__` /
`constructor[prototype]` pollution attempts. Every case asserts that the return
shape is valid, that `codes` is either `null` or a valid 8-length array, and
that `Object.prototype` was not polluted.

Three further cases in `tests/ui/screens.test.tsx` drive malformed hashes
through the real app and assert it renders normally.

### 2. localStorage

One key, `qbind-select:prefs:v1`, holding theme, motion, detail level, tour
state, starred designs and saved scenarios. It is treated as untrusted on every
read, because a user or an extension can edit it freely:

- `loadPreferences` validates each field against an allow-list of literal values
  and falls back to defaults on anything unexpected;
- `sanitiseFavourites` and `sanitiseScenarios` re-validate every entry's codes
  and lambda, truncate names and ids, and cap list lengths;
- every access is wrapped in `try/catch`, because `localStorage` throws outright
  in private windows, with site data blocked, and in some preview contexts.

Also fuzzed in the same suite.

## What is not stored and not sent

Verified by grep over the first-party chunks of a production build:

```
$ grep -rilE "DWAVE_API_TOKEN|api[_-]?key|secret|password|Bearer " \
    dist/assets/index-*.js dist/assets/pipeline.worker-*.js dist/assets/*-*.js
(no first-party match)
```

The only matches anywhere in `dist` are inside React's own vendor chunk —
`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` and React's list of input
types, which includes `password`. Neither is a credential.

The repository root has a `.env.example` containing `DWAVE_API_TOKEN=`. That is
read **only** by the Python benchmark's optional D-Wave path
(`src/qbind_select/solvers/dwave_solver.py`). Nothing under `web/` references
`.env`, `process.env` (beyond `QBIND_BASE` at build time), or any token:

```
$ grep -rn "process.env" web/src web/vite.config.ts
web/vite.config.ts:  base: process.env.QBIND_BASE ?? '/',
```

No analytics SDK, no error-reporting service, no font CDN, no telemetry. The
only `console` output is a local `console.error` in the error boundary and a
`console.warn` for a malformed share link.

## Client-side resource safety

The worker allocates three `Float64Array(1679616)` buffers — about 40 MB — for a
full live run. That allocation is wrapped: on failure the worker posts a
non-fatal error explaining the device could not allocate it, and the UI says so
instead of crashing. Device capability is detected up front
(`src/state/capability.ts`) and the annealing and surrogate workloads are scaled
down on low-core or low-memory devices.

The 3D hero stops its animation loop when scrolled out of view or when the tab
is hidden, caps device-pixel-ratio at 2, and falls back to a static SVG on
reduced-motion or low-tier devices. A runaway render loop is the main way a
client-side app becomes a battery denial-of-service, so this is deliberate.

## Residual risks, stated plainly

1. **`style-src 'unsafe-inline'`** remains, for the reason above.
2. **GitHub Pages cannot enforce the CSP**, because it serves no custom headers.
   Netlify or Vercel should be preferred if the policy matters.
3. **No Subresource Integrity**, because there are no external resources to pin.
4. **No service worker**, so there is no offline cache to poison — but also no
   offline reload.
5. **The honesty claims are enforced by tests, not by the type system.** A
   future edit could remove a disclaimer; the persona-review and UI suites fail
   if it does, which is the safeguard.

## How to re-run this review

```bash
cd web
npm audit --omit=dev            # production surface
npm audit                       # including tooling
npm ls --omit=dev --depth=1     # runtime tree
npm run build
grep -rilE "api[_-]?key|secret|token|Bearer " dist/assets/*.js
npm test                        # includes the input-fuzzing suites
```
