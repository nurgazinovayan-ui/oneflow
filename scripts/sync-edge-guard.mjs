// Copies the shared blocks into the Edge Functions that use them, between marker lines:
//   supabase/functions/_shared/paid_guard.ts  → every paid function («// ---- Spend guard» …
//                                                «// ---- end of spend guard»)
//   supabase/functions/_shared/admin_check.ts → every admin function («// ---- Admin check» …
//                                                «// ---- end of admin check»)
//
// Why a copy: the functions are deployed by pasting ONE file into Supabase Studio, so they cannot
// import a shared module. The shared file is the only place to edit; this script keeps the copies
// identical.
//
//   node scripts/sync-edge-guard.mjs          rewrite the copies
//   node scripts/sync-edge-guard.mjs --check  exit 1 if any copy differs (for CI / before deploy)
//   --admin-repo <path>                       also the admin page backend (admin-api,
//                                             admin-send-message) in that repo's supabase/functions
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase', 'functions');
export const PAID_FUNCTIONS = [
  'generate-image',
  'generate-video',
  'generate-video-pro',
  'generate-audio',
  'generate-vector',
  'generate-chat',
  'evaluate-creative',
  'marketing-ai',
  'motion-storyboard',
];
export const ADMIN_FUNCTIONS = ['admin-list-online', 'admin-list-generations', 'admin-send-message', 'get-openrouter-balance', 'trendswatch-refresh'];
const ADMIN_REPO_FUNCTIONS = ['admin-api', 'admin-send-message'];

const check = process.argv.includes('--check');
const adminRepoArg = process.argv.indexOf('--admin-repo');
const adminRepo = adminRepoArg > 0 ? process.argv[adminRepoArg + 1] : null;

const blocks = [
  { shared: 'paid_guard.ts', start: /^\/\/ ---- Spend guard/, end: '// ---- end of spend guard', files: PAID_FUNCTIONS.map((n) => [n, join(fnDir, n, 'index.ts')]) },
  {
    shared: 'admin_check.ts',
    start: /^\/\/ ---- Admin check/,
    end: '// ---- end of admin check',
    files: [
      ...ADMIN_FUNCTIONS.map((n) => [n, join(fnDir, n, 'index.ts')]),
      ...(adminRepo ? ADMIN_REPO_FUNCTIONS.map((n) => [`admin-repo/${n}`, join(adminRepo, 'supabase', 'functions', n, 'index.ts')]) : []),
    ],
  },
];

let drift = 0;
for (const block of blocks) {
  const shared = readFileSync(join(fnDir, '_shared', block.shared), 'utf8').trimEnd() + '\n' + block.end;
  for (const [name, file] of block.files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const a = lines.findIndex((l) => block.start.test(l));
    const b = lines.findIndex((l, i) => i > a && l.startsWith(block.end));
    if (a < 0 || b < 0) throw new Error(`${name}: markers for ${block.shared} not found`);
    const current = lines.slice(a, b + 1).join('\n');
    if (current === shared) continue;
    drift++;
    if (check) {
      console.error(`${name}: block differs from _shared/${block.shared}`);
      continue;
    }
    writeFileSync(file, [...lines.slice(0, a), shared, ...lines.slice(b + 1)].join('\n'));
    console.log(`${name}: ${block.shared} block updated`);
  }
}
if (check && drift) process.exit(1);
if (!drift) console.log('shared blocks: all copies in sync');
