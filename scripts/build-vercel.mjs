// Vercel build for oneflow.art — one project, one domain:
//   /     → the landing (landing/index.html, a self-contained page)
//   /app  → the web app (Vite's index.html, renamed to app.html; vercel.json cleanUrls serves it at /app)
// App assets keep their root paths (/assets, /onelaunch-templates, /avatars, …), so nothing in the app moves.
import { copyFileSync, existsSync, renameSync } from 'node:fs';
import { execSync } from 'node:child_process';

// .env.web holds only publishable keys (see .env.web.example). Vercel has no .env.web, so fall back to
// the example; variables set in the Vercel dashboard still win — Vite never overrides existing env vars.
if (!existsSync('.env.web')) copyFileSync('.env.web.example', '.env.web');

execSync('npm run build:web', { stdio: 'inherit' });
renameSync('dist/index.html', 'dist/app.html');
copyFileSync('landing/index.html', 'dist/index.html');
console.log('oneflow.art: landing → dist/index.html, app → dist/app.html (/app)');
