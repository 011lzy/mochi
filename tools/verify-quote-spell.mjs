// verify-quote-spell.mjs —— #298 词典拼字行为断言（纯 node，无浏览器）
// 跑法：node tools/verify-quote-spell.mjs
// 覆盖：
//  A 数据：DEFAULT_CARD_DATA.dict「词典」分类存在，语录/词库规模达标、无重复卡
//  B 切词：全部语录切成 2~7 段、拼接可还原、无空段；词组命中样例；英文整段；标点吸附
//  C 闸门：qs-en=0 / qs-prob=0 / cfg 缺失 → 不拼字；概率 100% 必中 2~7 段
//  D 接线：chat.js 抽句门 / reply-settings.js DEFAULTS / template.html 控件 / build.mjs jsFiles
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

// —— 沙盒载入数据 + 拼字模块（default-cards.js 依赖 DOM 不载；以其公共 API 语义打桩）——
const w = {};
w.window = w;
// 生产环境 default-cards.js 会把 dict + dict_ext 并组进 DATA.dict（mergeDictCustom），
// 沙盒没有 default-cards.js，getter 按同口径合并，保证 quote-spell 拿到全量词典
w.getDefaultCardGroups = (cat) => {
  const d = w.DEFAULT_CARD_DATA || {};
  const base = d[cat] || [];
  const ext = cat === 'dict' ? (d.dict_ext || []) : [];
  return base.concat(ext);
};
w.isDefaultCardOff = () => false;
w.defaultCardCat = () => true;
vm.runInNewContext(readFileSync(join(root, 'src/js/default-cards-data.js'), 'utf8'), w, { filename: 'default-cards-data.js' });
vm.runInNewContext(readFileSync(join(root, 'src/js/dict-ext-data.js'), 'utf8'), w, { filename: 'dict-ext-data.js' });
vm.runInNewContext(readFileSync(join(root, 'src/js/quote-spell.js'), 'utf8'), w, { filename: 'quote-spell.js' });

const D = w.DEFAULT_CARD_DATA;
const groupsBase = (D && D.dict) || [];
const groupsExt = (D && D.dict_ext) || [];
const allGroups = groupsBase.concat(groupsExt);
const quotesG = allGroups.filter(g => g[0].indexOf('语录') === 0);
const wordsG = allGroups.filter(g => g[0].indexOf('词库') === 0);
const quotes = quotesG.reduce((a, g) => a.concat(g[1] || []), []);
const words = wordsG.reduce((a, g) => a.concat(g[1] || []), []);
ok(allGroups.length >= 4, 'A1 词典分类存在：基础+扩展共 ' + allGroups.length + ' 组（语录/词库·双字/三字/四字/五字+…）');
ok(quotes.length >= 100, 'A2 语录分组 ≥100 条（实际 ' + quotes.length + '）');
ok(words.length >= 20000, 'A3 词库（基础+扩展）≥20000 条＝真词典（实际 ' + words.length + '）');
const all = quotes.concat(words);
const dups = all.filter((x, i) => all.indexOf(x) !== i);
ok(dups.length === 0, 'A4 词典分类无重复字卡', dups.slice(0, 5).join(','));
ok(allGroups.some(g => g[0].indexOf('词库') === 0 && (g[1] || []).length > 5000), 'A5 扩展词库按字数分组在位（万词级大组存在）');

