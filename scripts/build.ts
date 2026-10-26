import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const outdir = join(root, 'dist', 'public');
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(outdir, 'assets'), { recursive: true });
mkdirSync(join(outdir, 'styles'), { recursive: true });

const commonBuild = {
  outdir: join(outdir, 'assets'),
  target: 'browser' as const,
  minify: true,
  sourcemap: 'linked' as const,
  splitting: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  jsx: { runtime: 'automatic' as const, importSource: 'preact' },
};
const clientResult = await Bun.build({ ...commonBuild, entrypoints: [join(root, 'src/client/main.tsx')], naming: 'main-[hash].[ext]' });
const adminResult = await Bun.build({ ...commonBuild, entrypoints: [join(root, 'src/client/admin/main.tsx')], naming: 'admin-[hash].[ext]' });
for (const result of [clientResult, adminResult]) {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}
const mainJs = clientResult.outputs.filter((o) => o.path.endsWith('.js')).map((o) => basename(o.path))[0];
const adminJs = adminResult.outputs.filter((o) => o.path.endsWith('.js')).map((o) => basename(o.path))[0];
if (!mainJs?.startsWith('main-') || !adminJs?.startsWith('admin-')) throw new Error('unexpected bundle outputs: ' + [...clientResult.outputs, ...adminResult.outputs].map((o) => basename(o.path)).join(','));

cpSync(join(root, 'src/assets'), join(outdir, 'assets'), { recursive: true });

const styleOrder = ['base.css', 'components.css', 'app.css', 'chat.css', 'landing.css', 'settings.css'];
let slopCss = '';
for (const f of styleOrder) slopCss += `\n/* ==== ${f} ==== */\n` + readFileSync(join(root, 'src/client/styles', f), 'utf8');
const adminExtra = existsSync(join(root, 'src/client/styles/admin.css')) ? readFileSync(join(root, 'src/client/styles/admin.css'), 'utf8') : '';
writeFileSync(join(outdir, 'styles', 'slop.css'), slopCss);
writeFileSync(join(outdir, 'styles', 'admin.css'), slopCss + '\n' + adminExtra);
const cssHash = createHash('sha256').update(slopCss + adminExtra).digest('hex').slice(0, 10);

const sharedHead = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#171021" />
  <meta name="referrer" content="no-referrer" />
  <link rel="icon" href="/static/assets/brand/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/static/styles/slop.css?v=${cssHash}" />`;

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const metaCsp = contentSecurityPolicy.replace("; frame-ancestors 'none'", '');

const indexHtml = `<!doctype html>
<html lang="en" data-theme="slop">
<head>
  ${sharedHead}
  <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />
  <title>AISlopMemeCord — Discord, but slop</title>
  <meta name="description" content="A privacy-first, single-container Discord clone built entirely out of AI slop. Servers, voice, forums, DMs and absolutely no adult supervision." />
  <meta property="og:title" content="AISlopMemeCord" />
  <meta property="og:description" content="Discord, but it fell into the slop pit. Privacy-first, meme-native, one Docker container." />
  <meta property="og:image" content="/static/assets/brand/og.svg" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
</head>
<body>
  <div id="app-root"></div>
  <noscript><div style="padding:2rem;font-family:monospace">This chat app requires JavaScript. The slop cannot compile itself.</div></noscript>
  <script type="module" src="/static/assets/${mainJs}"></script>
</body>
</html>`;

const adminHtml = `<!doctype html>
<html lang="en" data-theme="corporate">
<head>
  ${sharedHead}
  <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />
  <title>Slop Control — AISlopMemeCord Admin</title>
  <meta name="robots" content="noindex,nofollow" />
</head>
<body data-admin="1">
  <div id="admin-root"></div>
  <script type="module" src="/static/assets/${adminJs}"></script>
</body>
</html>`;

writeFileSync(join(outdir, 'index.html'), indexHtml);
writeFileSync(join(outdir, 'admin.html'), adminHtml);
console.log(`built ${mainJs}, ${adminJs}, css ${cssHash}`);
