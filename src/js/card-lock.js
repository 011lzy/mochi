// ===== #319 系统内置字卡二级验证锁（防未成年人）=====
// 设计（用户点名）：
//   ① 默认全锁——所有系统预设字卡（main/kaomoji/emoji/dict/interact/period/fish…全部分类）
//      视为不存在，回复池、字卡库、词典拼字、各功能同源池一律取不到；用户自建字卡不受影响。
//   ② 开屏解锁——开屏公告区出现「防未成年人·内置字卡锁定」卡，点「输入密码解锁」弹
//      openModal 输入框，输对密码（990815）才放行并刷新页面生效；输错提示剩余次数并节流。
//   ③ 持久化 + 可重锁——解锁状态存 localStorage（键 per-cid 无关，全局键），解锁后卡变
//      「已解锁」可一键重新上锁；想改密码只能改本文件重新部署（源码不存明文，只存散列）。
// 存储约定：纯本地无后端；密码不存明文——存 FNV-1a 32 位散列（防顺手翻源码/存储看到），
//   这不是安全边界（前端无真安全），只是「不显眼 + 不鼓励尝试」；真正意图是产品层的年龄门槛。
(function () {
  const LS_KEY = 'xy-home-v2:cardlock-state'; // 'locked' | 'open'
  // FNV-1a 32bit('mochi#990815')——盐前置，纯数字散列串不易反推常见日期格式
  const PW_HASH = '4240701628';
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return String(h >>> 0);
  }
  function isOpen() {
    try { return localStorage.getItem(LS_KEY) === 'open'; } catch (e) { return false; }
  }
  // 汇合点统一问这里：锁定 = 系统预设字卡整体不存在
  window.cardLockOpen = isOpen;
  // 散列带盐校验（输错 5 次锁输入 60 秒，防小孩连试）
  let fails = 0, failUntil = 0;
  window.cardLockTryUnlock = function (pw) {
    const now = Date.now();
    if (now < failUntil) return { ok: false, msg: '尝试太频繁，请 ' + Math.ceil((failUntil - now) / 1000) + ' 秒后再试' };
    if (fnv1a('mochi#' + String(pw == null ? '' : pw)) === PW_HASH) {
      fails = 0;
      try { localStorage.setItem(LS_KEY, 'open'); } catch (e) {}
      document.dispatchEvent(new Event('mochi-cardlock-open'));
      return { ok: true };
    }
    fails++;
    if (fails >= 5) { failUntil = now + 60000; fails = 0; return { ok: false, msg: '错误次数过多，请 1 分钟后再试' }; }
    return { ok: false, msg: '密码不对（还剩 ' + (5 - fails) + ' 次机会）' };
  };
  window.cardLockRelock = function () {
    try { localStorage.setItem(LS_KEY, 'locked'); } catch (e) {}
    document.dispatchEvent(new Event('mochi-cardlock-locked'));
  };
})();
