#!/usr/bin/env node
/**
 * GitHub Pages serves no rewrite rule, so a deep link like /compare 404s.
 * Copying index.html to 404.html makes Pages serve the app for unknown paths,
 * which is the standard static-host workaround. Netlify (_redirects) and Vercel
 * (vercel.json) use real rewrites and ignore this file harmlessly.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '..', 'dist');
const index = resolve(dist, 'index.html');
if (!existsSync(index)) {
  console.error('spa-fallback: dist/index.html is missing; did vite build run?');
  process.exit(1);
}
copyFileSync(index, resolve(dist, '404.html'));
console.log('spa-fallback: wrote dist/404.html for GitHub Pages deep links');
