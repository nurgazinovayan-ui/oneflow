// Vercel build for oneflow.art — one project, one domain:
//   /     → the landing in English (landing/index.html, a self-contained page); /ru → the Russian one (landing/ru.html)
//   /app  → the web app (Vite's index.html, renamed to app.html; vercel.json cleanUrls serves it at /app)
//   /admin → the admin panel (landing/admin.html; security headers for it are in vercel.json)
// landing/index.html, landing/admin.html and public/oneflow-promo.* are built in the marketing repo
// (test_ayan: landing/build_vercel.py copies them here), so a git deploy matches the uploaded zip.
// App assets keep their root paths (/assets, /onelaunch-templates, /avatars, …), so nothing in the app moves.
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// .env.web holds only publishable keys (see .env.web.example). Vercel has no .env.web, so fall back to
// the example; variables set in the Vercel dashboard still win — Vite never overrides existing env vars.
if (!existsSync('.env.web')) copyFileSync('.env.web.example', '.env.web');

execSync('npm run build:web', { stdio: 'inherit' });
renameSync('dist/index.html', 'dist/app.html');
copyFileSync('landing/index.html', 'dist/index.html');
if (existsSync('landing/ru.html')) copyFileSync('landing/ru.html', 'dist/ru.html');
copyFileSync('landing/admin.html', 'dist/admin.html');
// The uploaded site zip is the dist folder itself: it needs the routing and security headers of
// vercel.json, but not the build settings (a prebuilt upload must not try to build again).
const { installCommand: _i, buildCommand: _b, outputDirectory: _o, framework: _f, ...siteConfig } = JSON.parse(readFileSync('vercel.json', 'utf8'));
writeFileSync('dist/vercel.json', JSON.stringify(siteConfig, null, 2) + '\n');
console.log('oneflow.art: landing → dist/index.html (+ ru.html), app → dist/app.html (/app), admin → dist/admin.html (/admin)');
