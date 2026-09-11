// ===== 功能：心意币拍卖会（聊天页更多功能 → 小游戏） =====
// 和 TA 面对面竞拍的三件神秘拍品：看图猜价值，加价轮替出价，落槌价从「心意币」
// 真实账本里扣（走 giftWalletGet/Set 直接扣减，同心意集市购买路径，不误入赚钱流水）；
// 拍下的收进本游戏的 🎒 小收藏（按联系人桌面存 localStorage）。
// TA 无真 AI：每件拍品暗抽一个「心理价位」（底价 × 状态系数）+ 行为状态——
//   eager 志在必得（敢超价位跟价）/ normal 常规 / stingy 提前收手 / bluff 虚张声势
//   （快步加价营造抢手假象，价位一到可能突然放弃）。出价全靠心情，没有算牌。
// 流程：每场 3 件拍品 → 每件你先表态（＋¥1 / ＋¥5 / ＋¥13.14 / 不拍了）→ TA 掂量后
// 跟价或放弃 → 你赢=扣款收藏、TA 赢=TA 收走（不改账本）、没人要=流拍。
// 结算：写聊天系统消息（special:'auction'）+ TA 随机回应（复用字卡库回应分组）。
// 保护：出价不会超过心意币余额（不够只出不拍）；TA 拍走/流拍不动账本。
// 入口绑定在本文件内完成（不改 chat.js），半框容器复用 .poke-card 与 .pong-overlay 组件。
(function () {
  const panel = document.getElementById('chat-auction-panel');
  if (!panel) return;
  const stageEl = document.getElementById('au-stage');
  const itemEl = document.getElementById('au-item');
  const lotEl = document.getElementById('au-lot');
  const balanceEl = document.getElementById('au-balance');
  const statusEl = document.getElementById('au-status');
  const overlayEl = document.getElementById('au-overlay');
  const ovTitleEl = document.getElementById('au-ov-title');
  const ovBodyEl = document.getElementById('au-ov-body');
  const startBtn = document.getElementById('au-btn-start');
  const endBtn = document.getElementById('au-btn-end');
  const bid1Btn = document.getElementById('au-bid1');
  const bid5Btn = document.getElementById('au-bid5');
  const bid13Btn = document.getElementById('au-bid13');
  const passBtn = document.getElementById('au-pass');
  const bagBtn = document.getElementById('au-bag');
  const soundBtn = document.getElementById('au-sound');
  const closeBtn = document.getElementById('au-close');
  const fsBtn = document.getElementById('au-fs');

  // ---- #306 全屏：面板 fixed 满屏（共享 .game-fs 类，同 pong-fs 机制）。 ----
  // 重开面板无论上次怎么关的（含兄弟互斥直接 hidden）都先退出，防全屏残留 ----
  let isFs = false;
  function toggleFs() {
    isFs = !isFs;
    panel.classList.toggle('game-fs', isFs);
    if (fsBtn) fsBtn.textContent = isFs ? '⤢' : '⛶';
    setTimeout(() => { try { if (typeof fitBoard === 'function') fitBoard(); } catch (e) {} }, 60);
  }
  if (fsBtn) fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
  const partnerNameEl = document.getElementById('au-partner-name');

  const STEP1 = 100, STEP5 = 500, STEP13 = 1314;      // 加价档（分）
  // 拍品池：base=底价(分)，wish=拍下后彩蛋文案；TA 心理价位 = base × 状态系数
  // #301 mystery:1 = 蒙面拍品（开拍只给描述猜是什么，落槌/拍走才揭晓）
  const POOL = [
    { ico: '🌹', name: '永生玫瑰', desc: '不会枯的那种', base: 520, wish: '花会谢，心意不会。' },
    { ico: '🧸', name: 'Mochi 玩偶', desc: '捏起来很解压', base: 900, wish: '想我的时候就捏捏它。' },
    { ico: '🧋', name: '奶茶年卡', desc: '每天一杯半糖去冰', base: 1314, wish: '第一杯请你喝。' },
    { ico: '🎧', name: '降噪耳机', desc: '世界的开关', base: 1990, wish: '戴上就是我的世界。' },
    { ico: '🎮', name: '复古掌机', desc: '内置 520 个小游戏，猜猜是什么', base: 2600, wish: '双人游戏留给你。', mystery: 1 },
    { ico: '📷', name: '拍立得', desc: '把此刻留住', base: 3130, wish: '第一张拍你。' },
    { ico: '⌚', name: '情侣对表', desc: '一对，走时一致，猜猜是什么', base: 5200, wish: '以后时间一起过。', mystery: 1 },
    { ico: '🧣', name: '手织围巾', desc: '织错的针脚都是心意', base: 1314, wish: '歪的地方是我想你。' },
    { ico: '🍰', name: '下午茶券', desc: '双人份，周末有效', base: 520, wish: '周末不见不散。' },
    { ico: '🎫', name: '演唱会门票', desc: '两张，你偶像的，猜猜是什么', base: 3999, wish: '合唱那首你跑调的。', mystery: 1 },
    { ico: '💐', name: '全明星花束', desc: '什么花都有一点', base: 1314, wish: '像你，什么都好。' },
    { ico: '💎', name: '小钻戒', desc: '别紧张，不是那种……大概', base: 9999, wish: '先占个位置。', mystery: 1 }
  ];
  // TA 行为状态：系数=心理价位底价倍数；stepPref=TA 加价档偏好；talk=开场台词
  const TA_MODES = {
    eager:  { factor: 1.5,  stepPref: [STEP5, STEP13, STEP13], talk: '眼睛亮了，志在必得' },
    normal: { factor: 1.15, stepPref: [STEP1, STEP5, STEP13],  talk: '掂了掂这件的分量' },
    stingy: { factor: 0.7,  stepPref: [STEP1, STEP1, STEP5],   talk: '皱着眉算了算' },
    bluff:  { factor: 1.2,  stepPref: [STEP13, STEP5, STEP5],  talk: '一路跟得飞快，像真想要' }
  };
  const TALK_MIN = 850, TALK_VAR = 900;
  const LOTS_PER_SESSION = 3;

  const T = window.taFit || function (x) { return x; };
  function prefix() { return (window.activePrefix && window.activePrefix()) || 'xy-home-v2'; }
  function fastMul() { return (window.__auDebug && window.__auDebug.fast) ? 0.05 : 1; }
  function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function yuan(fen) { return '¥' + (fen / 100).toFixed(2); }

  // ---- 音效 ----
  let audioCtx = null, soundOn = true;
  function beep(freq, dur, vol) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.value = vol || 0.16;
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  const sfxBid = () => beep(520, 0.07, 0.15);
  const sfxHammer = () => { beep(880, 0.08, 0.18); setTimeout(() => beep(520, 0.12, 0.16), 90); };
  const sfxLose = () => beep(300, 0.12, 0.14);
  const sfxWin = () => { beep(660, 0.14, 0.2); setTimeout(() => beep(880, 0.2, 0.2), 130); };

  // ---- 心意币账本（直接读改，同心意集市购买路径；读不到时禁拍只围观） ----
  function walletOk() { return typeof window.giftWalletGet === 'function' && typeof window.giftWalletSet === 'function'; }
  function myBalance() {
    try { const w = window.giftWalletGet(); return (w && Number(w.myBalance)) || 0; } catch (e) { return 0; }
  }
  function walletDeduct(fen) {
    try {
      const w = window.giftWalletGet();
      if (!w || (Number(w.myBalance) || 0) < fen) return false;
      w.myBalance = (Number(w.myBalance) || 0) - fen;
      window.giftWalletSet(w);
      return true;
    } catch (e) { return false; }
  }

  // ---- 战绩 / 收藏（每联系人独立） ----
  function statsKey() { return prefix() + ':auction-stats'; }
  function loadStats() {
    const d = { sessions: 0, myWins: 0, taWins: 0, spentFen: 0 };
    try {
      const raw = localStorage.getItem(statsKey());
      if (raw) { const v = JSON.parse(raw); if (v && typeof v === 'object') return Object.assign(d, v); }
    } catch (e) {}
    return d;
  }
  function saveStats(s) { try { localStorage.setItem(statsKey(), JSON.stringify(s)); } catch (e) {} }
  function bagKey() { return prefix() + ':auction-items'; }
  function loadBag() {
    try { const a = JSON.parse(localStorage.getItem(bagKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveBag(a) { try { localStorage.setItem(bagKey(), JSON.stringify(a)); } catch (e) {} }
  // #301 TA 回寄：TA 拍走的拍品 2~4 天后寄回给你（进你的 🎒，附一句留言）
  function giftsKey() { return prefix() + ':au-gifts-pending'; }
  function loadPending() { try { const a = JSON.parse(localStorage.getItem(giftsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function savePending(a) { try { localStorage.setItem(giftsKey(), JSON.stringify(a)); } catch (e) {} }
  let giftTimer = null;
  function checkGifts() {
    const pend = loadPending();
    if (!pend.length) return;
    const now = Date.now();
    let delivered = 0;
    const rest = [];
    pend.forEach((p) => {
      if (p.due <= now) {
        const bag = loadBag();
        bag.unshift({ ico: p.ico, name: p.name, fen: 0, ts: Date.now(), from: 'ta' });
        saveBag(bag);
        delivered++;
        try { if (window.chatAddIn) window.chatAddIn(T('TA') + ' 把之前拍走的「' + p.name + '」寄给你了，纸条上写：拍品该物归原主呀', {}); } catch (e) {}
      } else rest.push(p);
    });
    if (rest.length !== pend.length) savePending(rest);
    if (delivered && statusEl && !panel.hidden) setStatus('📬 ' + T('TA') + ' 寄来了 ' + delivered + ' 件拍品，已收进 🎒');
  }

  // ---- 场次状态 ----
  let st = null;
  let thinkT = null;

  function newState() {
    const lots = shuffle(POOL.slice()).slice(0, LOTS_PER_SESSION);
    return {
      started: false,
      over: false,           // 一场是否结束
      lots: lots,            // 本场拍品
      idx: 0,                // 当前第几件
      phase: 'idle',         // idle / bidding / done
      cur: 0,                // 当前出价（分）
      leader: 'none',        // none / you / ta
      mode: 'normal',        // TA 本件状态
      limit: 0,              // TA 心理价位（分）
      spent: 0, myWins: 0, taWins: 0, passed: 0
    };
  }

  // ---- 渲染 ----
  function renderLot() {
    const item = st.lots[st.idx];
    if (lotEl) lotEl.textContent = '第 ' + (st.idx + 1) + ' / ' + st.lots.length + ' 件';
    if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
    if (itemEl) {
      let bidTxt;
      if (st.leader === 'none') bidTxt = '起拍价 ' + yuan(st.cur);
      else if (st.leader === 'you') bidTxt = '你的出价 ' + yuan(st.cur);
      else bidTxt = T('TA') + ' 出价 ' + yuan(st.cur);
      // #301 蒙面拍品：开拍只给描述，落槌才揭晓
      const showIco = item.mystery ? '🎁' : item.ico;
      const showName = item.mystery ? '神秘拍品' : item.name;
      itemEl.innerHTML =
        '<div class="au-ico">' + showIco + '</div>' +
        '<div class="au-name">' + showName + '</div>' +
        '<div class="au-desc">' + item.desc + '</div>' +
        '<div class="au-bid">' + bidTxt + '</div>';
    }
    updateBidBtns();
  }
  function lotActive() { return st && st.started && !st.over && st.phase === 'bidding'; }
  function updateBidBtns() {
    // TA 正在掂量我的出价时（leader=you 且思考定时器还挂着）锁全键盘，防连出价/抢跑放弃
    const waiting = lotActive() && st.leader === 'you' && !!thinkT;
    const on = lotActive() && !waiting && walletOk() && myBalance() >= st.cur + STEP1;
    [bid1Btn, bid5Btn, bid13Btn].forEach((b) => { if (b) b.disabled = !on; });
    if (passBtn) passBtn.disabled = !lotActive() || waiting;
    [bid1Btn, bid5Btn, bid13Btn].forEach((b, i) => {
      if (b && on) {
        const step = [STEP1, STEP5, STEP13][i];
        b.disabled = myBalance() < st.cur + step;
      }
    });
  }
  function setStatus(html) { if (statusEl) statusEl.innerHTML = html; }
  // #301 中局 TA 泡泡（同其余小游戏）
  let bubbleT = null;
  function taSay(text) {
    if (!stageEl) return;
    try {
      let b = stageEl.querySelector('.tg-bubble');
      if (!b) { b = document.createElement('div'); b.className = 'tg-bubble'; stageEl.appendChild(b); }
      b.textContent = text;
      b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
      clearTimeout(bubbleT);
      bubbleT = setTimeout(() => { try { b.classList.remove('show'); } catch (e) {} }, 1600);
    } catch (e) {}
  }

  // ---- 拍卖流程 ----
  function newSession() {
    clearTimeout(thinkT); thinkT = null;
    st = newState();
    st.started = true;
    hideOverlay();
    openLot();
  }
  function openLot() {
    st.phase = 'bidding';
    const r = Math.random();
    st.mode = r < 0.25 ? 'eager' : r < 0.6 ? 'normal' : r < 0.85 ? 'stingy' : 'bluff';
    const item = st.lots[st.idx];
    st.cur = item.base;
    st.leader = 'none';
    let factor = TA_MODES[st.mode].factor;
    st.lucky = (typeof window.arcadeMult === 'function') && window.arcadeMult('auction') === 2;
    if (st.lucky) factor *= 0.8;   // #301 幸运拍卖：TA 今天手松，价位打八折
    st.limit = Math.max(100, Math.round(item.base * factor / 10) * 10);
    renderLot();
    if (st.lucky) {
      if (typeof window.arcadeMarkLuckyPlayed === 'function') window.arcadeMarkLuckyPlayed('auction');
      setStatus('🍀 今日幸运拍卖：' + T('TA') + '今天手松——' + TA_MODES[st.mode].talk + '，你来出价');
    } else {
      setStatus('槌起！' + T('TA') + TA_MODES[st.mode].talk + '——你来出价');
    }
  }
  // 你的加价：出价 = 当前价 + step；随后轮到 TA 掂量
  function myBid(step) {
    if (!lotActive()) return;
    const bal = myBalance();
    if (!walletOk() || bal < st.cur + step) return;
    st.cur = st.cur + step;
    st.leader = 'you';
    sfxBid();
    renderLot();
    scheduleTaThink('TA低头想了想……');
  }
  function myPass() {
    if (!lotActive()) return;
    // 我放弃：我持最高价=直接落槌；否则 TA 价位够就 TA 拍走，否则流拍
    if (st.leader === 'you') { hammer('you'); return; }
    if (st.limit >= st.cur) { taTake(); return; }
    passLot();
  }
  function scheduleTaThink(line) {
    clearTimeout(thinkT);
    setStatus(T(line));
    updateBidBtns();
    thinkT = setTimeout(taThink, Math.round((TALK_MIN + Math.random() * TALK_VAR) * fastMul()));
  }
  function taThink() {
    clearTimeout(thinkT); thinkT = null;
    if (!st || !st.started || st.over || st.phase !== 'bidding') return;
    const m = TA_MODES[st.mode];
    // bluff：价位一到有概率突然收手（虚张声势戳破）
    if (st.mode === 'bluff' && st.cur >= st.limit && Math.random() < 0.35) { taFold(); return; }
    if (st.cur < st.limit) {
      // TA 跟价：+随机一档（eager 敢顶到价位，其余留一点余量）
      let step = pick(m.stepPref) || STEP1;
      let bid = st.cur + step;
      if (st.mode !== 'eager' && bid > st.limit) bid = st.limit;
      st.cur = Math.max(bid, st.cur + STEP1);
      st.leader = 'ta';
      sfxBid();
      renderLot();
      taSay(pick(['跟！', '这件我要了', '就这点诚意？', '继续呀']));
      setStatus(T('TA') + '举牌：' + yuan(st.cur) + '——到你出价了');
      updateBidBtns();
    } else {
      if (st.mode === 'bluff') taSay(pick(['好吧，被你看穿了', '其实……也就那样']));
      taFold();
    }
  }
  function taFold() {
    if (st.leader === 'you') { hammer('you'); return; }
    // TA 都不要且我没出过价 → 流拍
    passLot();
  }
  function taTake() {
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    st.taWins++;
    sfxLose();
    const s = loadStats();
    s.taWins = (s.taWins || 0) + 1;
    saveStats(s);
    const item = st.lots[st.idx];
    sfxHammer();
    // #301 TA 回寄排队：2~4 天后寄回给你
    try {
      const pend = loadPending();
      pend.push({ ico: item.ico, name: item.name, due: Date.now() + (2 + Math.floor(Math.random() * 3)) * 86400000 });
      savePending(pend);
    } catch (e) {}
    showOverlay(T('TA') + '拍得了',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat">' + item.name + ' · ' + yuan(st.cur) + ' 归 ' + T('TA') + '</div>' +
      '<div class="pong-end-stat">📬 不过 TA 拍走的拍品，过几天会寄回给你</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算');
    setStatus(T('TA') + '把「' + item.name + '」抱走了');
    try {
      const fb = ['这件归我啦。', '嘿嘿，到手。', '眼光不错吧。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏胜利·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      setTimeout(() => { try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {} }, 800);
    } catch (e) {}
    nextLotBtn();
  }
  function passLot() {
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    st.passed++;
    const item = st.lots[st.idx];
    showOverlay('流拍了',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat">' + item.name + ' 没人要，收回仓库</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算');
    setStatus('「' + item.name + '」流拍了');
    try {
      const fb = ['这玩意没人要啊。', '亏本了亏本了。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏平局·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      setTimeout(() => { try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {} }, 800);
    } catch (e) {}
    nextLotBtn();
  }
  // 我赢：真实扣款 + 收进 🎒
  function hammer() {
    st.phase = 'done';
    clearTimeout(thinkT); thinkT = null;
    const item = st.lots[st.idx];
    if (!walletDeduct(st.cur)) {
      showOverlay('扣款失败', '<div class="pong-end-stat">心意币余额不够了，这件不算了</div>', st.idx + 1 < st.lots.length ? '下一件' : '结算');
      nextLotBtn();
      return;
    }
    st.myWins++;
    st.spent += st.cur;
    const s = loadStats();
    s.myWins = (s.myWins || 0) + 1;
    s.spentFen = (s.spentFen || 0) + st.cur;
    saveStats(s);
    const bag = loadBag();
    bag.push({ ico: item.ico, name: item.name, fen: st.cur, ts: Date.now() });
    saveBag(bag);
    sfxWin(); sfxHammer();
    taSay(pick(['被你拍走了…', '亏了亏了', '那件我本来想要来着']));
    if (balanceEl) balanceEl.textContent = walletOk() ? '心意币 ' + yuan(myBalance()) : '心意币 —';
    showOverlay('落槌！',
      '<div class="au-ov-ico">' + item.ico + '</div>' +
      '<div class="pong-end-stat">' + item.name + ' · ' + yuan(st.cur) + ' 拍下</div>' +
      '<div class="pong-end-stat">💌 ' + item.wish + '</div>' +
      '<div class="pong-end-stat">已收进 🎒 小收藏（剩 ' + yuan(myBalance()) + '）· 可在 🎒 里转赠给 ' + T('TA') + '</div>',
      st.idx + 1 < st.lots.length ? '下一件' : '结算');
    setStatus('「' + item.name + '」是你的了，花了 ' + yuan(st.cur));
    try {
      const fb = ['被你拍走了…', '亏了亏了。', '那件本来我想要来着。'];
      const pool = window.getInteractPool ? window.getInteractPool('游戏失败·回应', fb) : fb;
      const say = pool[Math.floor(Math.random() * pool.length)] || fb[0];
      setTimeout(() => { try { if (window.chatAddIn) window.chatAddIn(say, { silent: true }); } catch (e) {} }, 800);
    } catch (e) {}
    nextLotBtn();
  }
  function nextLotBtn() {
    if (startBtn) startBtn.textContent = st.idx + 1 < st.lots.length ? '下一件' : '结算';
    if (endBtn) endBtn.hidden = false;
  }
  function advance() {
    if (!st) return;
    if (st.idx + 1 < st.lots.length) {
      st.idx++;
      openLot();
    } else {
      endSession();
    }
  }
  // 一场结束：汇总 + 聊天联动
  function endSession() {
    st.over = true;
    st.phase = 'idle';
    const s = loadStats();
    s.sessions = (s.sessions || 0) + 1;
    saveStats(s);
    showOverlay('本场结束',
      '<div class="pong-end-stat">你拍得 ' + st.myWins + ' 件 · 花了 ' + yuan(st.spent) + '</div>' +
      '<div class="pong-end-stat">' + T('TA') + ' 拍走 ' + st.taWins + ' 件 · 流拍 ' + st.passed + ' 件</div>' +
      '<div class="pong-end-stat">累计 ' + s.sessions + ' 场 · 🎒 收藏 ' + loadBag().length + ' 件</div>',
      '再来一场');
    if (startBtn) startBtn.textContent = '再来一场';
    if (endBtn) endBtn.hidden = false;
    setStatus('本场结束，点击「再来一场」');
    try {
      let txt = T('心意币拍卖会') + ' · ';
      if (st.myWins) txt += '拍下 ' + st.myWins + ' 件 ' + yuan(st.spent);
      else txt += '空手而归';
      if (st.taWins) txt += ' · ' + T('TA') + ' 拍走 ' + st.taWins + ' 件';
      if (window.chatAddSystem) window.chatAddSystem(txt, { special: 'auction' });
    } catch (e) {}
  }

  // ---- 🎒 小收藏（#301 支持转赠心意柜） ----
  function showBag() {
    const bag = loadBag();
    const body = bag.length
      ? bag.map((it, i) =>
          '<div class="pong-end-stat au-bag-row">' + it.ico + ' ' + it.name + ' · ' + (it.from === 'ta' ? T('TA') + ' 寄来的' : yuan(it.fen)) +
          (it.from === 'ta' ? '' : ' <button class="pong-overlay-btn au-send-btn" data-i="' + i + '" type="button">送' + T('TA') + '</button>') + '</div>').join('')
      : '<div class="pong-end-stat">还什么都没拍到</div>';
    showOverlay('🎒 拍品收藏（' + bag.length + '）', body, '返回');
    if (startBtn) startBtn.textContent = st && st.started && !st.over ? '返回' : '开场拍卖';
    if (endBtn) endBtn.hidden = !(st && st.started && !st.over);
  }
  // 转赠：写心意柜「我送TA」记录（gift-shop 的 recordGiftBox，走既有心意柜渲染），拍品移出收藏
  function giftAway(i) {
    const bag = loadBag();
    const it = bag[i];
    if (!it) return;
    const wish = '拍卖会上抢到的，转送给你';
    try {
      if (typeof window.recordGiftBox === 'function') {
        window.recordGiftBox({ id: 'au_' + Date.now(), giftId: '', name: it.name, emoji: it.ico, img: '', price: it.fen / 100, cat: '拍卖会', wish: wish }, 'out', wish);
      }
    } catch (e) {}
    bag.splice(i, 1);
    saveBag(bag);
    sfxHammer();
    taSay(pick(['送给我的？！', '谢谢，我很喜欢！', '怎么突然对我这么好']));
    try {
      if (window.chatAddSystem) window.chatAddSystem(T('心意币拍卖会') + ' · 转赠 ' + T('TA') + '「' + it.name + '」', { special: 'auction' });
    } catch (e) {}
    setTimeout(() => {
      try { if (window.chatAddIn) window.chatAddIn(pick(['收下啦！超喜欢', '你也喜欢就好', '下次拍卖会我让给你一件']), { silent: true }); } catch (e) {}
    }, 900);
    showBag();
  }

  // ---- 覆盖层 ----
  function showOverlay(title, body, btnText) {
    if (!overlayEl) return;
    if (ovTitleEl) ovTitleEl.innerHTML = title || '';
    if (ovBodyEl) ovBodyEl.innerHTML = body || '';
    if (startBtn && btnText) startBtn.textContent = btnText;
    overlayEl.hidden = false;
    updateBidBtns();
  }
  function showStartOverlay() {
    const s = loadStats();
    showOverlay('心意币拍卖会',
      '<div class="c4-start-tip">每场 3 件拍品，和 ' + T('TA') + ' 轮番举牌<br>落槌价从心意币里真扣，拍到的收进 🎒</div>' +
      '<div class="c4-start-note">🎲 ' + T('TA') + '每件的心理价位是暗的——志在必得/常规/抠门/虚张声势</div>' +
      (s.sessions > 0 ? '<div class="pong-end-stat">累计 ' + s.sessions + ' 场 · 你拍得 ' + s.myWins + ' 件 · 花了 ' + yuan(s.spentFen || 0) + '</div>' : '') +
      '<div class="pong-end-stat">当前心意币 ' + (walletOk() ? yuan(myBalance()) : '—') + '</div>',
      s.sessions > 0 ? '再来一场' : '开场拍卖');
    if (endBtn) endBtn.hidden = true;
  }
  function hideOverlay() { if (overlayEl) overlayEl.hidden = true; }

  // ---- 输入 ----
  if (startBtn) startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // 覆盖层按钮复用：场次中=下一件/返回收藏，场次外=开场
    if (overlayEl && !overlayEl.hidden) {
      const t = startBtn.textContent || '';
      if (t === '下一件' || t === '结算') { advance(); return; }
      if (t === '返回') { hideOverlay(); if (st && st.started && !st.over) { renderLot(); setStatus('继续——到你出价了'); } return; }
    }
    newSession();
  });
  if (endBtn) endBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
  if (bid1Btn) bid1Btn.addEventListener('click', (e) => { e.stopPropagation(); myBid(STEP1); });
  if (bid5Btn) bid5Btn.addEventListener('click', (e) => { e.stopPropagation(); myBid(STEP5); });
  if (bid13Btn) bid13Btn.addEventListener('click', (e) => { e.stopPropagation(); myBid(STEP13); });
  if (passBtn) passBtn.addEventListener('click', (e) => { e.stopPropagation(); myPass(); });
  if (bagBtn) bagBtn.addEventListener('click', (e) => { e.stopPropagation(); showBag(); });
  // #301 转赠按钮（收藏列表内，事件委托）
  if (ovBodyEl) ovBodyEl.addEventListener('click', (e) => {
    const sendBtn = e.target.closest('.au-send-btn');
    if (!sendBtn) return;
    e.stopPropagation();
    giftAway(parseInt(sendBtn.getAttribute('data-i'), 10) || 0);
  });
  if (soundBtn) soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '🔊' : '🔇';
    soundBtn.classList.toggle('pong-sound-off', !soundOn);
  });

  // ---- 打开 / 关闭 ----
  function setNames() {
    let name = T('TA');
    try {
      const s = window.activeStore && window.activeStore();
      name = (s && (s.get('cs-lbl-partner') || s.get('lbl-partner'))) || name;
    } catch (e) {}
    if (partnerNameEl) partnerNameEl.textContent = name;
  }
  window.openAuctionPanel = function () {
    try { if (isFs) toggleFs(); } catch (e) {}
    panel.hidden = false;
    try { setNames(); } catch (e) {}
    try { checkGifts(); } catch (e) {}   // #301 到期回寄投递
    // 有进行中的场次 → 接着拍（关面板期间 TA 思考的补调度）
    if (st && st.started && !st.over) {
      if (st.phase === 'bidding') { renderLot(); if (!thinkT && st.leader === 'you') scheduleTaThink('TA低头想了想……'); else updateBidBtns(); }
      return;
    }
    showStartOverlay();
    setStatus('点击「开场拍卖」');
  };
  function closePanel() {
    clearTimeout(thinkT); thinkT = null;
    clearInterval(giftTimer); giftTimer = null;
    if (panel) panel.hidden = true;
  }
  window.closeAuctionPanel = closePanel;
  // 打开期间每 30s 查一次到期回寄
  (function watchGifts() {
    const mo = new MutationObserver(() => {
      if (panel.hidden) { clearInterval(giftTimer); giftTimer = null; return; }
      if (!giftTimer) { try { checkGifts(); } catch (e) {} giftTimer = setInterval(() => { try { checkGifts(); } catch (e) {} }, 30000); }
    });
    mo.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  })();
  // 切联系人清空进行中场次：🎒 收藏按联系人桌面隔离，跨桌续拍会把拍品收进别桌收藏
  document.addEventListener('contact-switched', () => { try { closePanel(); st = null; } catch (e) {} });

  // ---- 入口：聊天更多功能 → 小游戏 → 心意币拍卖会（自绑定，chat.js 不改） ----
  (function bindEntry() {
    const btn = document.getElementById('more-auction');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mp = document.getElementById('chat-more-panel');
      if (mp) mp.hidden = true;
      hideSiblingPanels('chat-auction-panel');
      try { if (window.closeAvlib) window.closeAvlib(); } catch (err) {}
      try { if (window.closePongPanel) window.closePongPanel(); } catch (err) {}
      try { openAuctionPanel(); } catch (err) {
        try { panel.hidden = false; showStartOverlay(); setStatus('点击「开场拍卖」'); } catch (e2) {}
        try { console.error('[auction] open failed', err); } catch (e2) {}
      }
    });
    try {
      if (window.MutationObserver) {
        const SIBLING_IDS = siblingIds('chat-auction-panel');
        const mo = new MutationObserver(() => {
          if (panel.hidden) return;
          for (let i = 0; i < SIBLING_IDS.length; i++) {
            const el = document.getElementById(SIBLING_IDS[i]);
            if (el && !el.hidden) { closePanel(); break; }
          }
        });
        SIBLING_IDS.forEach((id) => { const el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
      }
    } catch (e) {}
  })();

  // 半框互斥清单（全部聊天页浮层面板；各游戏文件各自维护一份含其余全部面板的列表）
  function siblingIds(self) {
    return ['poke-card', 'emoji-panel', 'chat-search', 'chat-ask-panel', 'chat-divine-panel', 'chat-decision-panel', 'chat-gdecision-panel', 'chat-rps-panel', 'chat-rp-panel', 'chat-call-panel', 'chat-pong-panel', 'chat-snake-panel', 'chat-brick-panel', 'chat-c4-panel', 'chat-ms-panel', 'chat-fish-panel', 'chat-memory-panel', 'chat-gift-panel', 'chat-gomoku-panel', 'chat-linkup-panel', 'chat-match3-panel', 'chat-auction-panel', 'chat-arcade-panel', 'chat-more-panel'].filter((id) => id !== self);
  }
  function hideSiblingPanels(self) {
    siblingIds(self).forEach((id) => { const el = document.getElementById(id); if (el) el.hidden = true; });
  }

  // 只读调试口（供后续 verify 脚本复用）
  window.__auDebug = {
    st: () => st,
    newSession: newSession,
    myBid: myBid,
    loadBag: loadBag,
    fast: false
  };
})();
