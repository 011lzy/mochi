// ===== 功能：梦角自由造句（#317）=====
// 需求（用户 2026-09-11）：可自由选择开关——梦角（联系人/TA）使用某些词语和句子时，
// 按概率触发「截断某几个字，重新造句」，与词典拼字同族的文字玩法；重造出的句子
// 自动存入【自定义聊天字卡】新增大分类「梦角自由造句」（用户可在字卡库查看/删除，
// 「就和之前截断拼接的那样」——重造句卡会作为语料被再次抽用，滚雪球生长）。
//
// 规则：
//   语料源 = 自定义聊天字卡文本池（getCustomCards 过滤出 ≥4 个汉字的纯文本卡）。
//   触发 = 回复设置「梦角自由造句」开关 mjf-en + 概率 mjf-prob（每条回复掷一次）。
//   造句 = 抽 1 张语料卡 → 从句中随机截掉 1~3 个连续字（截断点随机）→ 补一个
//          「补位词」（语气/可爱系小词池随机）→ 拼回成一句新话（例：
//          「今天也要好好爱自己」截「爱自己」→「今天也要好好想你了」）。
//   入库 = 新句存当前联系人专属库 cc-groups 新分类 mjfree（分组「梦角自由造句」），
//          走 chatcard.js 的 ccAppendCards 公共 API（双作用域写守卫/去重/持久化复用）；
//          分类在 CC_FUNC_KEYS 语义里＝只进本功能抽取与管理页，不进聊天通用回复池。
//   发送 = chat.js replyOnce 命中后把本条回复替换成新句，气泡下挂「梦角自由造句」tag。
// 设置项（回复设置 → 聊天 tab，见 reply-settings.js DEFAULTS）：
//   mjf-en   总开关（0=关，默认关；用户点名「可自由选择开关」）
//   mjf-prob 触发概率（%，0=不触发）
// 接线：build.mjs jsFiles +1（quote-spell 后）；chat.js replyOnce 消费 window.dreamFreePick。
// 纯本地，无网络请求。
(function () {
  // 补位小词池：截断处替换用的语气/可爱系词，保证截断后的句子仍读得通、有 TA 的语气
  const FILL_WORDS = ['想你', '抱抱', '亲亲', '嘿嘿', '哦', '呀', '啦', '嘛', '呢', '哼',
    '想你了', '最喜欢你', '晚安', '早安', '嘿嘿嘿', '哼哼', '呜呜', '嘻嘻', '好耶', '喵'];
  let lastSrc = '';   // 连续防复读：上一条造句的源卡不立刻重抽
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
  // 从句中随机截掉 1~3 个连续汉字，在截断处补一个补位词，返回新句；截不出（句太短）返回 null
  function rebuild(s) {
    const str = String(s == null ? '' : s);
    // 汉字游程列表 [起,止)——截断只发生在连续汉字段内，不碰标点/emoji/字母
    const runs = [];
    let i = 0;
    while (i < str.length) {
      if (/[\u4e00-\u9fff]/.test(str[i])) {
        let j = i;
        while (j < str.length && /[\u4e00-\u9fff]/.test(str[j])) j++;
        runs.push([i, j]);
        i = j;
      } else i++;
    }
    const cand = runs.filter(r => r[1] - r[0] >= 3); // 截 1~3 字后至少留 1 字
    if (!cand.length) return null;
    const r = cand[Math.floor(Math.random() * cand.length)];
    const maxCut = Math.min(3, r[1] - r[0] - 1);
    const cut = 1 + Math.floor(Math.random() * maxCut);
    const at = r[0] + Math.floor(Math.random() * (r[1] - r[0] - cut + 1));
    const fill = FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
    return str.slice(0, at) + fill + str.slice(at + cut);
  }
  // 抽句门：c = replyCfg()。命中返回 { text: 新句, src: 源卡 }；关闭/未命中/造不出返回 null。
  window.dreamFreePick = function (c) {
    try {
      if (!c || c['mjf-en'] !== 1) return null;
      const prob = Number(c['mjf-prob']);
      if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
      const pool = corpusPool();
      if (!pool.length) return null;
      for (let t = 0; t < 6; t++) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s === lastSrc) continue;
        const txt = rebuild(s);
        if (txt && txt !== s) { lastSrc = s; return { text: txt, src: s }; }
      }
      return null;
    } catch (e) { return null; }
  };
  // 造句结果入库：写当前联系人专属库 cc-groups 的 mjfree 分类「梦角自由造句」分组
  //（chatcard.js 提供 window.ccAppendCards(type, group, cards)，写守卫/去重/持久化复用）
  window.dreamFreeSave = function (txt) {
    try {
      const v = String(txt == null ? '' : txt);
      if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return false;
      if (window.ccAppendCards) return !!window.ccAppendCards('mjfree', '梦角自由造句', [v]);
      return false;
    } catch (e) { return false; }
  };
})();
