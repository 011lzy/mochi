// ===== #340 二轮幂等重放脚本：match3.js transform 定位 + 按距离下落（transform 合成器动画轮）=====
// 背景：二轮 JS 改动曾被并行收口批旧缓冲回写卷走（WORKLOG 有案），css 二轮已在树。
// 本脚本把 src/js/match3.js 打回「transform + m3-glyph + fallSec」形态，幂等可重复执行；
// 每步先查前态，已应用则跳过。配套哨兵：animMs(FALL_MS)（build.mjs）；行为断言：tools/verify-match3-anim.mjs。
import { readFileSync, writeFileSync } from 'fs';

const F = 'src/js/match3.js';
let t = readFileSync(F, 'utf8');
const orig = t;
const rep = (from, to, tag) => {
  if (t.includes(to.split('\n')[0]) && to.split('\n')[0].length > 0 && t.includes(to)) { console.log('  = 已在位，跳过: ' + tag); return; }
  if (!t.includes(from)) { console.log('  ✗ 找不到旧串（可能已被改写）: ' + tag); process.exitCode = 1; return; }
  t = t.split(from).join(to);
  console.log('  ✓ 应用: ' + tag);
};

// 1) setGlyph 走内层字形 + fallSec + layoutTile/spawnTile 改 transform
rep(`  function setGlyph(el, v) {
    el.classList.remove('m3-bomb');
    if (v >= RAINBOW) el.textContent = '🌈';
    else if (v >= BOMB_BASE) { el.textContent = '💥'; el.classList.add('m3-bomb'); }
    else el.textContent = KINDS[v];
  }
  function layoutTile(el, r, c) {
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.left = (c * (cellPx + GAP)) + 'px';
    el.style.top = (r * (cellPx + GAP)) + 'px';
    el._r = r; el._c = c;
  }
  function spawnTile(v, r, c, fromRow, born) {
    const el = document.createElement('div');
    el.className = 'm3-tile' + (born ? ' m3-born' : '');
    const id = nextPid++;
    setGlyph(el, v);
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.left = (c * (cellPx + GAP)) + 'px';
    el.style.top = ((fromRow != null ? fromRow : r) * (cellPx + GAP)) + 'px';
    el._r = r; el._c = c;
    boardEl.appendChild(el);
    pieces.set(id, { v: v, el: el });
    pidGrid[r][c] = id;
    if (fromRow != null) requestAnimationFrame(() => { layoutTile(el, r, c); });
    return id;
  }`, `  function setGlyph(el, v) {
    el.classList.remove('m3-bomb');
    const g = el._g || el;
    if (v >= RAINBOW) g.textContent = '🌈';
    else if (v >= BOMB_BASE) { g.textContent = '💥'; el.classList.add('m3-bomb'); }
    else g.textContent = KINDS[v];
  }
  // 下落时长按距离计：掉得远耗时长（封顶 0.42s），避免远距离瞬移感
  function fallSec(dist) { return Math.min(0.42, 0.16 + dist * 0.05); }
  // 定位走 transform（合成器动画，低端机不进 layout），缩放/抖动类动画在内层 .m3-glyph 上不冲突
  function layoutTile(el, r, c) {
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.transform = 'translate(' + (c * (cellPx + GAP)) + 'px,' + (r * (cellPx + GAP)) + 'px)';
    el._r = r; el._c = c;
  }
  function spawnTile(v, r, c, fromRow, born, fallDist) {
    const el = document.createElement('div');
    el.className = 'm3-tile' + (born ? ' m3-born' : '');
    const id = nextPid++;
    const g = document.createElement('span');
    g.className = 'm3-glyph';
    el.appendChild(g);
    el._g = g;
    setGlyph(el, v);
    el.style.width = cellPx + 'px';
    el.style.height = cellPx + 'px';
    el.style.fontSize = Math.round(cellPx * 0.54) + 'px';
    el.style.transform = 'translate(' + (c * (cellPx + GAP)) + 'px,' + ((fromRow != null ? fromRow : r) * (cellPx + GAP)) + 'px)';
    if (fallDist) el.style.transitionDuration = fallSec(fallDist) + 's';
    el._r = r; el._c = c;
    boardEl.appendChild(el);
    pieces.set(id, { v: v, el: el });
    pidGrid[r][c] = id;
    if (fromRow != null) requestAnimationFrame(() => { layoutTile(el, r, c); });
    return id;
  }`, 'setGlyph/layoutTile/spawnTile → transform+m3-glyph+fallSec');