// —— B 切词 ——
const split = w.quoteSpellSplit;
let badLen = null, badSeg = null, badJoin = null;
for (const q of quotes) {
  const segs = split(q);
  if (segs.length < 2 || segs.length > 7) badLen = badLen || (q + ' → ' + segs.length + '段: ' + JSON.stringify(segs));
  if (segs.some(s => !s || !s.trim())) badSeg = badSeg || q;
  if (segs.join('') !== q.replace(/\s+/g, '')) badJoin = badJoin || (q + ' ≠ ' + segs.join(''));
}
ok(!badLen, 'B1 全部语录切出 2~7 段', badLen);
ok(!badSeg, 'B2 全部语录切分无空段', badSeg);
ok(!badJoin, 'B3 切段拼接可还原原句', badJoin);
ok(split('今晚的月色真美').includes('月色'), 'B4 样例：今晚的月色真美 含「月色」词段', JSON.stringify(split('今晚的月色真美')));
ok(split('我想马上去见你').includes('马上'), 'B5 样例：我想马上去见你 含「马上」词段');
ok(JSON.stringify(split('good morning')) === JSON.stringify(['good', 'morning']), 'B6 英文按整段切分', JSON.stringify(split('good morning')));
ok(JSON.stringify(split('想你。')) === JSON.stringify(['想你。']), 'B7 句尾标点吸附到最后一段', JSON.stringify(split('想你。')));
ok(split('abc想你了').join('').indexOf('abc') === 0, 'B8 中英混排不丢内容', JSON.stringify(split('abc想你了')));

// —— C 闸门 ——
// #310 起 pick 可能返回 {segs, one}（单气泡形态），断言用 norm 归一两种形态
const norm = (r) => (r && Array.isArray(r.segs)) ? r.segs : r;
const pick = w.quoteSpellPick;
ok(pick({ 'qs-en': 0, 'qs-prob': 100 }) === null, 'C1 qs-en=0 → 不拼字');
ok(pick({ 'qs-en': 1, 'qs-prob': 0 }) === null, 'C2 qs-prob=0 → 不拼字');
ok(pick(null) === null, 'C3 cfg 缺失 → 不拼字（原样回复）');
let got = null;
for (let i = 0; i < 50 && !got; i++) got = norm(pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 0 }));
ok(Array.isArray(got) && got.length >= 2 && got.length <= 7, 'C5 概率 100% 必中且 2~7 段', JSON.stringify(got));
ok(Array.isArray(got) && got.join('').length >= 3, 'C6 抽中内容非空');
got = null;
for (let i = 0; i < 50 && !got; i++) got = norm(pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 1, 'qs-one': 0 }));
ok(Array.isArray(got) && got.length >= 2 && got.length <= 7, 'C7 qs-cc=1 混用字卡池同样可抽中');

// —— H #310 单气泡拼字（行为级）——
// qs-one=0：60 次掷样只允许返回纯数组（逐词连发形态）
let sawObj = false, h1Array = null;
for (let i = 0; i < 60 && !h1Array && !sawObj; i++) {
  const r = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 0 });
  if (!r) continue;
  if (r && Array.isArray(r.segs)) sawObj = true;
  else h1Array = r;
}
ok(!sawObj && Array.isArray(h1Array) && h1Array.length >= 2 && h1Array.length <= 7, 'H1 qs-one=0 只返回纯数组（逐词连发）', JSON.stringify(sawObj ? '出现对象形态' : h1Array));
// qs-one=1 + 概率 100%：反复掷应同时出现两种形态（50/50 混合，120 次全单形态概率 ~2^-120 可忽略）
let oneCount = 0, multiCount = 0, allSegs = true;
for (let i = 0; i < 120; i++) {
  const r = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 1 });
  if (!r) continue;
  if (Array.isArray(r.segs)) {
    oneCount++;
    const segs = r.segs;
    if (segs.length < 2 || segs.length > 7 || segs.join('').length < 3) allSegs = false;
    if (r.one !== true) allSegs = false;
  } else if (Array.isArray(r)) {
    multiCount++;
    if (r.length < 2 || r.length > 7) allSegs = false;
  } else allSegs = false;
}
ok(allSegs && oneCount > 0 && multiCount > 0, 'H2 qs-one=1 两种形态混合出现（单气泡 ' + oneCount + ' / 逐词 ' + multiCount + '）');
// 单气泡形态内容语义：segs 可空格连卡、内容非空且含 ≥2 个汉字
let oneSegs = null;
for (let i = 0; i < 60 && !oneSegs; i++) {
  const r = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0, 'qs-one': 1 });
  if (r && Array.isArray(r.segs) && r.one === true) oneSegs = r.segs;
}
ok(oneSegs && oneSegs.join(' ').length >= 3 && (oneSegs.join('').match(/[\u4e00-\u9fff]/g) || []).length >= 2, 'H3 单气泡形态 segs 可空格连卡且内容非空', JSON.stringify(oneSegs));

