// ===== 回归验证：#268 分页上滑 + 搜索/引用跳转（841 条真实复现） =====
// 背景：聊天长历史（>RENDER_MAX=200 且 >WINDOW_MAX=400）走渲染窗口渲染。
// 用户上翻讲旧消息时 loadOlderIncremental → pruneWindowBottom 从下界裁剪，使
// renderEnd < msgs.length；jumpToMsg 原先只处理 idx<renderStart，对落在裁剪下界
// 之外的 idx>=renderEnd 不处理→搜索/引用点了没反应。修复于 chat.js jumpToMsg 补下界外扩窗。
// 本脚本（可提交，verify-suite 自动发现）断言：
//   ①首屏只渲染最近 RENDER_MAX≈200 条（分页生效）
//   ②持续上滑（拖到最顶）能一路加载回最老消息（firstIdx≈0）
//   ③搜索点最老区结果 idx=40→居中+高亮、可见
//   ④搜索点近最新区结果 idx=820→居中+高亮、可见（下界外扩）
// 用法：node tools/verify-chat-pgjump.mjs（需已 node build.mjs）
// 复用此前 tools/verify-quote-jump.mjs 的无头 CDP 框架（引用跳转同走 jumpToMsg）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9860 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-841-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) { return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
}
async function gotoChat() { await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]'); if(a) a.click(); return true;})()"); await sleep(700); }

const N = 841;
await openPage();
// 种 841 条历史，含唯一关键词在 idx=40（最老区）与 idx=820（接近最新，用于下界跳转）
await evalJs(`(function(){
  const now = Date.now();
  const arr = [];
  for (let i = 0; i < ${N}; i++) {
    if (i === 40 || i === 820) arr.push({ side: 'out', text: '老KEY唯一关键词历史消息' + i, ts: now - (${N} - i) * 60000 });
    else if (i % 2 === 0) arr.push({ side: 'out', text: '历史消息' + i, ts: now - (${N} - i) * 60000 });
    else arr.push({ side: 'in', text: '对方消息' + i, ts: now - (${N} - i) * 60000 });
  }
  window.activeStore().set('chat-msgs', JSON.stringify(arr));
  return true;
})()`);
await sleep(300);
await openPage();
await gotoChat();
await sleep(600);

// 首屏应只渲染最近 RENDER_MAX=200 条
const s0 = await evalJs(`(function(){
  const b = document.getElementById('chat-body');
  const items = b.querySelectorAll('.msg');
  const f = items.length ? items[0].dataset.idx : null, l = items.length ? items[items.length-1].dataset.idx : null;
  return JSON.stringify({ scrollTop: b.scrollTop, firstIdx: f, lastIdx: l, n: items.length });
})()`);
check('首屏分页：只渲染最近 ~200 条 (firstIdx≈641)', Number(JSON.parse(s0).firstIdx) >= 630 && JSON.parse(s0).n <= 210, s0);

// ---- 症状1：持续上滑，能否一路加载回最老消息 ----
// 真实用户手势：拖到最顶（scrollTop 被钉在 0），每次触发向上加载后继续拖
for (let k = 0; k < 14; k++) {
  await evalJs(`(function(){var b=document.getElementById('chat-body'); b.scrollTop=0; b.dispatchEvent(new Event('scroll',{bubbles:true})); return true;})()`);
  await sleep(280);
}
const sTop = await evalJs(`(function(){
  const b = document.getElementById('chat-body');
  const items = b.querySelectorAll('.msg');
  const f = items.length ? items[0].dataset.idx : null;
  return JSON.stringify({ scrollTop: b.scrollTop, firstIdx: f });
})()`);
const top = JSON.parse(sTop);
check('症状1 上滑分页：最老消息已加载 (firstIdx<=4)', Number(top.firstIdx) <= 4, sTop);

// ---- 症状2：搜索单击最老区的结果 (idx=40) 应能跳转 ----
await evalJs(`(function(){
  const cs = document.getElementById('chat-search'); if (cs) cs.hidden=false;
  const inp = document.getElementById('chat-search-input'); if (inp) inp.value='老KEY唯一关键词';
  const df = document.getElementById('chat-search-date-from'); if (df) df.value='';
  const dt = document.getElementById('chat-search-date-to'); if (dt) dt.value='';
  return true;
})()`);
await sleep(200);
await evalJs("(function(){var g=document.getElementById('chat-search-go'); if(g) g.click(); return true;})()");
await sleep(500);
const res = await evalJs(`(function(){
  const r = document.getElementById('chat-search-results');
  if (!r) return 'nores';
  return JSON.stringify(Array.from(r.querySelectorAll('.tc-listitem')).map(function(x){return x.dataset.sidx;}));
})()`);
console.log('  搜索结果 sidx: ' + res);
// 点 idx=40（最老区，点击后需向上扩窗）
await evalJs(`(function(){
  const its = document.querySelectorAll('#chat-search-results .tc-listitem');
  const hit = Array.from(its).find(x => x.dataset.sidx === '40');
  if (hit) hit.click();
  return true;
})()`);
await sleep(1300);
const sj1 = await evalJs(`(function(){
  const b = document.getElementById('chat-body');
  const hl = document.querySelector('#chat-body .msg.highlight');
  if (!hl) return JSON.stringify({ hasHl:false });
  const r = hl.getBoundingClientRect(), br = b.getBoundingClientRect();
  return JSON.stringify({ hasHl:true, idx: hl.dataset.idx, visible: r.bottom>br.top && r.top<br.bottom });
})()`);
const j1 = JSON.parse(sj1);
check('症状2 老区搜索跳转：hasHl=true', j1.hasHl === true, sj1);
check('症状2 老区搜索跳转：idx=40', j1.idx === '40', sj1);
check('症状2 老区搜索跳转：目标在视口内可见', j1.visible === true, sj1);

// ---- 症状3：点击 idx=820（接近最新）引用/搜索结果也应能跳转 ----
await evalJs("(function(){var g=document.getElementById('chat-search-go'); if(g) g.click(); return true;})()");
await sleep(400);
await evalJs(`(function(){
  const its = document.querySelectorAll('#chat-search-results .tc-listitem');
  const hit = Array.from(its).find(x => x.dataset.sidx === '820');
  if (hit) hit.click();
  return true;
})()`);
await sleep(1300);
const sj2 = await evalJs(`(function(){
  const b = document.getElementById('chat-body');
  const hl = document.querySelector('#chat-body .msg.highlight');
  if (!hl) return JSON.stringify({ hasHl:false });
  const r = hl.getBoundingClientRect(), br = b.getBoundingClientRect();
  return JSON.stringify({ hasHl:true, idx: hl.dataset.idx, visible: r.bottom>br.top && r.top<br.bottom });
})()`);
const j2 = JSON.parse(sj2);
check('症状3 近最新区搜索跳转：hasHl=true 且 idx=820 可见', j2.hasHl === true && j2.idx === '820' && j2.visible === true, sj2);

try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);