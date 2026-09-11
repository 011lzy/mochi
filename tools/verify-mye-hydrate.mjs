// #172 我的表情包刷新必丢 行为验证（纯 Node，零浏览器依赖）
// 立项：华为畅享70Pro+Chrome 报障「自己添加的字卡和表情包每次刷新重开必丢」。
// 诊断实证：IDB 里 my-emoji-groups 仍有 34.93MB（数据没丢）——超启动回填预算（低内存机
// 12MB）每次刷新都被 idbRestore 挂起在 __xyIdbDeferredKeys，大键又从不落 localStorage
// 快照 → store 三路全空；唯一恢复链是裸 idbGet 固定 4s+4s 超时，低端机读不完即静默放弃
// → 面板永远空。修复：①idbGet 读空改走 idbHydrateKey 按需取回（tryRestore 重试穷尽 /
// reloadMyEmojiFromIdb 共用 myeHydrateFallback）；②myEmojiSave 防覆盖闸门——该键仍挂起
// （本会话从未恢复全量）时先取回 IDB 全量与内存新增合并再写，防几十 MB 被小包顶掉。
// 本脚本从 src/js/chat.js 抽取**真实的 myeApplyIdb / myeHydrateFallback / myEmojiSave /
// reloadMyEmojiFromIdb / tryRestore 函数源码**注入桩环境跑行为断言——恢复链被改坏
// （hydrate 兜底被删／防覆盖闸门被拆）这里立刻红，不依赖浏览器。
// 用法：node tools/verify-mye-hydrate.mjs
import { readFileSync } from 'node:fs';

const srcPath = new URL('../src/js/chat.js', import.meta.url);
const text = readFileSync(srcPath, 'utf8');

function cut(start, end) {
  const s = text.indexOf(start);
  const e = text.indexOf(end, s + 1);
  if (s < 0 || e < 0 || e <= s) {
    console.error('抽取失败：找不到 ' + JSON.stringify(start) + ' 或收尾锚点 ' + JSON.stringify(end) + '（函数被改名/挪动？）');
    process.exit(2);
  }
  return text.slice(s, e);
}
const srcApply = cut('function myeApplyIdb', 'function myeHydrateFallback');
const srcHyd = cut('function myeHydrateFallback', 'function myEmojiSave');
const srcSave = cut('function myEmojiSave', 'window.getMyEmojiGroups = function');
const srcReload = cut('function reloadMyEmojiFromIdb', "document.addEventListener('contact-switched'");
const srcTry = cut('function tryRestore', 'tryRestore();');

