// gen-dict-ext.mjs —— #301 词典拼字·扩展词库生成工具（白名单维护版）
// 用法：先下载 jieba 词库（https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt，MIT License），
//   curl -o jieba-dict.txt https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt
//   node tools/gen-dict-ext.mjs jieba-dict.txt
// 规则：只维护“日常生活 / 情侣常用 / 基础汉字”的白名单，负面、整治、怪异、性相关词全部拒收。
// 输出：src/js/dict-ext-data.js（词串空格分隔，载入时 split 还原）。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const w = {}; w.window = w;
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/default-cards-data.js'), 'utf8'), w);
const baseWords = new Set();
(w.DEFAULT_CARD_DATA.dict || []).forEach(g => { if (g[0].indexOf('词库') === 0) (g[1] || []).forEach(x => baseWords.add(x)); });

const dictPath = process.argv[2] || path.join(process.env.TEMP || '/tmp', 'jieba-dict.txt');
const lines = fs.readFileSync(dictPath, 'utf8').split('\n');
const cjk = /^[\u4e00-\u9fff]+$/;
const BAD_POS = new Set(['ns', 'nt', 'nr', 'nrt', 'nz']);
const BLACKLIST = new Set(['中国', '天安门', '人民政府', '国务院', '鄂州', '鄂州市', '共产党', '党中央', '全国人大', '解放军', '国家', '祖国', '首都']);
const MORPHEME_BLOCK = ['党', '政', '军', '警', '兵', '罪', '狱', '刑', '赌', '盗', '窃', '匪', '贼', '寇', '凶', '尸', '棺', '坟', '墓', '葬', '皇', '帝', '妃', '衙', '佛', '鬼', '妖', '魔', '巫', '股', '税', '债', '贷', '券', '官', '杀', '血', '死', '武', '贪', '奸', '淫', '妓', '嫖', '毒', '枪', '灾', '祸', '骗', '击', '攻', '仇', '恨', '诡', '诅', '贿', '奴', '雇', '绩', '贸', '主义', '纪念', '人民', '民主', '区域', '平方', '主席', '马克思', '国际', '宪', '革命', '阶级', '剥削', '立法', '司法', '执法', '普法', '国有', '私有', '公有', '共产', '司令', '劳模', '少先', '国务', '纪委', '性爱', '乳房', '精子', '卵子', '胸部', '上床', '避孕', '流产', '月经', '整治', '烈士', '自尽', '文革'];
const WHITELIST = new Set(['我', '你', '我们', '一起', '喜欢', '想你', '晚安', '早安', '抱抱', '贴贴', '亲亲', '加油', '谢谢', '天气', '火锅', '旅行', '开心', '朋友']);
const WORD_BLOCK = new Set([
  '上帝', '教堂', '牧师', '神父', '祷告', '圣经', '庙宇', '寺庙', '风水', '迷信', '占卜', '算命',
  '导弹', '炮弹', '子弹', '炸弹', '枪支', '核武器', '战争', '战场', '战斗', '进攻', '防御', '轰炸', '射击',
  '诈骗', '绑架', '贩毒', '走私', '抢劫', '贪污', '腐败', '贿赂', '法院', '官司', '起诉', '辩护',
  '商业', '商务', '经济', '贸易', '报表', '倒闭', '汇率', '利率', '融资', '基金', '期货', '资本', '货币',
  '癌症', '肿瘤', '艾滋病', '梅毒', '病毒', '感染', '残疾', '毒品', '吸毒',
  '程序', '协议', '函数', '代码', '参数', '变量', '芯片', '接口', '算法', '编程', '服务器', '数据库',
  '干部', '阶级', '斗争', '革命', '选举', '议会', '外交', '国务院', '人大', '委员会', '委员', '常委会',
  '离婚', '负心', '失恋', '出轨', '情妇', '情敌',
  '事故', '难民', '沉船', '遇难', '饥荒', '海难', '空难', '塌方',
  '呕吐', '肛门', '粪便', '放屁', '鼻涕', '尿道', '尿液', '尿布', '拉屎', '撒尿',
  '畜生', '婊子', '混蛋', '贱人', '禽兽', '滚蛋', '他妈的'
]);

