# Frontend unit tests (Vitest)

T-209 / CODE-AUDIT D.9 #2.

## What this is

A minimal Vitest scaffold for unit-testing the `.jsx` files in `src/`. The frontend uses a no-build script-tag-loading model — each file declares top-level consts and ends with `Object.assign(window, {...})` — so vanilla `import { X } from '...'` won't work. The scaffold provides a `loadJsx()` helper that reads a `.jsx` file as text, transforms it via esbuild, evaluates it in a sandbox where `window` is a fresh object, and returns the window-exported names.

## Run

```
cd test-frontend
npm install
npm test
```

Watch mode:

```
npm run test:watch
```

## What's covered today

Two starter tests, both targeting pure formatter functions to validate the scaffold works end-to-end before scaling up:

- `tests/formatINR.test.js` — 13 cases against `src/r11-additions.jsx:formatINR`
- `tests/inrCompact.test.js` — 10 cases against `src/primitives.jsx:inrCompact`

## How to add a new test

```js
import { describe, it, expect } from 'vitest';
import { loadJsx } from '../lib/load-jsx.js';

const myModule = loadJsx('src/screen-foo.jsx');
const { MyComponent, helperFn } = myModule;

describe('helperFn', () => {
  it('does the thing', () => {
    expect(helperFn('x')).toBe('X');
  });
});
```

For component tests you'll also need `@testing-library/react` — not added in this scaffold to keep the dep surface small. Add it when you write the first component test.

## CI integration

Not wired yet. Verify locally first, then add a step to `.github/workflows/ci.yml`:

```yaml
- name: Frontend unit tests
  working-directory: test-frontend
  run: |
    npm install --silent --no-audit --no-fund
    npm test
```

Initially with `continue-on-error: true` until the scaffold is proven stable, then flip to blocking.

## Why not just refactor source to use ES modules?

That would mean adding `export const X` to every `.jsx` file plus updating `app.html` to load them as `<script type="module">`. Big diff, deploy-risky, and the script-tag model has been deliberate (no build step, debuggable raw source in browser devtools — see `deploy/build/transform.js:11-12`).

The `loadJsx()` shim is the cheaper bridge that lets us test without touching production source.

## Known limitations

- Files with heavy side-effects on load (e.g. starting an interval, mutating `document`) will run those side-effects during test load. None of the files tested today do that; if you add tests for `app.jsx` or `live-ticks.jsx` you may need to mock those globals.
- The transform handles JSX but not TypeScript. The codebase is plain JS+JSX, so no impact today.
- Cross-file dependencies (e.g. `screen-paper.jsx` reading `window.PrimitivesX`) will be `undefined` because each test loads ONE file in isolation. For tests that need primitives, load both files in the test.
