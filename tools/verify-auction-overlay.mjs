// ===== 回归脚本：拍卖会「按钮没用+页面卡死」——#au-intro/#au-help 全屏浮层 hidden 救援（v3.26.x #331 修复） =====
// 用法：node build.mjs && node tools/verify-auction-overlay.mjs
// 背景（用户反馈：iQOO Neo10 Pro+ 雨见浏览器拍卖会按钮没用+页面卡死，明说其他设备型号也有）：
//   #321 全屏教学浮层用 ID 选择器 #au-intro,#au-help{display:flex;position:fixed;inset:0}——
//   ID 特异性压过 UA 的 [hidden]{display:none} 与 .pong-overlay[hidden] 救援 → hidden 属性失效，
//   不透明黑罩永远盖屏拦掉全站点击＝按钮全没用、页面像卡死（纯 CSS，全机型必现）。
// 修复：chat-pages.css 加 #au-intro[hidden], #au-help[hidden] { display:none; }（特异性 1,1,0 反压）。
// 验证（无头 Chrome 390×844 触摸仿真）：修复前产物 A2/B1 红（hidden=true 但 computed display 仍
//   flex、点击被浮层拦）；修复后全绿——开场只显教学层、点「开始拍卖」真收起、出价按钮点击生效、
//   详细玩法可开可关、关面板重开不残留。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9750 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-auov-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);

// 关开屏（clock.js 门控：滑到底 + 点「点击进入」）——不关它会盖在一切之上，命中断言全打到 splash 上
let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var sp = document.getElementById('splash');
    if (sp && sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
chk('A0 开屏已关闭（否则命中断言全打到 splash）', splashClosed, '');
await sleep(600);

// 进聊天页 → 种足心意币（防余额 0 把出价按钮 disabled）→ 从「更多功能」入口打开拍卖会
await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
await evalJs(`(function(){ try { window.giftWalletSet({ myBalance: 999900, systemBalance: 999900 }); } catch (e) { return 'ERR:' + e.message; } return 'ok'; })()`);
const opened = await evalJs(`(function(){
  var b = document.getElementById('more-auction');
  if (b) { b.click(); return 'btn'; }
  if (window.openAuctionPanel) { window.openAuctionPanel(); return 'api'; }
  return 'no-entry';
})()`);
await sleep(800);

const disp = (id) => `(function(){ var el = document.getElementById(${JSON.stringify(id)}); return el ? getComputedStyle(el).display : 'no-el'; })()`;
// 取元素中心点的实际命中元素（可判「有没有被浮层拦住点击」）
// 注意：不要 scrollIntoView——面板浮层是 position:fixed，滚动文档会造成坐标错位的测试假象
const hitAt = (id) => `(function(){
  var el = document.getElementById(${JSON.stringify(id)});
  if (!el || el.hidden) return 'no-el';
  var r = el.getBoundingClientRect();
  var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  return hit ? (hit.id || hit.className || hit.tagName) : 'none';
})()`;

// A) 开场：教学层显示、帮助层必须真隐藏（坏产物里 help 盖在 intro 上层＝用户看到的是死页面）
const aIntro = await evalJs(disp('au-intro'));
const aHelp = await evalJs(disp('au-help'));
const aHelpAttr = await evalJs(`(function(){ var el = document.getElementById('au-help'); return el ? String(el.hidden) : 'no-el'; })()`);
chk('A1 打开拍卖会开场教学层显示', aIntro !== 'none' && aIntro !== 'no-el', 'display=' + aIntro);
chk('A2 帮助层 hidden=true 时 computed display=none（本修复核心；坏产物 flex=盖屏卡死）', aHelpAttr === 'true' && aHelp === 'none', 'hidden=' + aHelpAttr + ' display=' + aHelp);
const aHit = await evalJs(hitAt('au-intro-start'));
chk('A3 教学层「开始拍卖」按钮可命中（不被别的层拦）', typeof aHit === 'string' && aHit.indexOf('au-intro-start') >= 0, 'hit=' + aHit);

// B) 点「开始拍卖」：教学层必须真收起（坏产物 hidden 属性变了但视觉不动＝后续全点不到）
await evalJs(`(function(){ var b = document.getElementById('au-intro-start'); if (b) b.click(); return 1; })()`);
await sleep(300);
const bIntro = await evalJs(disp('au-intro'));
chk('B1 点开始拍卖后教学层 computed display=none（真收起）', bIntro === 'none', 'display=' + bIntro);
const bHit = await evalJs(hitAt('au-bid1'));
chk('B2 出价按钮不被浮层拦截（elementFromPoint 命中自身）', typeof bHit === 'string' && bHit.indexOf('au-bid1') >= 0, 'hit=' + bHit);
const bDisabled = await evalJs(`(function(){ var b = document.getElementById('au-bid1'); return b ? String(b.disabled) : 'no-el'; })()`);
if (bDisabled === 'false') {
  await evalJs(`(function(){ var b = document.getElementById('au-bid1'); if (b) b.click(); return 1; })()`);
  await sleep(200);
  const st = await evalJs(`(function(){ var s = window.__auDebug && window.__auDebug.st(); return s ? JSON.stringify({ leader: s.leader, cur: s.cur, phase: s.phase }) : 'no-st'; })()`);
  let ok = false; try { const o = JSON.parse(st); ok = o.leader === 'you' && o.cur > 0; } catch (e) {}
  chk('B3 点「出 ¥x」出价生效（leader=you，按钮真的能用）', ok, 'st=' + st);
} else {
  chk('B3 点「出 ¥x」出价生效（leader=you，按钮真的能用）', false, 'bid1 disabled=' + bDisabled + '（钱包/场次态异常）');
}

// C) 详细玩法：可开可关（hidden 切换对两个浮层都必须生效）
await evalJs(`(function(){ var b = document.getElementById('au-help-btn'); if (b) b.click(); return 1; })()`);
await sleep(150);
const cOpen = await evalJs(disp('au-help'));
await evalJs(`(function(){ var b = document.getElementById('au-help-close'); if (b) b.click(); return 1; })()`);
await sleep(150);
const cClose = await evalJs(disp('au-help'));
chk('C1 详细玩法能打开', cOpen === 'flex', 'display=' + cOpen);
chk('C2 详细玩法能关上（点「知道啦」真收起）', cClose === 'none', 'display=' + cClose);

// D) 关面板重开：浮层不残留、直接回到可操作的竞价半框
await evalJs(`(function(){ if (window.closeAuctionPanel) window.closeAuctionPanel(); return 1; })()`);
await sleep(150);
await evalJs(`(function(){ if (window.openAuctionPanel) window.openAuctionPanel(); return 1; })()`);
await sleep(400);
const dIntro = await evalJs(disp('au-intro'));
const dHelp = await evalJs(disp('au-help'));
const dHit = await evalJs(hitAt('au-pass'));
chk('D1 重开后教学/帮助层都不残留', dIntro === 'none' && dHelp === 'none', 'intro=' + dIntro + ' help=' + dHelp);
chk('D2 重开后「放弃这件」可命中（半框可直接继续操作）', typeof dHit === 'string' && dHit.indexOf('au-pass') >= 0, 'hit=' + dHit);

console.log('入口=' + opened + '  结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
