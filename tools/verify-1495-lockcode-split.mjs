// ===== #1495 二级密码与暗号分码（行为断言）=====
// 用户直派「现在是和暗号一起解锁了……开屏的地方无法点击解锁……这个要分开啊」＋
// 「有人不同手机型号不同浏览器输对了密码也无法解锁」。
// 契约：① 二级密码=995180（99＋生日倒写），暗号=990815（99＋生日原样）——两串互不相通；
//       ② 旧码 990815 解不了二级锁；③ 全角（９９５１８０）与夹空白（99 5180）都能解锁；
//       ④ 换码一次性重锁（旧码时代解锁态不跨换码延续，恢复「重新输入解锁」）；
//       ⑤ 各文案面改「不是同一个」；⑥ 暗号通路同款归一化（静态锚＋函数抽取单元验证）。
// 用法：node build.mjs && node tools/verify-1485-lockcode-split.mjs（需本机 Chrome/Edge）
// RED 判别：纯 HEAD（改动前）副本上 B1/B2/B4/B5/S 系必红。
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
console.log('[verify-1485] 被测根目录: ' + root);
let pass = 0, fail = 0;
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  ⤜' + detail : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- S 静态锚（源＋产物） ----------
const srcLock = readFileSync(join(root, 'src/js/card-lock.js'), 'utf8');
const prodLock = (() => { try { return readFileSync(join(root, 'js/card-lock.js'), 'utf8'); } catch { return ''; } })();
const srcClock = readFileSync(join(root, 'src/js/clock.js'), 'utf8');
const prodClock = (() => { try { return readFileSync(join(root, 'js/clock.js'), 'utf8'); } catch { return ''; } })();
const srcApplock = readFileSync(join(root, 'src/js/applock.js'), 'utf8');
const prodApplock = (() => { try { return readFileSync(join(root, 'js/applock.js'), 'utf8'); } catch { return ''; } })();
const prodIndex = readFileSync(join(root, 'index.html'), 'utf8');

check('S1 源 card-lock 散列=995180 且含归一化与换码版本戳', srcLock.includes("'1062906492'") && srcLock.includes('charCodeAt(0) - 65248') && srcLock.includes("stGetK('cardlock-pwver')"));
check('S2 产物 js/card-lock.js 同步（外置件不落库＝线上没这批）', prodLock.includes("'1062906492'") && prodLock.includes('charCodeAt(0) - 65248'));
check('S3a clock 三处分码文案（tip/弹窗/提醒 各一处唯一锚）', (srcClock.match(/本卡解锁＝99＋生日倒写 4 位/g) || []).length === 1 && (srcClock.match(/解锁这张卡用本条这一串/g) || []).length === 1 && (srcClock.match(/解锁本卡要用 99＋生日倒写 4 位那串/g) || []).length === 1);
check('S3b 产物 js/clock.js 同步', prodClock.includes('本卡解锁＝99＋生日倒写 4 位') && prodClock.includes('解锁本卡要用 99＋生日倒写 4 位那串'));
check('S4a applock 暗号维持 990815＋归一化三入口（跳问答/关锁/管理验证）', srcApplock.includes("QA_SKIP_CODE = '990815'") && (srcApplock.match(/normCode\(v\) === QA_SKIP_CODE/g) || []).length === 3);
check('S4b 产物 js/applock.js 同步＋分码说明', prodApplock.includes('charCodeAt(0) - 65248') && prodApplock.includes('不是同一个，是分开的两串数字'));
check('S5 index.html 静态锁卡 tip 分码＋旧同码句绝迹', prodIndex.includes('解锁这张卡用本条的 99＋生日倒写 4 位') && !prodIndex.includes('是同一个（同一串 6 位数字'));

// ---------- 归一化函数抽取单元验证（从产物源码原样抽取，不做平行实现） ----------
try {
  const m = /function normCode\(v\) \{[\s\S]*?\n\}/.exec(prodApplock);
  check('S6 产物 applock normCode 可抽取', !!m);
  if (m) {
    const normCode = new Function('return ' + m[0])();
    check('S6a 全角９９０８１５→990815', normCode('９９０８１５') === '990815');
    check('S6b 夹空白「 99 5180 」→995180', normCode(' 99 5180 ') === '995180');
    check('S6c 全角＋空白混合', normCode('９９ ５１８０') === '995180');
  }
} catch (e) { check('S6 normCode 抽取执行（异常: ' + e.message + '）', false); }

