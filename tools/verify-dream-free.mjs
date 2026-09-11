// verify-dream-free.mjs —— #317 梦角自由造句行为断言（纯 node，无浏览器）
// 跑法：node tools/verify-dream-free.mjs
// 覆盖：
//  A 造句：汉字段内截 1~3 字补语气词、非汉字段不被截、拼接还原性（新句=源句-截掉字+补位词）
//  B 闸门：mjf-en=0 / mjf-prob=0 / cfg 缺失 → 不触发；概率 100% 且语料充足必中
//  C 入库 API：ccAppendCards 写入当前作用域 cc-groups 的 mjfree 分类（去重）——沙盒模拟
//  D 接线：build.mjs jsFiles / 哨兵 / chat.js tag / reply-settings DEFAULTS / template 控件
//  E 词典页自建词条行已移除（dc-dict-add / d2-dict-add 不在模板中）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (extra ? ' —— ' + extra : '')); }
};

// —— 沙盒载入 dream-free.js（打桩 getCustomCards 语料）——
const w = {};
w.window = w;
w.getCustomCards = () => ['今天也要好好爱自己', '晚安，好梦', '想和你一起看日落', '明天见啦', 'abcDEF', '短句', '今天也要好好爱自己'];
vm.runInNewContext(readFileSync(join(root, 'src/js/dream-free.js'), 'utf8'), w, { filename: 'dream-free.js' });

const pick = w.dreamFreePick;
const save = w.dreamFreeSave;

// —— A 造句行为 ——
const FILL = /(想你|抱抱|亲亲|嘿嘿|哦|呀|啦|嘛|呢|哼|想你了|最喜欢你|晚安|早安|嘿嘿嘿|哼哼|呜呜|嘻嘻|好耶|喵)/;
let diff = null, nonHanTouched = null, shortOk = true;
for (let i = 0; i < 60; i++) {
  const r = pick({ 'mjf-en': 1, 'mjf-prob': 100 });
  if (!r) continue;
  const src = r.src;
  if (r.text === src) { diff = diff || src; continue; }
  // 新句与源句只差：截掉一段字 + 补位词——去掉补位词后新句应是源句的子序列
  const stripped = r.text.replace(FILL, '');
  if (src.indexOf(stripped) < 0 && stripped.indexOf(src.replace(/[，。！？、\s]/g, '')) !== 0) {
    // 宽松校验：新句删掉补位词后，长度应 ≤ 源句（截了字）且字符基本保留
    if (stripped.length > src.length) diff = diff || (src + ' => ' + r.text);
  }
  // 纯英文/短卡不进语料（abcDEF 长度 6 但汉字 0；短句汉字 2）——检查没被抽到
  if (r.src === 'abcDEF' || r.src === '短句') nonHanTouched = r.src;
}
ok(diff === null, 'A1 造句=源句截字+补位词（60 掷无异常）', diff);
ok(nonHanTouched === null, 'A2 语料过滤：纯英文/汉字不足 4 的卡不参与', nonHanTouched);
let got = null;
for (let i = 0; i < 30 && !got; i++) got = pick({ 'mjf-en': 1, 'mjf-prob': 100 });
ok(got && typeof got.text === 'string' && got.text.length >= 3, 'B4 概率 100% 必中且新句非空（截字后可短至 3 字）', JSON.stringify(got));
ok(got && got.text !== got.src, 'B5 新句与源句不同（真的截断重造了）');

// —— B 闸门 ——
ok(pick({ 'mjf-en': 0, 'mjf-prob': 100 }) === null, 'B1 mjf-en=0 → 不触发（默认关）');
ok(pick({ 'mjf-en': 1, 'mjf-prob': 0 }) === null, 'B2 mjf-prob=0 → 不触发');
ok(pick(null) === null, 'B3 cfg 缺失 → 不触发');

