/**
 * Boot a throwaway AISlopMemeCord instance, exercise the real UI, and write documentation screenshots.
 * Requires a local Chromium; set SLOP_CHROMIUM to override the executable path.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, createRuntime } from '../src/server/app';

const root = process.cwd();
const shots = join(root, 'screenshots');
mkdirSync(shots, { recursive: true });
for (const file of readdirSync(shots)) if (file.endsWith('.png')) unlinkSync(join(shots, file));

const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode !== 0) throw new Error('build failed');

const dataDir = mkdtempSync(join(tmpdir(), 'slop-shots-'));
const runtime = createRuntime({
  dataDir, port: 0, host: '127.0.0.1', staticDir: join(root, 'dist/public'),
  demoSeed: true, registration: 'open', rateLimit: false,
});
const { server, stop } = startServer(runtime);
const base = `http://127.0.0.1:${server.port}`;

function chromiumPath(): string {
  if (process.env.SLOP_CHROMIUM) return process.env.SLOP_CHROMIUM;
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(p)) return p;
  try { return chromium.executablePath(); } catch { throw new Error('Chromium not found. Install it or set SLOP_CHROMIUM.'); }
}

const browser = await chromium.launch({
  executablePath: chromiumPath(), headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

const consoleProblems: string[] = [];
function watch(page: Page, label: string) {
  page.on('pageerror', (e) => consoleProblems.push(`${label} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() === 404) console.log('404', label, r.url()); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (text.includes("frame-ancestors' is ignored")) return;
    consoleProblems.push(`${label} console: ${text}`);
  });
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(shots, name), fullPage, animations: 'disabled' });
  console.log('shot', name);
}

async function bootAdmin(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  watch(page, 'admin-page');
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.landing-title');
  await shot(page, '01-landing.png', true);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.locator('input[autocomplete=username]').fill('bossman');
  await page.locator('input[autocomplete=new-password]').fill('password123');
  await page.getByRole('button', { name: /Create my slop account/ }).click();
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot(page, '02-home.png');
  return { context, page };
}

interface ExtraUser { context: BrowserContext; page: Page; username: string; userId: string }
async function makeExtraUser(username: string, displayName: string, status: string, messages: { general?: string; reply?: boolean } = {}): Promise<ExtraUser> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  watch(page, username);
  const res = await context.request.post(base + '/api/auth/register', { data: { username, displayName, password: 'password123' } });
  if (!res.ok()) throw new Error(`register ${username}: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  const userId = body.user.id;
  const csrf = body.csrfToken ?? '';
  await context.setExtraHTTPHeaders({ 'x-csrf-token': csrf });
  await context.request.post(base + '/api/invites/slop-pit', { data: {} });
  await context.request.put(base + '/api/users/@me/presence', { data: { status, customStatus: displayName === 'Lore Keeper' ? 'writing fanfic about the goblin' : 'touching grass (lie)' } });
  const servers = await context.request.get(base + '/api/servers');
  const serverId = (await servers.json()).servers[0].id;
  const detail = await context.request.get(base + `/api/servers/${serverId}`);
  const channels = (await detail.json()).channels;
  const generalId = channels.find((c: any) => c.name === 'general')?.id;
  await page.goto(`${base}/channels/${serverId}/${generalId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (messages.general) await context.request.post(base + `/api/channels/${generalId}/messages`, { data: { content: messages.general } });
  return { context, page, username, userId };
}

let admin: { context: BrowserContext; page: Page } | null = null;
let extras: ExtraUser[] = [];
let extrasContexts: BrowserContext[] = [];
try {
  admin = await bootAdmin();
  const adminPage = admin.page;
  const adminRequest = admin.context.request;
  const me = await (await adminRequest.get(base + '/api/auth/me')).json();
  await admin.context.setExtraHTTPHeaders({ 'x-csrf-token': me.csrfToken ?? '' });
  await adminRequest.put(base + '/api/users/@me/presence', { data: { status: 'online', customStatus: 'running the pit (badly)' } });
  const servers = await (await adminRequest.get(base + '/api/servers')).json();
  const serverId = servers.servers[0].id;
  const detail = await (await adminRequest.get(base + `/api/servers/${serverId}`)).json();
  const general = detail.channels.find((c: any) => c.name === 'general');
  const shitpost = detail.channels.find((c: any) => c.name === 'shitpost');
  const forum = detail.channels.find((c: any) => c.type === 'forum');
  const voice = detail.channels.find((c: any) => c.type === 'voice');
  const dm = (await (await adminRequest.get(base + '/api/dms')).json()).channels.find((d: any) => d.type === 'dm');

  extras.push(await makeExtraUser('pixelgoblin', 'Pixel Goblin', 'online', { general: 'new here. is the goblin real or just a metaphor for the state of the internet?' }));
  extras.push(await makeExtraUser('lorekeeper', 'Lore Keeper', 'idle', { general: 'both. that is the beauty of it. also I made a 14-page lore doc for this server.' }));
  extras.push(await makeExtraUser('grasstoucher', 'Grass Toucher', 'dnd'));
  extrasContexts = extras.map((e) => e.context);

  const extraRequest = extras[0]!.context.request;
  const generalMessages = await (await extraRequest.get(base + `/api/channels/${general.id}/messages`)).json();
  const last = generalMessages.messages[generalMessages.messages.length - 1];
  if (last) {
    await extraRequest.post(base + `/api/messages/${last.id}/reactions/%F0%9F%94%A5`, { data: {} });
    await extraRequest.put(base + `/api/messages/${last.id}/vote`, { data: { value: 1 } });
  }
  const sticker = (await (await extraRequest.get(base + `/api/servers/${serverId}/stickers`)).json()).stickers?.find((s: any) => s.name.startsWith('Touch'));
  if (sticker) await extras[2]!.context.request.post(base + `/api/channels/${general.id}/messages`, { data: { content: '', stickerId: sticker.id } });

  await adminPage.locator('[title="The Slop Pit"]').click();
  await adminPage.waitForTimeout(800);
  await adminPage.locator('.channel-item', { hasText: 'general' }).click();
  await adminPage.waitForTimeout(1400);
  const messageCount = await adminPage.locator('.message').count();
  if (messageCount < 5) throw new Error(`expected seeded chat messages, got ${messageCount}`);
  if (!(await adminPage.locator('.poll-card').count())) throw new Error('seeded poll did not render');
  const broken = await adminPage.locator('.msg-content img').evaluateAll((els) => els.filter((e: any) => !e.naturalWidth).map((e: any) => e.getAttribute('src')));
  if (broken.length) throw new Error('broken images: ' + broken.join(','));
  await shot(adminPage, '03-chat.png');

  await adminPage.locator('.channel-item', { hasText: 'shitpost' }).click();
  await adminPage.waitForTimeout(900);
  await adminPage.locator('.messages-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await shot(adminPage, '04-shitpost.png');

  await extras[2]!.page.goto(`${base}/channels/${serverId}/${forum.id}`, { waitUntil: 'networkidle' });
  await adminPage.locator('.channel-item', { hasText: 'slop-board' }).click();
  await adminPage.waitForTimeout(900);
  await shot(adminPage, '05-forum.png');

  await adminPage.locator('.forum-post').first().click();
  await adminPage.waitForTimeout(900);
  await shot(adminPage, '06-thread.png');

  await adminPage.locator('.user-panel button[title="User settings"]').click();
  await adminPage.waitForTimeout(400);
  await adminPage.getByRole('button', { name: 'Appearance' }).click();
  await adminPage.waitForTimeout(300);
  await shot(adminPage, '07-user-settings.png');
  await adminPage.keyboard.press('Escape');
  await adminPage.waitForTimeout(200);

  await adminPage.goto(`${base}/channels/${serverId}/${general.id}`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(800);
  await adminPage.locator('.channel-header button[title="Channel settings"]').click();
  await adminPage.waitForTimeout(500);
  const navRoles = adminPage.getByRole('button', { name: 'Roles' });
  if (await navRoles.count()) { await navRoles.first().click(); await adminPage.waitForTimeout(300); }
  await shot(adminPage, '08-server-settings.png');
  await adminPage.keyboard.press('Escape');

  await adminPage.goto(base + '/admin', { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(1200);
  const adminNav = await adminPage.locator('.admin-nav-item').count();
  if (!adminNav) throw new Error('admin console did not render');
  await shot(adminPage, '09-admin.png');
  await adminPage.getByRole('button', { name: 'Users', exact: true }).first().click();
  await adminPage.waitForTimeout(700);
  await shot(adminPage, '10-admin-users.png');
  await adminPage.getByRole('button', { name: /Reports/ }).first().click();
  await adminPage.waitForTimeout(700);
  await shot(adminPage, '11-admin-reports.png');
  await adminPage.getByRole('button', { name: 'Instance settings' }).first().click();
  await adminPage.waitForTimeout(700);
  await shot(adminPage, '12-admin-settings.png');

  await adminPage.goto(`${base}/channels/${serverId}/${general.id}`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(1000);
  const member = extras.find((e) => e.username === 'pixelgoblin');
  const memberRow = adminPage.locator('.member-item', { hasText: 'Pixel Goblin' }).first();
  if (await memberRow.count()) { await memberRow.click(); await adminPage.waitForTimeout(600); await shot(adminPage, '13-profile.png'); await adminPage.keyboard.press('Escape'); }

  // Two extra public servers make the Discover card grid representative (and exercise footer alignment).
  for (const spec of [
    { name: 'Meme Archaeology', bannerColor: '#ff7aa2', description: 'Digging up dead formats and pretending they were always funny. Bring a shovel and a folder of 2012 reaction images.' },
    { name: 'Goblin Rights Advocacy Group', bannerColor: '#57d98a', description: 'Legal representation for goblins accused of crimes against thread etiquette. Pro bono. Mostly.' },
  ]) {
    const created = await adminRequest.post(base + '/api/servers', { data: spec });
    if (!created.ok()) throw new Error(`discover fixture server failed: ${created.status()} ${await created.text()}`);
    const payload = await created.json();
    const published = await adminRequest.patch(base + `/api/servers/${payload.server.id}`, { data: { isPublic: true, bannerColor: spec.bannerColor } });
    if (!published.ok()) throw new Error(`discover fixture publish failed: ${published.status()} ${await published.text()}`);
  }

  await adminPage.goto(`${base}/discover`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(800);
  await shot(adminPage, '14-discover.png');

  await adminPage.goto(`${base}/leaderboard`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(800);
  await shot(adminPage, '15-leaderboard.png');

  if (dm) {
    await adminPage.goto(`${base}/channels/@me/${dm.id}`, { waitUntil: 'networkidle' });
    await adminPage.waitForTimeout(900);
    await shot(adminPage, '16-dm.png');
  }

  // Voice: join from admin, and from one extra user, with fake media devices.
  const adminVoice = await admin.context.newPage();
  watch(adminVoice, 'voice-admin');
  await adminVoice.goto(`${base}/channels/${serverId}/${voice.id}`, { waitUntil: 'networkidle' });
  await adminVoice.waitForTimeout(700);
  const joinBtn = adminVoice.getByRole('button', { name: /Join voice/ });
  if (await joinBtn.count()) { await joinBtn.click(); await adminVoice.waitForTimeout(1800); }
  const extraVoice = await extras[1]!.context.newPage();
  await extraVoice.goto(`${base}/channels/${serverId}/${voice.id}`, { waitUntil: 'networkidle' });
  await extraVoice.waitForTimeout(600);
  const extraJoin = extraVoice.getByRole('button', { name: /Join voice/ });
  if (await extraJoin.count()) { await extraJoin.click(); await extraVoice.waitForTimeout(2200); }
  await shot(adminVoice, '17-voice.png');

  // Mobile chat
  const mobileState = await admin.context.storageState();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, storageState: mobileState });
  const mobile = await mobileContext.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(`${base}/channels/${serverId}/${general.id}`, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(1000);
  await shot(mobile, '18-mobile.png');

  // Logged-out invite preview
  const inviteContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const invitePage = await inviteContext.newPage();
  watch(invitePage, 'invite');
  await invitePage.goto(`${base}/invite/slop-pit`, { waitUntil: 'networkidle' });
  await invitePage.waitForTimeout(800);
  await shot(invitePage, '19-invite.png', true);

  // Message search overlay with a server-wide hit
  await adminPage.goto(`${base}/channels/${serverId}/${general.id}`, { waitUntil: 'networkidle' });
  await adminPage.waitForTimeout(800);
  await adminPage.keyboard.press('Control+f');
  await adminPage.waitForTimeout(300);
  await adminPage.locator('.search-bar input').fill('pineapple');
  await adminPage.getByRole('button', { name: 'Everything' }).click();
  await adminPage.waitForTimeout(900);
  await shot(adminPage, '20-search.png');

  if (consoleProblems.length) {
    console.error('Console problems:\n' + consoleProblems.join('\n'));
    throw new Error(`${consoleProblems.length} console/page errors during screenshots`);
  }
  console.log('Screenshots written to', shots);
} finally {
  for (const ctx of [admin?.context, ...extras.map((e) => e.context), ...extrasContexts]) { try { await ctx?.close(); } catch { /* ignore */ } }
  await browser.close();
  stop();
  rmSync(dataDir, { recursive: true, force: true });
}
