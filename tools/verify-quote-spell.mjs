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
const wordsG = allGroups.filter(g => g[0].indexOf('词库') === 0 || (D.dict_ext || []).some(eg => eg[0] === g[0]));
const quotes = quotesG.reduce((a, g) => a.concat(g[1] || []), []);
const words = wordsG.reduce((a, g) => a.concat(g[1] || []), []);
ok(allGroups.length >= 4, 'A1 词典分类存在：基础+扩展共 ' + allGroups.length + ' 组');
ok(quotes.length >= 100, 'A2 语录分组 ≥100 条（实际 ' + quotes.length + '）');
// v25 白名单模式：扩展库为人工精选日常+情侣词（1414 词），黑名单清剿模式已废弃
ok(words.length >= 1200, 'A3 词库（基础+扩展）≥1200 条＝白名单真词典（实际 ' + words.length + '）');
const all = quotes.concat(words);
const dups = all.filter((x, i) => all.indexOf(x) !== i);
ok(dups.length === 0, 'A4 词典分类无重复字卡', dups.slice(0, 5).join(','));
ok((D.dict_ext || []).length >= 10, 'A5 扩展词库按生活场景分组在位（' + (D.dict_ext || []).length + ' 组：美食/起居/亲密/情感/称谓…）');

// —— B 语录字卡完整性（v27：语录=完整字卡，永不拆分）——
// v27：「今晚的月色真美」是一张完整的字卡，拼字=卡片拼卡片。语录必须原样在池中。
const badQuote = quotes.filter(q => typeof q !== 'string' || !q.trim() || q.indexOf('\n') >= 0);
ok(badQuote.length === 0, 'B1 语录池内每条=一张完整字卡（非空、单行）', badQuote.slice(0, 3).join(','));
ok(quotes.some(q => q.indexOf('今晚的月色真美') >= 0 || q.indexOf('月色') >= 0), 'B2 样例：语录字卡完整在池（月色系语录未被拆散）');
ok(quotes.every(q => (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2), 'B3 每张语录字卡至少 2 个汉字（可独立成卡）');

// —— C 闸门 ——
// #310 起 pick 可能返回 {segs, one}（单气泡形态），断言用 norm 归一两种形态
const norm = (r) => (r && Array.isArray(r.segs)) ? r.segs : r;
// —— C 闸门（v27：抽卡门返回 {segs: 完整语录数组 2~5 张, one:false}）——
const POOLSET = new Set(quotes.filter(q => typeof q === 'string' && q.length >= 2 && q.length <= 26
  && q.indexOf('data:') !== 0 && q.indexOf('|||') < 0 && !/[\uD800-\uDBFF]/.test(q)
  && (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2));
const pick = w.quoteSpellPick;
ok(pick({ 'qs-en': 0, 'qs-prob': 100 }) === null, 'C1 qs-en=0 → 不拼字');
ok(pick({ 'qs-en': 1, 'qs-prob': 0 }) === null, 'C2 qs-prob=0 → 不拼字');
ok(pick(null) === null, 'C3 cfg 缺失 → 不拼字（原样回复）');
let got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0 });
ok(got && Array.isArray(got.segs) && got.one === false, 'C5 概率 100% 必中且返回 {segs, one:false} 整卡形态', JSON.stringify(got));
ok(got && got.segs.length >= 2 && got.segs.length <= 5, 'C6 抽卡条数 2~5 张（复用 py-min/py-max）', got ? got.segs.length : 'null');
ok(got && got.segs.every(sg => POOLSET.has(sg)), 'C7 每张卡都是完整语录字卡（不拆分）', got ? JSON.stringify(got.segs) : 'null');
got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 1 });
ok(got && Array.isArray(got.segs) && got.segs.length >= 2, 'C8 qs-cc=1 混用自定义字卡池同样可抽中');
ok(got && got.segs.every(sg => typeof sg === 'string' && sg.trim()), 'C9 混池抽中的每张卡也是完整内容（不拆分）');

