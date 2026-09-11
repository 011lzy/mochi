// ===== 功能：词典拼字（#298）=====
// 需求（用户 2026-09-11）：联系人回复可按概率触发「词典拼字」——从语录词库随机抽一句
//（内容来源可选：自定义字卡+词典语录混用 / 只用词典语录），用内置词典按词切开，
// 逐词连发多条气泡（如「今晚的月色真美」→ 今晚|的|月色|真美 四条气泡先后弹出）。
// 纯本地，无网络请求。
// 数据源：DEFAULT_CARD_DATA.dict（default-cards-data.js「词典」分类，「语录/词库」两分组，
// 与字卡库【系统预设字卡→词典】tab 同源）；「语录」受分类开关 dc-cat-dict 与单卡开关
// dc-off-dict:* 控制，「词库」只决定切分方式、不作为消息内容发送。
// 设置项（回复设置 → 聊天 tab「词典拼字」组，见 reply-settings.js DEFAULTS）：
//   qs-en   总开关（1=开）
//   qs-prob 拼字概率（%，每条回复掷一次；0=不触发）
//   qs-cc   混用自定义字卡（1=字卡池+语录库合并抽句；0=只用词典语录）
//   qs-one  单气泡拼字（v3.28.x #310：1=命中拼字后 50% 掷成「单气泡」形态——
//           切出的词用空格连成一张字卡发进同一个聊天气泡、气泡下挂「词典拼字」tag；
//           0=只走逐词连发多条；两种形态共用同一拼字概率混合触发）
// 接线：chat.js replyOnce 在 genOneReply 之后调 window.quoteSpellPick(c)，命中则逐词连发，
// 下游收藏/心情分享/情绪链/撤回等链路原样复用。
(function () {
  const MIN_SEGS = 2;   // 切出 2~7 段才走拼字（<2 段没意义，>7 段刷屏）
  const MAX_SEGS = 7;
  const MAX_WORD = 4;   // 内置词典最长词长（正向最大匹配窗口下限）
  const MAX_WORD_CAP = 8; // 自建词可到 8 字（用户要求词典自由扩充；超 8 字按截断处理）
  let lastQuote = '';   // 连续防复读：上一条拼字句不立刻重抽
  let dictSet = null;   // 切词词典缓存（词库分组构建一次）
  let dictMax = MAX_WORD; // 实际匹配窗口：随词典（含自建词）最长词增长

  // 中英文标点 + 空白（标点吸附判定用）
  function PUNCT(ch) {
    if (/[\s\u3000]/.test(ch)) return true;
    return '，。！？；：、…—·~～（）「」『』《》〈〉【】.,!?;:\'"()<>[]{}-_=/+*&#@$%^|'.indexOf(ch) >= 0;
  }
  function isAllPunct(s) {
    for (let i = 0; i < s.length; i++) { if (!PUNCT(s[i])) return false; }
    return true;
  }
  function getDict() {
    if (dictSet) return dictSet;
    dictSet = new Set();
    dictMax = MAX_WORD;
    try {
      const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
      // 组名「词库*」前缀匹配：基础词库 + 扩展词库（dict-ext-data.js）+ 自建词，全进切词
      grps.forEach(g => {
        if (!g || typeof g[0] !== 'string' || g[0].indexOf('词库') !== 0) return;
        (g[1] || []).forEach(w => {
          if (typeof w !== 'string' || w.length < 2) return;
          dictSet.add(w);
          if (w.length > dictMax && w.length <= MAX_WORD_CAP) dictMax = w.length;
        });
      });
    } catch (e) {}
    return dictSet;
  }
  // #301：词典 tab 新增/删除自建词后由 default-cards.js 调用，强制重建词典缓存
  window.quoteSpellResetDict = function () { dictSet = null; };
  // 正向最大匹配切词：词典命中最长 4 字词；英文/数字连续段整体成词；标点吸附到前段；
  // 未命中回落单字。返回非空段数组（拼接后 = 原句去空白）。
  function splitWords(s) {
    const str = String(s == null ? '' : s);
    const raw = [];
    let i = 0;
    while (i < str.length) {
      const ch = str[i];
      if (PUNCT(ch)) {
        let j = i;
        while (j < str.length && PUNCT(str[j])) j++;
        raw.push({ t: str.slice(i, j), p: true });
        i = j;
        continue;
      }
      if (/[A-Za-z0-9]/.test(ch)) {
        let j = i;
        while (j < str.length && /[A-Za-z0-9]/.test(str[j])) j++;
        raw.push({ t: str.slice(i, j), p: false });
        i = j;
        continue;
      }
      let len = 0;
      const dict = getDict();
      for (let L = Math.min(dictMax, str.length - i); L >= 2; L--) {
        if (dict.has(str.slice(i, i + L))) { len = L; break; }
      }
      if (len) { raw.push({ t: str.slice(i, i + len), p: false }); i += len; }
      else { raw.push({ t: ch, p: false }); i += 1; }
    }
    // 标点吸附：纯标点段并入前一个词段（句首标点暂存并入后一段）
    const out = [];
    let pending = '';
    for (let k = 0; k < raw.length; k++) {
      const it = raw[k];
      if (it.p) {
        if (out.length) out[out.length - 1] += it.t;
        else pending += it.t;
        continue;
      }
      out.push(pending + it.t);
      pending = '';
    }
    if (pending) {
      if (out.length) out[out.length - 1] += pending;
      else out.push(pending);
    }
    return out.map(x => x.replace(/\s+/g, '')).filter(x => x);
  }
  // 拼字抽句池：词典语录（受分类/单卡开关控制）；qs-cc=1 时由 pick 再并入自定义字卡池
  function quotePool() {
    let quotes = [];
    try {
      if (window.defaultCardCat && window.defaultCardCat('dict') === false) return quotes;
      const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
      // 组名「语录*」前缀匹配：内置语录 + 自建语录，全进抽句池
      grps.forEach(g => {
        if (!g || typeof g[0] !== 'string' || g[0].indexOf('语录') !== 0) return;
        (g[1] || []).forEach(q => { if (typeof q === 'string') quotes.push(q); });
      });
    } catch (e) { quotes = []; }
    try {
      if (window.isDefaultCardOff) quotes = quotes.filter(q => !window.isDefaultCardOff('dict', q));
    } catch (e) {}
    return quotes.filter(function (q) {
      if (typeof q !== 'string' || q.length < 3 || q.length > 26) return false;
      if (q.indexOf('data:') === 0 || q.indexOf('|||') >= 0) return false;
      if (/[\uD800-\uDBFF]/.test(q)) return false; // emoji 整卡不拼
      return (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
    });
  }
  // 暴露切词器（verify 脚本与排查用）
  window.quoteSpellSplit = splitWords;
  // 抽句门：c = replyCfg()。命中返回切段数组（2~7 段）；关闭/未命中/切不出返回 null（走原回复）。
  // #310：qs-one 开时命中后 50% 掷成单气泡形态，返回 { segs, one: true }（one 缺省=false
  // 即逐词连发；chat.js 两种返回形态都兼容），两种形态共用同一拼字概率混合触发。
  window.quoteSpellPick = function (c) {
    try {
      if (!c || c['qs-en'] !== 1) return null;
      const prob = Number(c['qs-prob']);
      if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
      let pool = quotePool();
      if (c['qs-cc'] === 1) {
        try {
          const p = (window.getPool && window.getPool()) || null;
          if (p && p.text && p.text.length) {
            pool = pool.concat(p.text.filter(function (s) {
              if (typeof s !== 'string' || s.length < 3 || s.length > 26) return false;
              if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
              if (/[\uD800-\uDBFF]/.test(s)) return false;
              return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
            }));
          }
        } catch (e) {}
      }
      if (!pool.length) return null;
      for (let t = 0; t < 4; t++) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s === lastQuote) continue;
        const segs = splitWords(s);
        if (segs.length >= MIN_SEGS && segs.length <= MAX_SEGS) {
          lastQuote = s;
          if (c['qs-one'] === 1 && Math.random() < 0.5) return { segs: segs, one: true };
          return segs;
        }
      }
      return null;
    } catch (e) { return null; }
  };
})();