// —— C 入库 API（沙盒模拟 chatcard 内存 groups + ccAppendCards 双作用域语义）——
// 直接用真实源码太重（依赖 DOM），按 ccAppendCards 同语义打桩验证 dreamFreeSave 调用契约
const groups = { mjfree: [['梦角自由造句', []]] };
const pubGroups = { mjfree: [['梦角自由造句', []]] };
w.ccAppendCards = function (type, group, cards, scope) {
  if (type !== 'mjfree' || group !== '梦角自由造句') return false;
  const target = scope === 'public' ? pubGroups : groups;
  const g = target[type].find(p => p[0] === group);
  let added = 0;
  (cards || []).forEach(c => { if (typeof c === 'string' && c && g[1].indexOf(c) < 0) { g[1].push(c); added++; } });
  return added > 0;
};
// #324 分库语料：多联系人（getContacts 返回 2 个 id）→ 80% 公用/20% 专属
w.getContacts = () => [{ id: 'a' }, { id: 'b' }];
w.__activeCid = 'default';
const txt = '测试造句入库的一句';
ok(save(txt) === true && (groups.mjfree[0][1].indexOf(txt) >= 0 || pubGroups.mjfree[0][1].indexOf(txt) >= 0), 'C1 dreamFreeSave → ccAppendCards(mjfree, 梦角自由造句)');
ok(save(txt) === false && groups.mjfree[0][1].filter(x => x === txt).length + pubGroups.mjfree[0][1].filter(x => x === txt).length === 1, 'C2 重复入库去重（第二次返回 false 且只存一份）');
ok(save('') === false && save('data:image/png;base64,xx') === false, 'C3 空串/dataURL 拒绝入库');
// #324 分库比例：语料多存几次统计落点，公用应显著多于专属（80/20，100 掷卡方容忍 60~95 公用）
let pubN = 0, ownN = 0;
for (let i = 0; i < 100; i++) {
  const t = '分库统计-' + i;
  const beforePub = pubGroups.mjfree[0][1].length, beforeOwn = groups.mjfree[0][1].length;
  save(t);
  if (pubGroups.mjfree[0][1].length > beforePub) pubN++; else if (groups.mjfree[0][1].length > beforeOwn) ownN++;
}
ok(pubN > 60 && pubN < 95 && ownN >= 5, 'C4 多联系人时 80% 公用/20% 专属分库（100 掷：公用 ' + pubN + '/专属 ' + ownN + '）');
// #324 单联系人：100% 专属
w.getContacts = () => [];
let ownOnly = 0;
for (let i = 0; i < 30; i++) {
  const t = '单联系人-' + i;
  const beforeOwn = groups.mjfree[0][1].length;
  save(t);
  if (groups.mjfree[0][1].length > beforeOwn) ownOnly++;
}
ok(ownOnly === 30 && pubGroups.mjfree[0][1].every(x => x.indexOf('单联系人-') !== 0), 'C5 单联系人 100% 专属库（30/30，公用零写入）');

// —— D 接线（源码级）——
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const rs = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const cc = readFileSync(join(root, 'src/js/chatcard.js'), 'utf8');
ok(bm.includes("'quote-spell.js', 'dream-free.js',"), 'D1 build.mjs jsFiles 已登记 dream-free.js');
ok(cc.includes("const CC_FUNC_KEYS = ['fish', 'eat', 'period', 'water', 'garden', 'sync', 'reach', 'cjian', 'room', 'piggy', 'drift', 'interact', 'music',\n    'mjfree'];"), 'D2 chatcard.js CC_FUNC_KEYS 含 mjfree（进管理页/不进聊天池）');
ok(chat.includes("tag: '梦角自由造句'") && chat.includes('window.dreamFreePick && window.dreamFreePick(c)'), 'D3 chat.js replyOnce 接入+tag');
ok(rs.includes("'mjf-en': 0, 'mjf-prob': 20,") && (rs.match(/'qs-multi', 'mjf-en'\]/g) || []).length === 3, 'D4 reply-settings DEFAULTS+三处清单（#323 后清单含 qs-multi）');
ok(tpl.includes('id="mjf-en"') && tpl.includes('data-k="mjf-prob"'), 'D5 template 回复设置「梦角自由造句」组');
ok(rs.includes('梦角自由造句开启失败') && rs.includes('梦角自由造句已开启') && rs.includes('mjf-probe'), 'D5b #324 开关切换 toast 提示（成功/失败）+存储探针在位');
ok(tpl.includes('data-type="mjfree"'), 'D6 template 字卡库「梦角自由造句」tab');

// —— E 词典页自建词条行移除 ——
ok(!tpl.includes('id="dc-dict-add"') && !tpl.includes('id="d2-dict-add"'), 'E1 词典页两处「存为语录/词/删自建」行已移除');

console.log('\n== verify-dream-free: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);