const words = [];
let cnt = { pos: 0, bl: 0, morph: 0, word: 0 };
for (const line of lines) {
  const p = line.trim().split(/\s+/);
  if (p.length < 2) continue;
  const word = p[0], freq = parseInt(p[1], 10) || 0;
  const pos = p[2] || '';
  if (word.length < 2 || word.length > 4) continue;
  if (!cjk.test(word)) continue;
  if (BLACKLIST.has(word)) { cnt.bl++; continue; }
  if (BAD_POS.has(pos)) { cnt.pos++; continue; }
  if (WHITELIST.has(word)) { words.push([word, freq]); continue; }
  if (MORPHEME_BLOCK.some(m => word.includes(m))) { cnt.morph++; continue; }
  if (WORD_BLOCK.has(word)) { cnt.word++; continue; }
  words.push([word, freq]);
}
words.sort((a, b) => b[1] - a[1]);
const seen = new Set(baseWords);
const out = [[], [], []];
let n = 0;
for (const [word] of words) {
  if (!seen.has(word)) {
    seen.add(word);
    const gi = word.length === 2 ? 0 : word.length === 3 ? 1 : 2;
    out[gi].push(word); n++;
  }
}
console.log('总数:', n, '| 双字:', out[0].length, '三字:', out[1].length, '四字:', out[2].length);
console.log('剔除: 专名词性=' + cnt.pos, '黑名单=' + cnt.bl, '语素块禁=' + cnt.morph, '词级=' + cnt.word);
const all = new Set([].concat(...out));
const mustAbsent = ['中国', '天安门', '人民政府', '鄂州', '北京', '上海', '国务院', '军队', '战争', '武器', '警察', '犯罪', '监狱', '股票', '贷款', '上帝', '魔鬼', '皇帝', '宰相', '僵尸', '癌症', '赌博', '贪污', '政府', '导弹', '服务器', '手枪', '爆炸', '骗子', '上床', '避孕', '流产', '性爱', '精子', '卵子', '胸部', '整治', '烈士', '自尽', '文革'];
const bad = mustAbsent.filter(x => all.has(x));
if (bad.length) { console.error('!! 仍存在:', bad.join(',')); process.exit(1); }
console.log('黑名单自检通过');
const mustPresent = ['喜欢', '想你', '晚安', '早安', '抱抱', '贴贴', '亲亲', '加油', '天气', '火锅', '旅行', '开心'];
const missing = mustPresent.filter(x => !all.has(x) && !baseWords.has(x));
console.log('白名单/日常词检查:', missing.length ? '缺失 ' + missing.join(',') : '全部在词库');
['和好', '亲亲', '贴贴'].forEach(x => { if (!seen.has(x) && !baseWords.has(x)) { seen.add(x); out[0].push(x); n++; } });
console.log('强制收录后总数:', n);
const groups = [['词库·双字', out[0]], ['词库·三字', out[1]], ['词库·四字', out[2]]];
let src = '// ===== #301 词典拼字·扩展词库（日常/情侣白名单版 v26） =====\n';
src += '// 只保留日常生活、情侣常用、基础汉字与轻量对话词；不收负面、整治、怪异、性相关、太油的词。\n';
src += 'window.DEFAULT_CARD_DATA.dict_ext = [\n';
for (const [name, arr] of groups) {
  src += '  ["' + name + '", ' + JSON.stringify(arr.join(' ')) + '.split(" ")],\n';
}
src += '];\n';
fs.writeFileSync(path.join(root, 'src/js/dict-ext-data.js'), src, 'utf8');
console.log('dict-ext-data.js 生成:', (fs.statSync(path.join(root, 'src/js/dict-ext-data.js')).size / 1024).toFixed(0) + 'KB');