// —— D 接线（源码级）——
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const rs = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
ok(chat.includes('(window.quoteSpellPick && window.quoteSpellPick(c))'), 'D1 chat.js replyOnce 已接抽句门');
ok(rs.includes("'qs-en': 1, 'qs-prob': 25, 'qs-cc': 0, 'qs-one': 1,"), 'D2 reply-settings.js DEFAULTS 注册 qs 四键（#310：qs-cc 默认 0=普通字卡不进抽句池、qs-one 默认开）');
ok((rs.match(/'fd-post-en', 'qs-en', 'qs-cc', 'qs-one'\]/g) || []).length === 3, 'D3 三处开关清单（syncUI/监听/保存）都含 qs-en/qs-cc/qs-one');
ok(rs.includes('migrateQsCcOld()') && rs.includes("s.set('reply-qs-cc', '0')") && rs.includes("'reply-qs-cc-migrated'"), 'D3b #310 qs-cc 旧默认 1→0 一次性迁移在位（migrateQsCcOld）');
ok(tpl.includes('id="qs-en"') && tpl.includes('data-k="qs-prob"') && tpl.includes('id="qs-cc"') && tpl.includes('id="qs-one"'), 'D4 template.html 回复设置「词典拼字」组四控件');
ok(chat.includes("tag: '词典拼字'") && chat.includes('rep.spell.join(\' \')'), 'D7 #310 chat.js 单气泡形态：空格连卡+「词典拼字」tag（复用情绪 chip 链路）');
ok(tpl.includes('data-type="dict"') && tpl.includes('id="dc-cat-dict"'), 'D5 template.html 词典 tab + 分类开关行');
ok(bm.includes("'default-cards.js', 'quote-spell.js'"), 'D6 build.mjs jsFiles 已登记 quote-spell.js');

// —— E #301 v2：词典第一位 + 自建词条（源码级）——
ok(tpl.indexOf('data-type="dict"') >= 0 && tpl.indexOf('data-type="dict"') < tpl.indexOf('data-type="main"')
  && /id="dc-tabs">\s*<button class="cc-tab sel" data-type="dict"/.test(tpl), 'E1 词典 tab 在系统预设字卡第一位且默认选中');
ok(tpl.includes('id="dc-dict-add"') && tpl.includes('id="dc-dict-input"') && tpl.includes('id="dc-dict-add-q"')
  && tpl.includes('id="dc-dict-add-w"') && tpl.includes('id="dc-dict-del"'), 'E2 词典 tab 新增/删除词条控件齐全');
const dc = readFileSync(join(root, 'src/js/default-cards.js'), 'utf8');
ok(dc.includes("const PRESET_DICT = (DATA.dict || []).concat(DATA.dict_ext || [])"), 'E3 基础+扩展词典并组快照（PRESET_DICT 含 dict_ext）');
ok(dc.includes("const gw = base.find(g => g[0].indexOf('词库') === 0)"), 'E3b 自建词并入内置「词库」组（v3.33.x #311：取消独立「词库·自建」分组）');
ok(dc.includes("const BASE_KEYS = ['dict', 'main', 'kaomoji', 'emoji', 'touch'];"), 'E4 BASE_KEYS 词典排第一（页开默认词典 tab）');
ok(dc.includes("(window.__dictCustomSet && window.__dictCustomSet.has(it.c) ? '自建' : '系统')"), 'E5 自建词条「自建」徽标');
ok(dc.includes('window.quoteSpellResetDict') && dc.includes('dictCustWrite'), 'E6 新增/删除后重建词典缓存（quoteSpellResetDict 接线）');
ok(bm.includes("needle: \"const gw = base.find(g => g[0].indexOf('词库') === 0)\""), 'E7 build.mjs #301 哨兵在位（#311 更新锚点）');
ok(bm.includes("'default-cards-data.js', 'dict-ext-data.js', 'default-cards.js'"), 'E8 build.mjs jsFiles 已登记 dict-ext-data.js（先于 default-cards.js）');