const KEY = 'xy-home-v2:my-emoji-groups';
const img = (n) => 'data:image/gif;base64,IMG' + n;
const groups = (defs) => defs.map(([name, n, from]) => [name, Array.from({ length: n }, (_, i) => img(from + '_' + i))]);
// 全量：5 组 5 张（IDB 存量）；新增：1 组 1 张（本会话用户新传）
const FULL = groups([['A', 2, 'f'], ['B', 2, 'f'], ['C', 1, 'f']]);
const NEWADD = groups([['新组', 1, 'n']]);

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};
const cntOf = (g) => (g || []).reduce((n, x) => n + (Array.isArray(x[1]) ? x[1].length : 0), 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function flush(ticks) { for (let i = 0; i < (ticks || 80); i++) await Promise.resolve(); await sleep(0); }

// —— 桩环境工厂：把真实函数源码装进闭包（myGroups 可变，经 getter/setter 与外部同步）——
function makeEnv(cfg) {
  cfg = cfg || {};
  const calls = { idbGets: [], hydrates: [], sets: [], renders: 0 };
  const store = new Map(); // 模拟 memoryCache+LS 合体（hydrate 成功后写入全量）
  if (cfg.seedStore) store.set(KEY, JSON.stringify(cfg.seedStore));
  const win = {
    __xyIdbDeferredKeys: cfg.deferred ? [KEY] : [],
    idbGet: (k) => { calls.idbGets.push(k); return Promise.resolve(cfg.idbValue === undefined ? undefined : cfg.idbValue); },
    idbHydrateKey: (k) => {
      calls.hydrates.push(k);
      if (cfg.hydrateResult === true) store.set(k, JSON.stringify(cfg.hydrateValue));
      return Promise.resolve(cfg.hydrateResult === undefined ? false : cfg.hydrateResult);
    },
  };
  const factory = new Function('env', `
    const window = env.window, myEmojiStore = env.myEmojiStore, MYE_KEY = env.MYE_KEY,
          emojiPanel = env.emojiPanel, renderEmojiPanel = env.renderEmojiPanel;
    let myGroups = env.initial;
    let retry = 0; // tryRestore 外层 IIFE 的闭包变量（源码同名）
    ${srcApply}
    ${srcHyd}
    ${srcSave}
    ${srcReload}
    ${srcTry}
    return {
      reloadMyEmojiFromIdb, tryRestore, myEmojiSave,
      get: () => myGroups, set: (v) => { myGroups = v; },
    };
  `);
  const api = factory({
    window: win,
    // 真实 xyStore.get/set 在内部拼前缀（业务侧传裸键名，IDB/挂起名单用全键）
    myEmojiStore: () => ({
      get: (k) => (store.has('xy-home-v2:' + k) ? store.get('xy-home-v2:' + k) : null),
      set: (k, v) => { calls.sets.push(['xy-home-v2:' + k, v]); store.set('xy-home-v2:' + k, v); },
    }),
    MYE_KEY: () => KEY,
    emojiPanel: { hidden: true },
    renderEmojiPanel: () => { calls.renders++; },
    initial: cfg.initial ? JSON.parse(JSON.stringify(cfg.initial)) : [],
  });
  return { api, calls };
}

// T1 挂起/超时形态：idbGet 读空（undefined）→ 不再静默放弃，走 hydrate 取回并恢复全量
{
  const { api, calls } = makeEnv({ idbValue: undefined, hydrateResult: true, hydrateValue: FULL });
  api.reloadMyEmojiFromIdb();
  await flush();
  ok(calls.hydrates.length === 1 && calls.hydrates[0] === KEY, 'T1 idbGet 读空 → 调 idbHydrateKey(' + KEY + ')', JSON.stringify(calls.hydrates));
  ok(cntOf(api.get()) === 5, 'T2 hydrate 成功 → myGroups 恢复 IDB 全量 5 张（原为空）', 'cnt=' + cntOf(api.get()));
}

// T2' 同场景但面板开着 → 恢复后应重绘（原恢复块语义保留）
{
  const factory = new Function('env', `
    const window = env.window, myEmojiStore = env.myEmojiStore, MYE_KEY = env.MYE_KEY,
          emojiPanel = env.emojiPanel, renderEmojiPanel = env.renderEmojiPanel;
    let myGroups = env.initial;
    ${srcApply}
    return { myeApplyIdb, get: () => myGroups };
  `);
  let renders = 0;
  const api2 = factory({
    window: {}, myEmojiStore: { get: () => null },
    MYE_KEY: () => KEY, emojiPanel: { hidden: false }, renderEmojiPanel: () => { renders++; },
    initial: [],
  });
  api2.myeApplyIdb(JSON.stringify(FULL));
  ok(renders === 1 && cntOf(api2.get()) === 5, "T2' myeApplyIdb 应用后面板开着即重绘", 'renders=' + renders);
}

// T3 idbGet 直接读到值 → 应用且不再 hydrate
{
  const { api, calls } = makeEnv({ idbValue: JSON.stringify(FULL), hydrateResult: true, hydrateValue: FULL });
  api.reloadMyEmojiFromIdb();
  await flush();
  ok(calls.hydrates.length === 0 && cntOf(api.get()) === 5, 'T3 idbGet 读到值 → 直接应用、不触发 hydrate', 'hyd=' + calls.hydrates.length);
}

// T4 「内容更多才覆盖」语义保留：内存已有 6 张、IDB 只有 5 张 → 不回退内存
{
  const LOCAL6 = groups([['A', 2, 'l'], ['B', 2, 'l'], ['D', 2, 'l']]);
  const factory = new Function('env', `
    const window = env.window, myEmojiStore = env.myEmojiStore, MYE_KEY = env.MYE_KEY,
          emojiPanel = env.emojiPanel, renderEmojiPanel = env.renderEmojiPanel;
    let myGroups = env.initial;
    ${srcApply}
    return { myeApplyIdb, get: () => myGroups };
  `);
  const api3 = factory({
    window: {}, myEmojiStore: { get: () => null },
    MYE_KEY: () => KEY, emojiPanel: { hidden: true }, renderEmojiPanel: () => {}, initial: LOCAL6,
  });
  api3.myeApplyIdb(JSON.stringify(FULL));
  ok(cntOf(api3.get()) === 6 && api3.get()[2][0] === 'D', 'T4 内存比 IDB 多 → 不被旧快照回退', 'cnt=' + cntOf(api3.get()));
}

// T5 防覆盖闸门：键仍挂起 + 内存只有新传 1 张 → 先 hydrate 合并再写，全量与新值都不丢
{
  const { api, calls } = makeEnv({ deferred: true, hydrateResult: true, hydrateValue: FULL, initial: NEWADD });
  api.myEmojiSave();
  await flush();
  ok(calls.hydrates.length === 1, 'T5 挂起时保存 → 触发 hydrate', 'hyd=' + calls.hydrates.length);
  const last = calls.sets[calls.sets.length - 1];
  const written = last ? JSON.parse(last[1]) : [];
  const names = written.map((g) => g[0]).sort().join(',');
  ok(last && last[0] === KEY && cntOf(written) === 6 && names === 'A,B,C,新组', 'T5 写回=IDB 全量+内存新增合并（6 张、4 组）', names + ' cnt=' + cntOf(written));
}

// T6 防覆盖闸门·hydrate 失败：不写回（保持挂起可重试），绝不静默用小包覆盖 IDB
{
  const { api, calls } = makeEnv({ deferred: true, hydrateResult: false, initial: NEWADD });
  api.myEmojiSave();
  await flush();
  const last = calls.sets[calls.sets.length - 1];
  ok(calls.sets.length === 0, 'T6 hydrate 失败 → 本侧不落写（防覆盖 IDB 全量）', 'sets=' + calls.sets.length + ' last=' + (last ? last[1].length : ''));
}

// T6' hydrate 返回 null（健康连接确认 IDB 无此键=新装空库）→ 直接写内存态不被拦截
{
  const { api, calls } = makeEnv({ deferred: true, hydrateResult: null, initial: NEWADD });
  api.myEmojiSave();
  await flush();
  const last = calls.sets[calls.sets.length - 1];
  ok(last && last[0] === KEY && cntOf(JSON.parse(last[1])) === 1, "T6' hydrate=null（IDB 确认无键）→ 直接写内存态", 'sets=' + calls.sets.length);
}

// T7 正常路径：键已恢复（不在挂起名单）→ 直接写内存态、零 hydrate 开销
{
  const { api, calls } = makeEnv({ deferred: false, idbValue: undefined, hydrateResult: true, hydrateValue: FULL, initial: NEWADD });
  api.myEmojiSave();
  await flush();
  const last = calls.sets[calls.sets.length - 1];
  ok(calls.hydrates.length === 0 && last && last[0] === KEY && cntOf(JSON.parse(last[1])) === 1, 'T7 已恢复 → 直接写内存态、不 hydrate', 'hyd=' + calls.hydrates.length);
}

// T8 tryRestore 启动自愈：3 次重试全空 → 穷尽后走 hydrate 兜底（桩 setTimeout 同步推进退避）
{
  const { api, calls } = makeEnv({ idbValue: undefined, hydrateResult: true, hydrateValue: FULL });
  const realSetTimeout = global.setTimeout.__mochi_stub ? global.setTimeout : null;
  const stubSetTimeout = (cb) => { cb(); };
  const savedSetTimeout = global.setTimeout;
  global.setTimeout = stubSetTimeout;
  try {
    api.tryRestore();
    await flush(200);
  } finally {
    global.setTimeout = savedSetTimeout;
    if (realSetTimeout) global.setTimeout = realSetTimeout;
  }
  ok(calls.idbGets.length === 4 && calls.hydrates.length === 1, 'T8 tryRestore 首试+3 重试全空 → hydrate 兜底', 'gets=' + calls.idbGets.length + ' hyd=' + calls.hydrates.length);
  ok(cntOf(api.get()) === 5, 'T8 兜底成功 → myGroups 恢复全量', 'cnt=' + cntOf(api.get()));
}

// T9 静态锚点：两条哨兵 needle 在源码在位（构建哨兵另有产物核对）
ok(text.includes('if (!v) { myeHydrateFallback(); return; }'), 'T9 哨兵锚点·reload 读空 hydrate 分支在位');
ok(text.includes('window.__xyIdbDeferredKeys.indexOf(MYE_KEY()) >= 0'), 'T9 哨兵锚点·保存防覆盖闸门在位');

console.log('\n' + (fail ? '❌' : '✅') + ' verify-mye-hydrate: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
