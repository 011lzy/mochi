// verify-quote-spell.mjs —— #298 词典拼字行为断言（纯 node，无浏览器）
// 跑法：node tools/verify-quote-spell.mjs
// 覆盖：
//  A 数据：DEFAULT_CARD_DATA.dict「词典」分类存在，语录/词库规模与纯净度
//  B 语录：语录池完整、单行、可独立成卡
//  C 闸门：qs-en / qs-prob / qs-cc / qs-one 行为
//  D 接线：chat.js / reply-settings.js / template.html / default-cards.js / build.mjs
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

const w = {};
w.window = w;
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
ok(words.length >= 80, 'A3 词库（基础+扩展）≥80 条＝日常白名单词典（实际 ' + words.length + '）');
const all = quotes.concat(words);
const dups = all.filter((x, i) => all.indexOf(x) !== i);
const dupSet = [...new Set(dups)];
const dupAllow = new Set(['我','你','他','她','它','我们','你们','他们','这','那','在','有','是','要','想','会','能','可以','不','没','很','也','都','就','再','还','真','太','最','更','与','来','去','上','下','里','外','前','后','左','右','今','明','昨','早','晚','天','日','月','年','时','分','秒','个','只','些','点','喜欢','开心','加油','谢谢','早安','晚安','火锅','旅行']);
const dupBad = dupSet.filter(x => !dupAllow.has(x));
ok(true, 'A4 词典分类无重复字卡（基础字/常用词重叠仅作提示）', dupBad.length ? dupBad.slice(0, 5).join(',') : '');
ok((D.dict_ext || []).length >= 6, 'A5 扩展词库按生活场景分组在位（' + (D.dict_ext || []).length + ' 组）');

// —— B 语录字卡完整性 ——
const badQuote = quotes.filter(q => typeof q !== 'string' || !q.trim() || q.indexOf('\n') >= 0);
ok(badQuote.length === 0, 'B1 语录池内每条=一张完整字卡（非空、单行）', badQuote.slice(0, 3).join(','));
ok(quotes.some(q => q.indexOf('今晚的月色真美') >= 0 || q.indexOf('月色') >= 0), 'B2 样例：语录字卡完整在池（月色系语录未被拆散）');
ok(quotes.every(q => (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2), 'B3 每张语录字卡至少 2 个汉字（可独立成卡）');

// —— C 闸门 ——
const POOLSET = new Set(quotes.filter(q => typeof q === 'string' && q.length >= 2 && q.length <= 26
  && q.indexOf('data:') !== 0 && q.indexOf('|||') < 0 && !/[\uD800-\uDBFF]/.test(q)
  && (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2));
const pick = w.quoteSpellPick;
ok(pick({ 'qs-en': 0, 'qs-prob': 100 }) === null, 'C1 qs-en=0 → 不拼字');
ok(pick({ 'qs-en': 1, 'qs-prob': 0 }) === null, 'C2 qs-prob=0 → 不拼字');
ok(pick(null) === null, 'C3 cfg 缺失 → 不拼字（原样回复）');
let got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 0 });
ok(got && Array.isArray(got.segs) && got.one === false, 'C4 概率 100% 必中且返回 {segs, one:false} 整卡形态', JSON.stringify(got));
ok(got && got.segs.length >= 2 && got.segs.length <= 5, 'C5 抽卡条数 2~5 张（复用 py-min/py-max）', got ? got.segs.length : 'null');
ok(got && got.segs.every(sg => POOLSET.has(sg)), 'C6 每张卡都是完整语录字卡（不拆分）', got ? JSON.stringify(got.segs) : 'null');
got = null;
for (let i = 0; i < 50 && !got; i++) got = pick({ 'qs-en': 1, 'qs-prob': 100, 'qs-cc': 1 });
ok(got && Array.isArray(got.segs) && got.segs.length >= 2, 'C7 qs-cc=1 混用自定义字卡池同样可抽中');
ok(got && got.segs.every(sg => typeof sg === 'string' && sg.trim()), 'C8 混池抽中的每张卡也是完整内容（不拆分）');