// ---------- B 行为断言（无头真跑产物） ----------
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>{try{return statSync(p).isFile()}catch(e){return false}});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0] || '/')));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (statSync(p).isDirectory()) p = join(p, 'index.html');
  try { res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
let cdpPort = 9730 + Math.floor(Math.random() * 40);
let chrome = spawn(exe, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-1485-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'], { stdio: 'ignore' });
let ws=null, msgId=0; const pend=new Map();
async function cdpConnect() {
  for (let i=0;i<60;i++){ try {
    const list = await (await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();
    // 首个 page target 可能是扩展后台页（audio.html）——连错页面＝组件永远不就位；排除扩展页
    const page = list.find(t=>t.type==='page' && !/^chrome-extension/.test(t.url||''));
    if (page){ ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;}); break; }
  } catch {} await sleep(500);
  }
  if (!ws) throw new Error('no CDP');
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
}
// B6 用：杀旧实例、全新 profile 重开——「旧码时代升级」最忠实的形态（任何地方都没写过 pwver，
// 也不会被本 profile 的写日志回放/内存缓存复活）。种子脚本在应用脚本前种入 state=open。
async function freshBrowser(tag) {
  try { chrome.kill(); } catch (e) {}
  try { ws.close(); } catch (e) {}
  ws = null; pend.clear();
  cdpPort = 9730 + Math.floor(Math.random() * 40);
  chrome = spawn(exe, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-1485-'+tag+'-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'], { stdio: 'ignore' });
  await cdpConnect();
  await send('Page.enable');
}
function send(method, params={}) {
  return new Promise((res) => { const id=++msgId; pend.set(id,res); ws.send(JSON.stringify({id,method,params})); });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function goto(url) { await send('Page.enable'); await send('Page.navigate', { url }); }
async function waitCardLock(timeout=20000) { for (let i=0;i<timeout/300;i++){ if (await ev('!!window.cardLockTryUnlock')) return true; await sleep(300); } return false; }

await cdpConnect();
try {
  // B0 新装机器：零写入的版本闸——库没东西＝锁定；不做任何迁移写
  await goto(baseUrl + '/');
  check('B0a 组件就位', await waitCardLock());
  await sleep(1500);
  check('B0 新装启动＝锁定态（版本闸：无状态/无戳即锁）', await ev('window.cardLockOpen()') === false);

  // B1/B2 新码解锁、旧码拒绝
  check('B1 cardLockTryUnlock(995180)=ok（新码解锁）', await ev("window.cardLockTryUnlock('995180').ok")===true);
  check('B2 解锁后 state=open 且版本戳已盖（常开凭证）',
    await ev("localStorage.getItem('xy-home-v2:cardlock-state')")==='open' &&
    await ev("localStorage.getItem('xy-home-v2:cardlock-pwver')")==='2' &&
    await ev('window.cardLockOpen()')===true);
  check('B3 旧码 990815 解不了二级锁（与暗号分码）', await ev("window.cardLockTryUnlock('990815').ok")===false);
  // 重置回锁再试形态容错（避免 5 次节流：只错 1 次即重置）
  await ev("localStorage.setItem('xy-home-v2:cardlock-state','locked')");
  check('B4 全角９９５１８０＝输对（全角归一化）', await ev("window.cardLockTryUnlock('９９５１８０').ok")===true);
  await ev("localStorage.setItem('xy-home-v2:cardlock-state','locked')");
  check('B5 夹空白「99 5180」＝输对（空白归一化）', await ev("window.cardLockTryUnlock(' 99 5180 ').ok")===true);

  // B6 换码版本闸：模拟「旧码时代升级」——state=open（LS）且两端都没有版本戳（真升级机器的
  //   IDB 从未写过 pwver；本 profile 前面启动盖过戳，IDB 里的也要删掉才是旧码时代形态）。
  //   版本闸零写入：不重锁状态键，但闸门不认＝等效重锁。⚠ 不能只删 LS/IDB 里的 pwver——
  //   xyStore 的写日志回放会把本 profile 早前盖的戳复活（实测）。真升级机器＝任何地方都从没
  //   写过 pwver，故：杀旧实例换全新 profile（写日志回放/内存缓存都带不过去）＋
  //   新文档种子脚本在应用脚本前种旧码时代形态。
  await freshBrowser('upg');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('xy-home-v2:cardlock-state','open');localStorage.removeItem('xy-home-v2:cardlock-pwver');}catch(e){}" });
  await goto(baseUrl + '/');
  check('B6a 组件就位（重载）', await waitCardLock());
  await sleep(2600);
  const b6 = await ev("(function(){try{return JSON.stringify([localStorage.getItem('xy-home-v2:cardlock-state'),localStorage.getItem('xy-home-v2:cardlock-pwver'),window.cardLockOpen()]);}catch(e){return 'err:'+e.message;}})()");
  check('B6 旧码时代的 open＋无戳 → 闸门不认（恢复重新输入解锁）', await ev('window.cardLockOpen()') === false, b6);
  // B7 再重载一次：依旧锁定（旧码时代的 open 翻不了身，无橡皮筋）
  await goto(baseUrl + '/');
  check('B7 组件就位（三载）', await waitCardLock());
  await sleep(2000);
  check('B7 重载不翻身（旧码时代解锁态不跨换码延续）', await ev('window.cardLockOpen()') === false);

  // B8 开屏锁卡锁定态渲染出「输入密码解锁」入口
  check('B8 开屏锁卡渲染锁定入口', (await ev("(function(){var b=document.querySelector('#splash-cardlock-actions .cardlock-btn');return b?b.textContent:'';})()"))==='输入密码解锁');

  // Z 零未捕获异常
  const errs = await ev("(window.__jsErrors||[]).length") || 0;
  check('Z 启动零未捕获异常（实测 ' + errs + ' 条）', errs === 0);
} catch (e) {
  check('行为段执行完整（异常: ' + e.message + '）', false);
} finally {
  try { chrome.kill(); } catch {}
  try { server.close(); } catch {}
}
console.log('verify-1485: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
