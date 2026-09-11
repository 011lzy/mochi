// ===== 功能：梦角自由造句（#317 / #326 手法多样化+词典词边界）=====
// 需求（用户 2026-09-11）：可自由选择开关——梦角（联系人/TA）使用某些词语和句子时，
// 按概率触发「截断某几个字，重新造句」，与词典拼字同族的文字玩法；重造出的句子
// 自动存入【自定义聊天字卡】大分类「梦角自由造句」（可在字卡库查看/删除，且会作为
// 语料被再次抽用，滚雪球生长）。
// #326（用户 2026-09-11）：手法多样化——不再只有「截字+补词」，每次造句随机选一种：
//   ① cutfill  截字补词：抽掉句中一个词、原位补一个语气词（如「今天也要好好爱自己」→
//              「今天也要好好想你了」）；
//   ② comma    词边界加逗号：在词与词的间隙插入「，」（如「今天也要，好好爱自己」）；
//   ③ space    词边界加空格：在词间隙插入空格（与词典拼字单气泡同味道，如「今天 也要 好好爱自己」）；
//   ④ suffix   句尾加语气后缀（如「今天也要好好爱自己呀」）；
//   ⑤ tailcut  删句尾字（如「今天也要好好爱自」）。
// 词边界来自内置词典（DEFAULT_CARD_DATA.dict「词库*」分组，正向最大匹配切词）——
// 插入/截断只落在词与词的间隙，不截在词中间，避免病句。
// 入库规则（#324）：多联系人 80% 进公用库 / 20% 进专属库；单联系人 100% 专属库。
// 设置项（回复设置 → 聊天 tab「梦角自由造句」组）：mjf-en（默认关）、mjf-prob（默认 20%）。
// 接线：build.mjs jsFiles；chat.js replyOnce 消费 window.dreamFreePick（气泡带「梦角自由造句」tag）。
// 纯本地，无网络请求。
(function () {
  // 补位词池：截词处替换用的语气/可爱系词，保证截断后的句子仍读得通、有 TA 的语气
  const FILL_WORDS = ['想你', '抱抱', '亲亲', '嘿嘿', '哦', '呀', '啦', '嘛', '呢', '哼',
    '想你了', '最喜欢你', '晚安', '早安', '嘿嘿嘿', '哼哼', '呜呜', '嘻嘻', '好耶', '喵'];
  // 句尾后缀池（suffix 手法用）
  const SUFFIXES = ['呀', '啦', '哦', '呢', '嘛', '哟', '哈', '嘿嘿'];
  let lastSrc = '';     // 连续防复读：上一条造句的源卡不立刻重抽
  let segDict = null;   // 切词词典缓存（词库* 分组构建一次）
  let segMax = 4;       // 正向最大匹配窗口（随词典最长词增长，上限 8）
  const HAN = /[\u4e00-\u9fff]/;
  function getSegDict() {
    if (segDict) return segDict;
    segDict = new Set();
    segMax = 4;
    try {
      ((window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || []).forEach(g => {
        if (!g || typeof g[0] !== 'string' || g[0].indexOf('词库') !== 0) return;
        (g[1] || []).forEach(wd => {
          if (typeof wd !== 'string' || wd.length < 2) return;
          segDict.add(wd);
          if (wd.length > segMax && wd.length <= 8) segMax = wd.length;
        });
      });
    } catch (e) {}
    return segDict;
  }
  // 正向最大匹配切词：词典命中最长词，未命中回落单字；非汉字段（标点/字母）整体成 token
  function segment(s) {
    const str = String(s == null ? '' : s);
    const dict = getSegDict();
    const out = [];
    let i = 0;
    while (i < str.length) {
      if (!HAN.test(str[i])) {
        let j = i;
        while (j < str.length && !HAN.test(str[j])) j++;
        out.push(str.slice(i, j));
        i = j;
        continue;
      }
      let len = 0;
      for (let L = Math.min(segMax, str.length - i); L >= 2; L--) {
        if (dict.has(str.slice(i, i + L))) { len = L; break; }
      }
      if (!len) len = 1;
      out.push(str.slice(i, i + len));
      i += len;
    }
    return out;
  }
  const isWordTok = t => HAN.test(t); // 含汉字＝词 token（非汉字 token 视为标点/符号段）
  // 语料池：自定义聊天字卡文本（≥4 个汉字才够截），剔 dataURL/媒体令牌/空白
  function corpusPool() {
    let cards = [];
    try { cards = (window.getCustomCards && window.getCustomCards()) || []; } catch (e) { cards = []; }
    return cards.filter(function (s) {
      if (typeof s !== 'string') return false;
      if (s.length < 4 || s.length > 30) return false;
      if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
      if (/[\uD800-\uDBFF]/.test(s)) return false;
      return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 4;
    });
  }
  const MODES = ['cutfill', 'comma', 'space', 'suffix', 'tailcut'];
  // 重造句：s = 源句，mode = 手法。造不出（句太短/无可插边界）返回 null。
  function rebuild(s, mode) {
    const str = String(s == null ? '' : s);
    if (mode === 'comma' || mode === 'space') {
      const toks = segment(str);
      if (toks.length < 3) return null;
      const gaps = [];
      for (let i = 1; i < toks.length; i++) {
        if (isWordTok(toks[i - 1]) && isWordTok(toks[i])) gaps.push(i); // 只落在词与词的间隙
      }
      if (!gaps.length) return null;
      const gi = gaps[Math.floor(Math.random() * gaps.length)];
      const sep = mode === 'comma' ? '，' : ' ';
      const out = toks.slice(0, gi).join('') + sep + toks.slice(gi).join('');
      return out !== str ? out : null;
    }
    if (mode === 'suffix') {
      const base = str.replace(/[，。！？、…～\s]+$/, '');
      if (base.length < 3) return null;
      const out = base + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
      return out !== str ? out : null;
    }
    if (mode === 'tailcut') {
      const base = str.replace(/[，。！？、…～\s]+$/, '');
      if (base.length < 4) return null;
      const cut = 1 + Math.floor(Math.random() * Math.min(2, base.length - 2));
      return base.slice(0, base.length - cut);
    }
    // cutfill（默认）：按词典切词后，抽掉一个 ≥2 字的词、原位补语气词——不截在词中间
    const toks = segment(str);
    const idxs = [];
    toks.forEach((t, idx) => { if (t.length >= 2 && isWordTok(t)) idxs.push(idx); });
    if (!idxs.length) return null;
    const wi = idxs[Math.floor(Math.random() * idxs.length)];
    const fill = FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
    const out = toks.slice(0, wi).join('') + fill + toks.slice(wi + 1).join('');
    return out !== str ? out : null;
  }
  // 抽句门：c = replyCfg()。命中返回 { text: 新句, src: 源卡 }；关闭/未命中/造不出返回 null。
  window.dreamFreePick = function (c) {
    try {
      if (!c || c['mjf-en'] !== 1) return null;
      const prob = Number(c['mjf-prob']);
      if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
      const pool = corpusPool();
      if (!pool.length) return null;
      for (let t = 0; t < 8; t++) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s === lastSrc) continue;
        const mode = MODES[Math.floor(Math.random() * MODES.length)];
        const txt = rebuild(s, mode);
        if (txt && txt !== s) { lastSrc = s; return { text: txt, src: s }; }
      }
      return null;
    } catch (e) { return null; }
  };
  // 造句结果入库（#324 分库规则）：多联系人时 80% 进公用库、20% 进当前联系人专属库；
  // 只有一个桌面联系人时 100% 进专属库（公用库没有分享对象，全部留专属）。
  // 写 cc-groups 的 mjfree 分类「梦角自由造句」分组（chatcard.js window.ccAppendCards，
  // 写守卫/去重/持久化复用；scope 'public'|'own' 双作用域）
  window.dreamFreeSave = function (txt) {
    try {
      const v = String(txt == null ? '' : txt);
      if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return false;
      if (!window.ccAppendCards) return false;
      let cids = 1;
      try {
        const set = new Set([window.__activeCid || 'default']);
        (window.getContacts && window.getContacts() || []).forEach(c => { if (c && c.id) set.add(c.id); });
        cids = set.size;
      } catch (e) { cids = 1; }
      const usePublic = cids > 1 && Math.random() < 0.8;
      return !!window.ccAppendCards('mjfree', '梦角自由造句', [v], usePublic ? 'public' : 'own');
    } catch (e) { return false; }
  };
  // 暴露切词/造句（verify 脚本与排查用）
  window.dreamFreeSegment = segment;
  window.dreamFreeRebuild = rebuild;
})();