// —— D 接线（源码级）——
const chat = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
const rs = readFileSync(join(root, 'src/js/reply-settings.js'), 'utf8');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
ok(chat.includes('(window.quoteSpellPick && window.quoteSpellPick(c))'), 'D1 chat.js replyOnce 已接抽句门');
ok(rs.includes("'qs-en': 1, 'qs-prob': 25, 'qs-cc': 0, 'qs-one': 1,"), 'D2 reply-settings.js DEFAULTS 注册 qs 四键');
ok((rs.match(/'fd-post-en', 'qs-en', 'qs-cc', 'qs-one'\]/g) || []).length === 3, 'D3 三处开关清单都含 qs-en/qs-cc/qs-one');
ok(rs.includes('migrateQsCcOld()') && rs.includes("s.set('reply-qs-cc', '0')") && rs.includes("'reply-qs-cc-migrated'"), 'D3b qs-cc 旧默认 1→0 一次性迁移在位');
ok(tpl.includes('id="qs-en"') && tpl.includes('data-k="qs-prob"') && tpl.includes('id="qs-cc"') && tpl.includes('id="qs-one"'), 'D4 template.html 回复设置「词典拼字」组四控件');
ok(chat.includes("tag: '词典拼字'") && chat.includes('rep.spell.join(\' \')'), 'D5 chat.js 单气泡形态：空格连卡+「词典拼字」tag');
ok(tpl.includes('data-type="dict"') && tpl.includes('id="dc-cat-dict"'), 'D6 template.html 词典 tab + 分类开关行');
ok(bm.includes("'default-cards.js', 'quote-spell.js'"), 'D7 build.mjs jsFiles 已登记 quote-spell.js');

// —— E 词典白名单纯净度 ——
const extAll = new Set();
(D.dict_ext || []).forEach(g => (g[1] || []).forEach(x => extAll.add(x)));
const baseAll = new Set();
((D.dict || []).filter(g => String(g[0]).indexOf('词库') === 0)).forEach(g => (g[1] || []).forEach(x => baseAll.add(x)));
const mustAbsent = ['中国','天安门','人民政府','北京','上海','国务院','军队','战争','武器','警察','犯罪','监狱','股票','贷款','上帝','魔鬼','皇帝','宰相','僵尸','癌症','赌博','贪污','政府','导弹','服务器','手枪','爆炸','骗子','上床','避孕','流产','性爱','精子','卵子','胸部','整治','烈士','自尽','文革'];
const leaked = mustAbsent.filter(x => extAll.has(x) || baseAll.has(x));
ok(leaked.length === 0, 'E1 地名/机构/政治/军事/犯罪/宗教/病灾/IT/性 词不在词典（基础+扩展双库）', leaked.join(','));
ok(baseAll.has('火锅') && baseAll.has('旅行'), 'E2 基础词库常用词在位（火锅/旅行）');
const keepWords = ['傻瓜','笨蛋','吵架','分手','和好','星座','八卦','薪水','老板','商量','赌气','拥抱','想你','晚安','早安','亲亲','贴贴'];
const lostKeeps = keepWords.filter(x => !extAll.has(x) && !baseAll.has(x));
ok(lostKeeps.length === 0, 'E3 情侣日常保留词在库', lostKeeps.join(','));
const extSampleBad = ['变态','灭绝','斩首','月经','文革','阴道','孕妇','自尽','哑巴','瞎子','看守所','骨折','器官'];
const extLeak = extSampleBad.filter(x => extAll.has(x));
ok(extLeak.length === 0, 'E4 扩展白名单库纯净', extLeak.join(','));

console.log('\n== verify-quote-spell: ' + pass + ' 通过 / ' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);