// —— F #301 v2：自建词动态词长（行为级：>4 字的词参与切分）——
const presetDictBak = JSON.parse(JSON.stringify(w.DEFAULT_CARD_DATA.dict));
w.DEFAULT_CARD_DATA.dict = [['词库', ['蹦蹦跳跳跳']]];
w.quoteSpellResetDict();
ok(split('我们蹦蹦跳跳跳').includes('蹦蹦跳跳跳'), 'F1 自建 5 字词按整词切分', JSON.stringify(split('我们蹦蹦跳跳跳')));
w.DEFAULT_CARD_DATA.dict = presetDictBak;
w.quoteSpellResetDict();
ok(split('蹦蹦跳跳跳')[0] !== '蹦蹦跳跳跳', 'F2 词典缓存重置生效（恢复后不再切出该词）');
ok(split('今天天气很好').includes('天气'), 'F3 扩展词库参与切分：今天天气很好 → 含「天气」', JSON.stringify(split('今天天气很好')));
ok(split('我想去北京吃火锅').includes('火锅') && !split('我想去北京吃火锅').includes('北京'), 'F4 普通词「火锅」整词切分，地名「北京」已剔除', JSON.stringify(split('我想去北京吃火锅')));
// —— G #301 v4：专名过滤（情侣场景，词典不含地名/机构/人名）——
const extAll = new Set();
(D.dict_ext || []).forEach(g => { if (String(g[0]).indexOf('词库') === 0) (g[1] || []).forEach(x => extAll.add(x)); });
const baseAll = new Set();
((D.dict || []).filter(g => String(g[0]).indexOf('词库') === 0)).forEach(g => (g[1] || []).forEach(x => baseAll.add(x)));
const placeWords = ['中国', '北京', '上海', '天安门', '人民政府', '国务院', '鄂州', '鄂州市', '广东', '深圳', '解放军', '共产党',
  // #301 v5 情侣日常过滤：政治/军事/犯罪/金融/宗教/帝制/病灾/IT 样例
  '军队', '战争', '武器', '警察', '犯罪', '监狱', '股票', '贷款', '上帝', '魔鬼', '皇帝', '宰相', '僵尸', '癌症', '赌博', '贪污', '政府', '导弹', '服务器', '手枪', '爆炸', '骗子', '俘虏', '虐待', '暴力', '神仙', '甲方', '签约', '牢房', '知府', '江湖', '掌门', '畜生', '混蛋', '婊子', '贱人', '算卦', '地震', '火山', '手术', '化疗', '崩溃', '绝望', '背叛', '上床', '避孕', '流产', '打针', '输液', '住院', '怀孕', '浴室', '同居', '俘虏', '虐待', '暴力', '神仙', '甲方', '签约', '牢房', '知府', '马克思主义', '民主集中制', '毛主席纪念堂', '万平方公里', '发展中国家', '本行政区域', '自然保护区', '人民日报', '国家主席', '纪念堂', '阶级', '宪法', '司令', '安定团结', '国共合作', '商品经济'];
const leaked = placeWords.filter(x => extAll.has(x) || baseAll.has(x));
ok(leaked.length === 0, 'G1 地名/机构/政治/军事/犯罪/宗教/病灾/IT 词不在词典（基础+扩展）', leaked.join(','));
ok(extAll.has('天气') && baseAll.has('火锅') && baseAll.has('旅行'), 'G2 剔除专名后普通常用词仍在（天气/火锅/旅行，基础或扩展任一）');
const keepWords = ['傻瓜', '笨蛋', '傻笑', '吵架', '分手', '和好', '星座', '八卦', '薪水', '老板', '商量', '赌气', '拥抱'];
const lostKeeps = keepWords.filter(x => !extAll.has(x) && !baseAll.has(x));
ok(lostKeeps.length === 0, 'G3 情侣日常保留词在库（傻瓜/笨蛋/傻笑/打针/吵架/分手/星座/八卦等）', lostKeeps.join(','));

console.log('\n== verify-quote-spell: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);
