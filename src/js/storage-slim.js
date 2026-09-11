// ===== #170 字卡库瘦身（查看存储页后端；纯逻辑+IDB，无 DOM 依赖，可被 verify 直载） =====
// 背景：#160 实测 cc-groups 双作用域 62.8MB（大头是自定义字卡里的 base64 GIF/大图），
// #160 只砍了新上传上限（CC_GIF_MAX_B64 512KB），存量清理一直靠用户自己翻字卡管理页
// 盲删——本模块给「查看存储」页提供按【分组】的体积扫描与整组删除：
//   · mochiCcSlimScan()：枚举公用键（cc-groups-public）/旧版顶层残留（cc-groups）/
//     各联系人专属键（<cid>:cc-groups），按分组统计体积与卡数，体积降序；
//   · mochiCcSlimDeleteGroup(prefix, key, cat, name)：按 分类+组名 整组删除，
//     与字卡管理页删掉该组数据语义完全一致。
// 数据安全底线：
//   · 读走 idbGet 权威层——大库常因启动驻留预算挂在 __xyIdbDeferredKeys，此时
//     store.get 会假空；idbGet 不受预算影响；
//   · 写回必须走 xyStore.set（内存缓存+LS+IDB 三路同拍）——chatcard.js 的各缓存
//     （pubCache / ccFuncOwnSrc 原始串身份缓存）都以「原始串换新」自动失效，与字卡
//     管理页自己的保存路径完全同源；
//   · 删除前重读当前值、在【当前值】上删组再写回——扫描到确认之间用户的编辑不丢；
//   · 只整组删除，不手术单卡；键读不到 / 结构不是 [组名, 卡数组] 二元组 / 组名匹配
//     不到 → 一律不动并如实返回 false。
(function () {
  const G = 'xy-home-v2:';
  function libs() {
    const out = [{ prefix: G, key: 'cc-groups-public', label: '公用字卡库' }];
    try {
      (window.getContacts ? window.getContacts() : []).forEach(function (c) {
        if (c && c.id) out.push({ prefix: G + c.id + ':', key: 'cc-groups', label: (c.name || c.id) + ' · 专属' });
      });
    } catch (e) {}
    // 旧版顶层键（多桌面功能之前的历史残留，chatcard 迁移逻辑的源头，有就扫）
    out.push({ prefix: G, key: 'cc-groups', label: '旧版顶层字卡库（残留）' });
    return out;
  }
  function parseLib(raw) {
    try {
      const s = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const g = JSON.parse(s || 'null');
      if (g && typeof g === 'object' && g.text) return g;
    } catch (e) {}
    return null;
  }
  window.mochiCcSlimScan = function () {
    return (async function () {
      const out = { ok: false, reason: '', libs: [], groups: [], totalBytes: 0 };
      if (!window.idbListKeys || !window.idbGet) { out.reason = '接口不可用'; return out; }
      const keys = await window.idbListKeys();
      if (!keys) { out.reason = '键清单读取失败（存储繁忙），稍后再试'; return out; }
      const keySet = {};
      keys.forEach(function (k) { keySet[String(k)] = true; });
      const list = libs().filter(function (L) { return keySet[L.prefix + L.key]; });
      for (let i = 0; i < list.length; i++) {
        const L = list[i];
        const raw = await window.idbGet(L.prefix + L.key);
        // 读不到只跳过该库并如实标注（可能不全），绝不据此当「空库」做任何写操作
        if (raw === undefined || raw === null) { out.reason = '字卡库「' + L.label + '」没读到（存储繁忙），结果可能不全'; continue; }
        const g = parseLib(raw);
        if (!g) continue;
        let libBytes = 0;
        Object.keys(g).forEach(function (cat) {
          const arr = g[cat];
          if (!Array.isArray(arr)) return;
          arr.forEach(function (tu) {
            if (!Array.isArray(tu) || typeof tu[0] !== 'string') return; // 非二元组结构不认，宁可少列不误删
            let bytes = 0;
            try { bytes = JSON.stringify(tu).length * 2; } catch (e) { return; }
            libBytes += bytes;
            out.groups.push({ prefix: L.prefix, key: L.key, label: L.label, cat: cat, name: tu[0], cards: Array.isArray(tu[1]) ? tu[1].length : 0, bytes: bytes });
          });
        });
        out.libs.push({ label: L.label, bytes: libBytes });
        out.totalBytes += libBytes;
      }
      out.groups.sort(function (a, b) { return b.bytes - a.bytes; });
      out.ok = true;
      return out;
    })().catch(function (e) { return { ok: false, reason: '扫描异常：' + ((e && e.message) || e), libs: [], groups: [], totalBytes: 0 }; });
  };
  window.mochiCcSlimDeleteGroup = function (prefix, key, cat, name) {
    return (async function () {
      if (!window.idbGet || !window.xyStore) return false;
      let raw = await window.idbGet(prefix + key);
      if (raw === undefined || raw === null) return false;
      const g = parseLib(raw);
      if (!g || !Array.isArray(g[cat])) return false;
      const before = g[cat].length;
      // 在【当前值】上删组（不是扫描快照）：扫描到确认之间用户的编辑不丢
      g[cat] = g[cat].filter(function (tu) { return !(Array.isArray(tu) && tu[0] === name); });
      if (g[cat].length === before) return false; // 组名没匹配到 → 不动
      let s = '';
      try { s = JSON.stringify(g); } catch (e) { return false; }
      try { window.xyStore(prefix).set(key, s); } catch (e) { return false; }
      return true;
    })();
  };
})();