// 2) swapPid 清下落时长
rep(`    const pa = pieces.get(ia), pb = pieces.get(ib);
    if (pa) layoutTile(pa.el, b[0], b[1]);
    if (pb) layoutTile(pb.el, a[0], a[1]);`, `    const pa = pieces.get(ia), pb = pieces.get(ib);
    if (pa) { pa.el.style.transitionDuration = ''; layoutTile(pa.el, b[0], b[1]); }
    if (pb) { pb.el.style.transitionDuration = ''; layoutTile(pb.el, a[0], a[1]); }`, 'swapPid 清 transitionDuration');

// 3) collapseAnimated 按距离计时长并返回最大距离
rep(`  // 重力下落动画：现有棋子滑到新位，顶部空位生成新棋子从棋盘上方落进
  function collapseAnimated() {
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const id = pidGrid[r][c];
        if (id >= 0) {
          if (write !== r) {
            const p = pieces.get(id);
            pidGrid[write][c] = id; pidGrid[r][c] = -1;
            st.grid[write][c] = st.grid[r][c]; st.grid[r][c] = -1;
            if (p) layoutTile(p.el, write, c);
          }
          write--;
        }
      }
      for (let r = write; r >= 0; r--) {
        const v = Math.floor(Math.random() * KIND_N);
        st.grid[r][c] = v;
        spawnTile(v, r, c, r - (write + 1), true);
      }
    }
  }`, `  // 重力下落动画：现有棋子按距离滑到新位，顶部空位生成新棋子从棋盘上方落进；返回本段最大下落距离
  function collapseAnimated() {
    let maxDist = 1;
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const id = pidGrid[r][c];
        if (id >= 0) {
          if (write !== r) {
            const p = pieces.get(id);
            pidGrid[write][c] = id; pidGrid[r][c] = -1;
            st.grid[write][c] = st.grid[r][c]; st.grid[r][c] = -1;
            if (p) {
              const dist = write - r;
              if (dist > maxDist) maxDist = dist;
              p.el.style.transitionDuration = fallSec(dist) + 's';
              layoutTile(p.el, write, c);
            }
          }
          write--;
        }
      }
      const gapN = write + 1;
      if (gapN > maxDist) maxDist = gapN;
      for (let r = write; r >= 0; r--) {
        const v = Math.floor(Math.random() * KIND_N);
        st.grid[r][c] = v;
        spawnTile(v, r, c, r - gapN, true, gapN);
      }
    }
    return maxDist;
  }`, 'collapseAnimated 距离时长');

// 4) doSwap 结算尾
rep(`      setTimeout(() => {
        collapseAnimated();         // 下落补位后再等下一轮查连锁
        setTimeout(step, animMs(FALL_MS));
      }, animMs(POP_MS));`, `      setTimeout(() => {
        const maxDist = collapseAnimated();   // 下落补位后再等下一轮查连锁
        setTimeout(step, Math.max(animMs(FALL_MS), animMs(fallSec(maxDist) * 1000 + 80)));
      }, animMs(POP_MS));`, 'doSwap 结算尾按距离等待');

// 5) doRainbowSwap 结算尾
rep(`    popClear(cells);
    setTimeout(() => {
      collapseAnimated();
      setTimeout(() => {
        st.lock = false;
        if (cb) cb(true, pts);
      }, animMs(FALL_MS));
    }, animMs(POP_MS));`, `    popClear(cells);
    setTimeout(() => {
      const maxDist = collapseAnimated();
      setTimeout(() => {
        st.lock = false;
        if (cb) cb(true, pts);
      }, Math.max(animMs(FALL_MS), animMs(fallSec(maxDist) * 1000 + 80)));
    }, animMs(POP_MS));`, 'doRainbowSwap 结算尾按距离等待');

if (t !== orig) { writeFileSync(F, t); console.log('match3.js 已写入二轮形态'); }
else console.log('match3.js 无变化');