// —— H v27 整卡连发（行为级）——
// 60 掷：全部返回 {segs: 完整语录数组, one:false}，无单字拆分、无 one:true 形态
let sawCharSplit = false, h2Count = 0, h2Bad = null;
for (let i = 0; i < 60; i++) {
  const r = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0 });
  if (!r) continue;
  if (!r || !Array.isArray(r.segs) || r.one !== false) { h2Bad = h2Bad || '形态错误'; break; }
  h2Count++;
  // 关键断言：每张卡必须是池中原样的完整语录（不允许「今」「晚」这类拆字卡）
  r.segs.forEach(sg => {
    if (!POOLSET.has(sg)) { h2Bad = h2Bad || sg; sawCharSplit = true; }
  });
}
ok(h2Count >= 40 && !h2Bad, 'H1 60 掷全部=完整语录字卡逐条连发（零拆字）', h2Bad || (h2Count + ' 次有效'));
ok(!sawCharSplit, 'H2 抽中的每张卡都原样来自语录池（「今晚的月色真美」整卡出现）', sawCharSplit ? '出现拆字卡' : '');
ok(POOLSET.has('今晚的月色真美') || [...POOLSET].some(q => q.indexOf('月色') >= 0), 'H3 月色系语录以完整字卡形态在池');

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
// v27：切词引擎已整体移除（拼字卡=整张语录字卡连发），原 F 组切词断言随之废弃；
// 词库只作字卡库展示，拆卡/切词行为由 H 组「零拆字」断言守卫。
// —— G #301 v4：专名过滤（情侣场景，词典不含地名/机构/人名）——
const extAll = new Set();
// v25 白名单模式：扩展库组名为生活场景名（美食饮品/情感心情/…），全部计入
(D.dict_ext || []).forEach(g => (g[1] || []).forEach(x => extAll.add(x)));
const baseAll = new Set();
((D.dict || []).filter(g => String(g[0]).indexOf('词库') === 0)).forEach(g => (g[1] || []).forEach(x => baseAll.add(x)));
const placeWords = ['中国', '北京', '上海', '天安门', '人民政府', '国务院', '鄂州', '鄂州市', '广东', '深圳', '解放军', '共产党',
  // #301 v5 情侣日常过滤：政治/军事/犯罪/金融/宗教/帝制/病灾/IT 样例
  '军队', '战争', '武器', '警察', '犯罪', '监狱', '股票', '贷款', '上帝', '魔鬼', '皇帝', '宰相', '僵尸', '癌症', '赌博', '贪污', '政府', '导弹', '服务器', '手枪', '爆炸', '骗子', '俘虏', '虐待', '暴力', '神仙', '甲方', '签约', '牢房', '知府', '江湖', '掌门', '畜生', '混蛋', '婊子', '贱人', '算卦', '地震', '火山', '手术', '化疗', '崩溃', '绝望', '背叛', '寂寞', '孤独', '离别', '迷茫', '无助', '虚伪', '冷漠', '嫉妒', '判决', '通缉', '疫苗', '合同', '谈判', '手铐', '理论', '逻辑', '痛苦', '折磨', '悲伤', '哭泣', '冲突', '危机', '危险', '上床', '避孕', '流产', '打针', '输液', '住院', '怀孕', '浴室', '同居', '左派', '右派', '卫队', '乳房', '性爱', '精子', '卵子', '太监', '尚书', '央行', '激素', '耳光', '打架', '斗殴', '肝病', '体罚', '内伤', '报社', '地质', '联赛', '裁判', '档案', '公文', '博弈', '参议员', '公务员', '病理', '诊断', '炎症', '悲惨', '悲痛', '沮丧', '狮子', '鲨鱼', '鳄鱼', '蝎子', '考核', '报销', '证据', '被告', '原告', '硅谷', '破产', '赤字', '部队', '公社', '知青', '骰子', '酗酒', '肝炎', '肺炎', '精神病', '神经病', '乞丐', '秃头', '看守所', '喝酒', '吸烟', '谣言', '出卖', '算计', '衰老', '俘虏', '虐待', '暴力', '神仙', '甲方', '签约', '牢房', '知府', '马克思主义', '民主集中制', '毛主席纪念堂', '万平方公里', '发展中国家', '本行政区域', '自然保护区', '人民日报', '国家主席', '纪念堂', '阶级', '宪法', '司令', '安定团结', '国共合作', '商品经济'];
const leaked = placeWords.filter(x => extAll.has(x) || baseAll.has(x));
ok(leaked.length === 0, 'G1 地名/机构/政治/军事/犯罪/宗教/病灾/IT/性 词不在词典（基础+扩展双库）', leaked.join(','));
// v25 白名单模式：基础词库自带天气/火锅/旅行等常用词，扩展库补场景词
ok(baseAll.has('火锅') && baseAll.has('旅行'), 'G2 基础词库常用词在位（火锅/旅行）');
const keepWords = ['傻瓜', '笨蛋', '傻笑', '吵架', '分手', '和好', '星座', '八卦', '薪水', '老板', '商量', '赌气', '拥抱', '想你', '晚安', '早安', '亲亲', '贴贴'];
const lostKeeps = keepWords.filter(x => !extAll.has(x) && !baseAll.has(x));
const astroWords = ['宇宙', '星系', '行星', '光年', '银河', '陨石', '彗星', '太阳系'];
const lostAstro = astroWords.filter(x => !extAll.has(x) && !baseAll.has(x));
ok(lostAstro.length === 0, 'G4 天文浪漫意象词在库（宇宙/星系/行星/光年/银河/陨石/彗星/太阳系）', lostAstro.join(','));
ok(lostKeeps.length === 0, 'G3 情侣日常保留词在库（傻瓜/笨蛋/吵架/分手/星座/八卦/想你/晚安等 18 词）', lostKeeps.join(','));
// v25 白名单模式专项：扩展库不含黑名单模式残留词（抽样确认白名单纯净度）
const extSampleBad = ['变态', '灭绝', '斩首', '月经', '文革', '阴道', '孕妇', '自尽', '哑巴', '瞎子', '看守所', '骨折', '器官'];
const extLeak = extSampleBad.filter(x => extAll.has(x));
ok(extLeak.length === 0, 'G5 扩展白名单库纯净（变态/灭绝/斩首/月经/文革/阴道/孕妇/自尽等 13 词不在）', extLeak.join(','));

console.log('\n== verify-quote-spell: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);
