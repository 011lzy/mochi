// ===== 回归验证 #359：发一遍图片/表情包出现 2 个（摩托罗拉 G100 / 华为 P50E Edge 多机型） =====
// 形态 A：表情面板同一条目 150ms 内双 click（移动端双派发模拟）→ 断言只出 1 条 out sticker。
// 形态 B：单发后等 1.6s（媒体令牌化窗口过后）再点同一条目（跨形式窗口）→ 断言只出 1 条。
// 形态 C：刷新后检查数据层是否重复。
// 用法：node verify-sticker-double-send.mjs（对现有产物 index.html）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; } 
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { try { if (!res.headersSent) res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
setTimeout(() => { console.log('WATCHDOG: 强制退出'); try { chrome.kill(); } catch (e) {} process.exit(2); }, 90000);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = 9930 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-dup-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, isMobile: true, hasTouch: true });

await cdp('Page.navigate', { url: 'about:blank' });
await evalJs(`(function(){ try{ indexedDB.deleteDatabase('xy-home-v2'); }catch(e){} try{ localStorage.clear(); sessionStorage.clear(); }catch(e){} return 1; })()`);
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(1200);
// 种 1 张我的表情包（>1KB dataURL，触发令牌化窗口语义）
await evalJs("(function(){ var src='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; src=src+'AAAAAAAA'.repeat(60); localStorage.setItem('xy-home-v2:my-emoji-groups', JSON.stringify([['测试组',[src]]])); localStorage.setItem('xy-home-v2:default:emoji-last', JSON.stringify({mode:'mine',mine:'测试组'})); return 1; })()");
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2000);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(1000);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return !!ic; })()`);
await sleep(1000);

const countOutSticker = `JSON.stringify({
  recs: (window.getChatMsgs() || []).filter(m => m.side === 'out' && (m.type === 'sticker' || (m.parts || []).some(p => p.k === 'img'))).map(m => ({ t: String(m.text || '').slice(0, 24), ty: m.type || '', ts: m.ts })),
  bubbles: document.querySelectorAll('#chat-body .msg-out').length
})`;

// 形态 A：打开表情面板，双击同一条目（150ms）
await evalJs(`(function(){ var b=document.getElementById('chat-emoji-btn'); if(b) b.click(); return !!b; })()`);
await sleep(800);
const panelInfo = await evalJs(`JSON.stringify({ items: document.querySelectorAll('#emoji-panel .emoji-item').length, panels: document.querySelectorAll('#emoji-panel').length })`);
check('S1 表情面板就绪(种我的表情包+mine 模式)', JSON.parse(panelInfo).items >= 1, panelInfo);
await evalJs(`(function(){ var it=document.querySelector('#emoji-panel .emoji-item'); if(!it) return 0; it.click(); setTimeout(function(){ try { it.click(); } catch(e){} }, 150); return 1; })()`);
await sleep(1200);
const A = JSON.parse(await evalJs(countOutSticker)); check('A1 150ms 双派发只出 1 条', A.recs.length === 1, JSON.stringify(A));

// 形态 B：关面板再开，再单点一次（此刻距上次 ~2-3s，且 rec1 可能已被令牌化）
await sleep(1800);
await evalJs(`(function(){ var b=document.getElementById('chat-emoji-btn'); if(b) b.click(); return 1; })()`);
await sleep(600);
await evalJs(`(function(){ var it=document.querySelector('#emoji-panel .emoji-item'); if(it) it.click(); return 1; })()`);
await sleep(1200);
const B = JSON.parse(await evalJs(countOutSticker)); check('B1 ~3.6s 补点同一条目仍只 1 条(#359 旧版=2 红)', B.recs.length === 1, JSON.stringify(B)); check('B2 屏上气泡数=记录数', B.bubbles === B.recs.length, 'bubbles=' + B.bubbles);

// 形态 C：刷新重进，看数据层与渲染
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2200);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return 1;})()");
await sleep(1000);
await evalJs(`(function(){ var ic = document.querySelector('.app[data-app="chat"]'); if (ic) ic.click(); return 1; })()`);
await sleep(1000);
const C = JSON.parse(await evalJs(countOutSticker)); check('C1 刷新后数据层不重复', C.recs.length === 1, JSON.stringify(C));

chrome.kill();
server.close();
const fail = results.filter(x => !x).length;
console.log(fail ? 'FAIL ' + fail + '/' + results.length : 'PASS ' + results.length + '/' + results.length);
process.exit(fail ? 1 : 0);
