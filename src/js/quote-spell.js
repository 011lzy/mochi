// ===== 功能：词典拼字（#298 / v27 拼字卡=整张语录字卡连发 / #323 双形态混合）=====
// 需求（用户 2026-09-11 v27 定稿）：**「今晚的月色真美」本身是一张完整的字卡，不许拆**。
// 「拼字」= 从语录字卡库抽 2~5 张完整语录字卡——字卡和字卡拼在一起才叫拼字。
// #323（用户 2026-09-11）：两种发送形态共用同一拼字概率、混合触发，各自可开关——
//   ① 单气泡形态（qs-one，默认开）：几张字卡各中间空一格，拼成一条消息发进同一个聊天气泡；
//   ② 多回复形态（qs-multi，默认开）：每张字卡单独一条气泡逐条连发——不依赖「多字卡回复」
//      开关（py-en 关、没触发多字卡回复时也会触发）、不受「回复条数」reply-min/max 限制；
//      短字卡（一两个字）本来就适合一条一条发。
//   两种形态都命中时（都开）各 50% 掷币；都关 = 拼字只按逐卡形态兜底（qs-en 开着不能完全没形态）。
//   每条气泡/单气泡下都显示「词典拼字」tag。
// 纯本地，无网络请求。
// 数据源：DEFAULT_CARD_DATA.dict「语录」分组（128 条手写语录，每条=一张完整字卡）+
// 自建语录；受分类开关 dc-cat-dict 与单卡开关 dc-off-dict:* 控制。
// 设置项（回复设置 → 聊天 tab「词典拼字」组，见 reply-settings.js DEFAULTS）：
//   qs-en    总开关（1=开）
//   qs-prob  拼字概率（%，每条回复掷一次；0=不触发）
//   qs-cc    混用自定义字卡（1=字卡池+语录库合并抽卡；0=只用词典语录）
//   qs-one   单气泡形态开关（1=开）
//   qs-multi 多回复逐卡连发形态开关（1=开）
//   条数复用「多字卡回复」的 py-min/py-max（2~5 张，与既有设置一起的）
// 接线：chat.js replyOnce 在 genOneReply 之后调 window.quoteSpellPick(c)，命中返回
// { segs: 完整语录字卡数组, one: true|false }；下游收藏/心情分享/情绪链/撤回等链路原样复用。
(function () {
  let lastQuote = '';   // 连续防复读：上一条拼字首卡不立刻重抽
  // 拼字抽卡池：词典语录（受分类/单卡开关控制）；qs-cc=1 时由 pick 再并入自定义字卡池
  function quotePool() {
    let quotes = [];
    try {
      if (window.defaultCardCat && window.defaultCardCat('dict') === false) return quotes;
      const grps = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
      // 组名「语录*」前缀匹配：内置语录 + 自建语录，全进抽卡池
      grps.forEach(g => {
        if (!g || typeof g[0] !== 'string' || g[0].indexOf('语录') !== 0) return;
        (g[1] || []).forEach(q => { if (typeof q === 'string') quotes.push(q); });
      });
    } catch (e) { quotes = []; }
    try {
      if (window.isDefaultCardOff) quotes = quotes.filter(q => !window.isDefaultCardOff('dict', q));
    } catch (e) {}
    return quotes.filter(function (q) {
      if (typeof q !== 'string' || q.length < 2 || q.length > 26) return false;
      if (q.indexOf('data:') === 0 || q.indexOf('|||') >= 0) return false;
      if (/[\uD800-\uDBFF]/.test(q)) return false; // emoji 整卡不拼
      return (q.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
    });
  }
  // 拼字卡抽取门：c = replyCfg()。命中返回 { segs: 完整语录字卡数组(2~5张), one: false }；
  // 关闭/未命中返回 null（走原回复）。one:false = 每张卡一条气泡逐条连发。
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
              if (typeof s !== 'string' || s.length < 2 || s.length > 26) return false;
              if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
              if (/[\uD800-\uDBFF]/.test(s)) return false;
              return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 2;
            }));
          }
        } catch (e) {}
      }
      if (!pool.length) return null;
      // 抽卡条数：复用「多字卡回复」设置 py-min/py-max（默认 2~5 张）
      const pmin = Math.max(1, Math.min(10, Number(c['py-min']) || 2));
      const pmax = Math.max(pmin, Math.min(10, Number(c['py-max']) || 5));
      const want = pmin + Math.floor(Math.random() * (pmax - pmin + 1));
      const cards = [pool[Math.floor(Math.random() * pool.length)]];
      for (let k = 0; k < 30 && cards.length < want; k++) {
        const s2 = pool[Math.floor(Math.random() * pool.length)];
        if (cards.indexOf(s2) < 0) cards.push(s2);
      }
      lastQuote = cards[0];
      // #323 形态选择：qs-one 单气泡 / qs-multi 多回复逐卡，双开各 50% 掷币；
      // 只开其一会中该形态；双关（qs-en 开但两个形态开关都关）= 兜底逐卡形态，避免拼字开关空转
      const oneOn = c['qs-one'] === 1;
      const multiOn = c['qs-multi'] === 1;
      let one;
      if (oneOn && multiOn) one = Math.random() < 0.5;
      else if (oneOn) one = true;
      else if (multiOn) one = false;
      else one = false;
      return { segs: cards, one: one };
    } catch (e) { return null; }
  };
})();
