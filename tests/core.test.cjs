/* 一杯手冲的配比卡 · 核心测试
 * 跑法：node --test tests/core.test.cjs
 * 全部锚点由 40 位精度的独立复算生成（见 需求与调研.md §3），不靠心算。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../core.js');

/* ── 40 位精度独立复算的期望表（外部生成，写死在这里作为锚点） ── */
const ANCHORS = [
  { id: 'v60-default', inp: { vesselId: 'v60', dose: 15, ratio: 16, targetEy: 20 }, W: 240, Rw: 30, V: 210, E: 3, tds: 1.43 },
  { id: 'two-cups', inp: { vesselId: 'v60', dose: 22, ratio: 15.5, targetEy: 20 }, W: 341, Rw: 44, V: 297, E: 4.4, tds: 1.48 },
  { id: 'french-press', inp: { vesselId: 'immersion', dose: 30, ratio: 15, targetEy: 20 }, W: 450, Rw: 30, V: 420, E: 6, tds: 1.43 },
  { id: 'aeropress', inp: { vesselId: 'aeropress', dose: 18, ratio: 13, targetEy: 21 }, W: 234, Rw: 14.4, V: 219.6, E: 3.78, tds: 1.72 },
  { id: 'cake', inp: { vesselId: 'cake', dose: 20, ratio: 16.5, targetEy: 19.5 }, W: 330, Rw: 44, V: 286, E: 3.9, tds: 1.36 },
  { id: 'small', inp: { vesselId: 'v60', dose: 8.5, ratio: 17, targetEy: 20.5 }, W: 144.5, Rw: 17, V: 127.5, E: 1.743, tds: 1.37 },
  { id: 'tight', inp: { vesselId: 'v60', dose: 15, ratio: 3.5, targetEy: 20 }, W: 52.5, Rw: 30, V: 22.5, E: 3, tds: 13.33 },
  { id: 'large', inp: { vesselId: 'v60', dose: 40, ratio: 14, targetEy: 18 }, W: 560, Rw: 80, V: 480, E: 7.2, tds: 1.5 },
  { id: 'espresso-ref', inp: { vesselId: 'espresso', dose: 18, ratio: 2.5, targetEy: 20 }, W: 45, Rw: 18, V: 27, E: 3.6, tds: 13.33 },
];

test('锚点：每个器具的注水量 / 留水量 / 杯量 / 可溶物 / 浓度', () => {
  for (const a of ANCHORS) {
    const r = A.compute(a.inp);
    assert.strictEqual(r.ok, true, a.id + ' 应当可算：' + JSON.stringify(r.errors));
    assert.strictEqual(r.card.waterTotal, a.W, a.id + ' W');
    assert.strictEqual(r.card.waterRetained, a.Rw, a.id + ' Rw');
    assert.strictEqual(r.card.beverage, a.V, a.id + ' V');
    assert.strictEqual(r.target.extractMass, a.E, a.id + ' E');
    assert.strictEqual(r.target.tds, a.tds, a.id + ' tds');
    /* 萃取率原样回传 */
    assert.strictEqual(r.target.ey, A.round(a.inp.targetEy, 2), a.id + ' ey');
  }
});

test('锚点：默认场景的完整期望值', () => {
  const r = A.compute(A.defaults());
  assert.deepStrictEqual(r.card, {
    dose: 15, waterTotal: 240, waterRetained: 30, beverage: 210, ratioText: '1 : 16',
    tempC: 92, grindLabel: '中细（默认）', iceG: 0, hotWaterG: 240, iced: false,
  });
  assert.strictEqual(r.target.tds, 1.43);
  assert.strictEqual(r.target.tdsRaw, 20 * 15 / 210);
  assert.strictEqual(r.target.eyBand, 'balanced');
  assert.strictEqual(r.target.tdsBand, 'ok');
  assert.strictEqual(r.input.k, 2.0);
});

/* ─────────────── 公式自洽（两条路径必须互逆） ─────────────── */
test('自洽：萃取率 → 浓度 → 萃取率 回到原值（多组 × 每个器具）', () => {
  for (const a of ANCHORS) {
    const r = A.compute(a.inp);
    const back = r.target.tdsRaw * r.card.beverage / r.card.dose;
    assert.ok(Math.abs(back - r.target.ey) < 0.011, a.id + ' 回代偏差 ' + back + ' vs ' + r.target.ey);
  }
});
test('自洽：可溶物既等于 萃取率×粉重/100，也等于 杯量×浓度/100', () => {
  for (const a of ANCHORS) {
    const r = A.compute(a.inp);
    assert.ok(Math.abs(r.target.extractMass - r.target.ey * r.card.dose / 100) < 0.0006, a.id + ' 路径1');
    assert.ok(Math.abs(r.target.extractMass - r.card.beverage * r.target.tdsRaw / 100) < 0.0006, a.id + ' 路径2（全精度浓度）');
    /* 用显示浓度（2 位小数）时必须落在按显示精度推导的容差内 */
    const tol = r.card.beverage * 0.00005 + 0.0006;
    assert.ok(Math.abs(r.target.extractMass - r.card.beverage * r.target.tds / 100) <= tol, a.id + ' 路径2（显示浓度，容差 ' + tol.toFixed(4) + '）');
  }
});
test('自洽：杯量 → 反解粉重 → 杯量 回到原值', () => {
  for (const a of ANCHORS) {
    const r = A.compute(a.inp);
    const inv = r.inverse.forBeverage(r.card.beverage);
    assert.ok(Math.abs(inv.dose - r.card.dose) <= 0.011, a.id + ' 反解粉重 ' + inv.dose + ' vs ' + r.card.dose);
    assert.ok(Math.abs(inv.water - r.card.waterTotal) <= 0.11, a.id + ' 反解水量');
  }
});
test('自洽：每克粉的杯量恒等于 R − k（与粉重无关）', () => {
  const r1 = A.compute({ dose: 12, ratio: 16 });
  const r2 = A.compute({ dose: 40, ratio: 16 });
  assert.strictEqual(r1.inverse.perGram.beverage, 14);
  assert.strictEqual(r2.inverse.perGram.beverage, 14);
  assert.strictEqual(r1.card.beverage / 12, 14);
  assert.strictEqual(r2.card.beverage / 40, 14);
});

/* ─────────────── 冰冲 ─────────────── */
test('冰冲：冰 + 热水 = 总注水，且杯量与不加冰一致（同比例）', () => {
  const dry = A.compute({ dose: 15, ratio: 16 });
  for (const f of [0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
    const r = A.compute({ dose: 15, ratio: 16, iced: true, iceFrac: f });
    assert.strictEqual(r.ok, true, 'f=' + f);
    assert.ok(Math.abs(r.card.iceG + r.card.hotWaterG - r.card.waterTotal) < 0.11, 'f=' + f + ' 拆分不守恒');
    assert.strictEqual(r.card.beverage, dry.card.beverage, 'f=' + f + ' 杯量应不变');
  }
  const r = A.compute({ dose: 15, ratio: 16, iced: true, iceFrac: 0.4 });
  assert.strictEqual(r.card.iceG, 96);
  assert.strictEqual(r.card.hotWaterG, 144);
});
test('冰冲：不勾选时 iceFrac 被忽略，iceG 必须为 0', () => {
  const r = A.compute({ dose: 15, ratio: 16, iced: false, iceFrac: 0.9 });
  assert.strictEqual(r.card.iceG, 0);
  assert.strictEqual(r.card.hotWaterG, 240);
});

/* ─────────────── 分段注水 ─────────────── */
test('分段注水：滤泡 4 段、累计单调不减、末段累计 = 总注水、时间不倒退', () => {
  for (const dose of [12, 15, 22, 25, 30, 40, 60]) {
    const r = A.compute({ vesselId: 'v60', dose: dose, ratio: 16 });
    const p = r.pours;
    assert.strictEqual(p.length, 3, 'dose=' + dose);
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i].cum >= p[i - 1].cum - 1e-9, 'dose=' + dose + ' 累计倒退');
      assert.ok(p[i].startSec >= p[i - 1].endSec - 1e-9, 'dose=' + dose + ' 时间倒退');
      assert.ok(p[i].endSec >= p[i].startSec, 'dose=' + dose + ' 段内时间反了');
    }
    assert.strictEqual(p[p.length - 1].cum, r.card.waterTotal, 'dose=' + dose + ' 末段累计');
    assert.ok(Math.abs(p.reduce((s, x) => s + x.amount, 0) - r.card.waterTotal) < 0.35, 'dose=' + dose + ' 分段之和');
    assert.ok(p[0].cum >= 30, 'dose=' + dose + ' 闷蒸不少于 30 g');
    /* 澄清后的硬口径：段 2 的累计 = 60 % × 总注水量（不是 60 % × (W − 闷蒸)） */
    assert.strictEqual(p[1].cum, A.round(r.card.waterTotal * 0.6, 1), 'dose=' + dose + ' 段 2 累计口径');
  }
});
test('分段注水：默认场景逐项锚点（30 / 累计144 / 累计240，0–30–90–150 秒）', () => {
  const r = A.compute(A.defaults());
  assert.deepStrictEqual(r.pours.map((p) => [p.idx, p.amount, p.cum, p.startSec, p.endSec]), [
    [1, 30, 30, 0, 30],
    [2, 114, 144, 30, 90],
    [3, 96, 240, 90, 150],
  ]);
});
test('分段注水：总时长 = 150 + 2×(D−15)，下限 30 秒（合法区间内不触发）；浸泡式固定 240 秒', () => {
  const cases = [[15, 150], [25, 170], [7.9, 136], [60, 240], [8, 136], [5, 130]];
  cases.forEach(([D, sec]) => {
    const r = A.compute({ vesselId: 'v60', dose: D, ratio: 16 });
    assert.strictEqual(r.pours[r.pours.length - 1].endSec, sec, 'D=' + D);
  });
  ['immersion', 'aeropress'].forEach((id) => {
    const r = A.compute({ vesselId: id, dose: 15, ratio: 16 });
    assert.strictEqual(r.pours[r.pours.length - 1].endSec, 240, id);
  });
});
test('分段注水：段 2 塌成 0 时退化成 2 段（不编造 0 g 的段）', () => {
  const r = A.compute({ vesselId: 'v60', dose: 8, ratio: 4 });
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
  assert.strictEqual(r.pours.length, 2, JSON.stringify(r.pours));
  assert.strictEqual(r.pours[0].amount, 32);
  assert.strictEqual(r.pours[1].amount, 0);
  assert.strictEqual(r.pours[1].cum, 32);
});
test('分段注水：冰冲只注热水部分，累计对 60 % × W_hot', () => {
  const r = A.compute({ dose: 15, ratio: 20, iced: true, iceFrac: 0.4 });
  assert.strictEqual(r.card.waterTotal, 300);
  assert.strictEqual(r.card.iceG, 120);
  assert.strictEqual(r.card.hotWaterG, 180);
  assert.strictEqual(r.card.beverage, 270);
  assert.deepStrictEqual(r.pours.map((p) => [p.amount, p.cum]), [[30, 30], [78, 108], [72, 180]]);
  assert.strictEqual(r.pours[2].cum, r.card.hotWaterG, '注水合计 = 热水部分');
});
test('分段注水：浸泡式是 1 次注满 + 浸泡 + 压出，且只有一次注水', () => {
  for (const id of ['immersion', 'aeropress']) {
    const r = A.compute({ vesselId: id, dose: 30, ratio: 15 });
    assert.strictEqual(r.pours.length, 3, id);
    assert.strictEqual(r.pours[0].amount, r.card.waterTotal, id + ' 一次注满');
    assert.strictEqual(r.pours[1].amount, 0, id);
    assert.strictEqual(r.pours[2].amount, 0, id);
    assert.strictEqual(r.pours[2].cum, r.card.waterTotal, id);
  }
});
test('分段注水：时间是秒且为正、总时长落在合理量级', () => {
  for (const a of [{ vesselId: 'v60', dose: 15 }, { vesselId: 'cake', dose: 20 }, { vesselId: 'immersion', dose: 30 }, { vesselId: 'aeropress', dose: 18 }]) {
    const r = A.compute(Object.assign({ ratio: 16 }, a));
    const last = r.pours[r.pours.length - 1];
    assert.ok(last.endSec > 0 && last.endSec <= 400, JSON.stringify(a) + ' 总时长 ' + last.endSec);
    r.pours.forEach((p) => { assert.ok(Number.isInteger(p.startSec) && Number.isInteger(p.endSec), '时刻必须是整数秒'); });
    assert.ok(last.endSec <= 240, '段末时刻不得超过 240 秒');
  }
});

/* ─────────────── 阈值两侧 ─────────────── */
test('阈值：R 等于 k 是翻转点 —— 等于即不可行、k+ε 立即可行', () => {
  const k = 2.0;
  const bad = A.compute({ vesselId: 'v60', dose: 15, ratio: k });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.code === 'no-beverage'), '必须给出 no-beverage');
  assert.strictEqual(bad.feasible, false);
  assert.deepStrictEqual(bad.pours, [], '不可行时不给注水表');
  const below = A.compute({ vesselId: 'v60', dose: 15, ratio: k - 0.01 });
  assert.strictEqual(below.ok, false);
  const just = A.compute({ vesselId: 'v60', dose: 15, ratio: k + 0.01 });
  assert.strictEqual(just.ok, true);
  assert.ok(just.card.beverage > 0 && just.card.beverage < 1, '刚好过界时杯量极小：' + just.card.beverage);
  /* 每个器具的翻转点都要对 */
  for (const v of A.VESSELS) {
    assert.strictEqual(A.compute({ vesselId: v.id, dose: 15, ratio: v.k }).ok, false, v.id + ' 在 R=k 应不可行');
    const r2 = Math.max(A.LIMITS.ratio.min + 0.1, v.k + 0.5);
    assert.strictEqual(A.compute({ vesselId: v.id, dose: 15, ratio: r2 }).ok, true, v.id + ' 在 R=' + r2 + ' 应可行');
  }
});
test('阈值：粉重 5 / 8 / 40 / 60 四个边界', () => {
  assert.strictEqual(A.compute({ dose: 4.999 }).ok, false, '低于 5 应非法');
  assert.strictEqual(A.compute({ dose: 5 }).ok, true);
  assert.ok(A.compute({ dose: 5 }).warnings.some((w) => w.code === 'dose-small'));
  assert.ok(!A.compute({ dose: 8 }).warnings.some((w) => w.code === 'dose-small'), '8 g 正好在界上，不提示');
  assert.ok(A.compute({ dose: 7.9 }).warnings.some((w) => w.code === 'dose-small'), '7.9 应提示');
  assert.ok(!A.compute({ dose: 8.001 }).warnings.some((w) => w.code === 'dose-small'), '8.001 不再提示');
  assert.ok(!A.compute({ dose: 39.9 }).warnings.some((w) => w.code === 'dose-large'), '39.9 g 未到 40，不提示分两壶');
  assert.ok(A.compute({ dose: 40 }).warnings.some((w) => w.code === 'dose-large'), '40 g 起提示分两壶');
  assert.ok(A.compute({ dose: 45 }).warnings.some((w) => w.code === 'dose-large'), '45 g 提示分两壶');
  assert.strictEqual(A.compute({ dose: 60 }).ok, true);
  assert.strictEqual(A.compute({ dose: 60.001 }).ok, false);
});
test('阈值：比例 1.5 / 22 / 40 三个边界', () => {
  const low = A.compute({ vesselId: 'aeropress', ratio: 1.45 });
  assert.ok(low.errors.some((e) => e.code === 'ratio-too-small'), '1.45 要报「比例过小」这条，实际 ' + JSON.stringify(low.errors.map((e) => e.code)));
  assert.strictEqual(A.compute({ vesselId: 'aeropress', ratio: 1.499 }).ok, true, '比例按 2 位小数归一化：1.499 → 1.5，落在界内');
  /* 1.5 在 v60（k=2.0）上是决定性退化 */
  assert.ok(A.compute({ ratio: 1.5 }).errors.some((e) => e.code === 'no-beverage'), 'v60 在 1.5 应报「杯里不会有咖啡液」');
  assert.strictEqual(A.compute({ vesselId: 'aeropress', ratio: 1.5 }).ok, true, 'k=0.8 的器具在 1.5 可行');
  assert.strictEqual(A.compute({ ratio: 1.4 }).ok, false, 'R=1.4 < k=2.0 不可行（先撞 no-beverage）');
  assert.strictEqual(A.compute({ ratio: 40 }).ok, true);
  assert.ok(A.compute({ ratio: 40 }).warnings.some((w) => w.code === 'ratio-dilute'));
  /* 比例归一化到 2 位小数：40.001 → 40（合法）；40.01 → 40.01（越界） */
  assert.strictEqual(A.compute({ ratio: 40.001 }).ok, true, '40.001 归一化后是 40，合法');
  assert.strictEqual(A.compute({ ratio: 40.01 }).ok, false, '40.01 应越界');
  assert.ok(!A.compute({ ratio: 22 }).warnings.some((w) => w.code === 'ratio-dilute'), '22 不提示');
  /* 比例归一化到 2 位小数：22.001 → 22 → 不提示；22.01 → 22.01 → 提示 */
  assert.ok(!A.compute({ ratio: 22.001 }).warnings.some((w) => w.code === 'ratio-dilute'), '22.001 归一化后是 22，不提示');
  assert.ok(A.compute({ ratio: 22.01 }).warnings.some((w) => w.code === 'ratio-dilute'), '22.01 应提示');
});
test('阈值：水温 70 / 100 合法，69.9 / 100.1 非法；80 / 96 是提示线', () => {
  assert.strictEqual(A.compute({ tempC: 70 }).ok, true);
  assert.strictEqual(A.compute({ tempC: 100 }).ok, true);
  assert.strictEqual(A.compute({ tempC: 71 }).ok, true);
  assert.strictEqual(A.compute({ tempC: 69 }).ok, false);
  assert.strictEqual(A.compute({ tempC: 101 }).ok, false);
  assert.strictEqual(A.compute({ tempC: 69.9 }).ok, true, '温度取整：69.9 → 70，落在合法边界内');
  assert.strictEqual(A.compute({ tempC: 99.6 }).ok, true, '温度取整：99.6 → 100');
  assert.strictEqual(A.compute({ tempC: 100.4 }).ok, true, '温度取整：100.4 → 100');
  assert.strictEqual(A.compute({ tempC: 100.5 }).ok, false, '温度取整：100.5 → 101，越界');
  assert.strictEqual(A.compute({ tempC: 80 }).ok, true, '80 只是提示线，不是非法');
  assert.ok(A.compute({ tempC: 81 }).warnings.some((w) => w.code === 'temp-low'));
  assert.ok(!A.compute({ tempC: 82 }).warnings.some((w) => w.code === 'temp-low'));
  assert.strictEqual(A.LIMITS.tempSuggest[0], 82);
  assert.ok(!A.compute({ tempC: 96 }).warnings.some((w) => w.code === 'temp-high'));
  assert.ok(A.compute({ tempC: 97 }).warnings.some((w) => w.code === 'temp-high'));
});
test('阈值：目标萃取率 12 / 30 合法，11.9 / 30.1 非法；18 / 22 是提示线', () => {
  assert.strictEqual(A.compute({ targetEy: 12 }).ok, true);
  assert.strictEqual(A.compute({ targetEy: 30 }).ok, true);
  assert.strictEqual(A.compute({ targetEy: 11.9 }).ok, false);
  assert.strictEqual(A.compute({ targetEy: 30.1 }).ok, false);
  assert.ok(A.compute({ targetEy: 17.9 }).warnings.some((w) => w.code === 'ey-low'));
  assert.ok(!A.compute({ targetEy: 18 }).warnings.some((w) => w.code === 'ey-low'));
  assert.ok(!A.compute({ targetEy: 22 }).warnings.some((w) => w.code === 'ey-high'));
  assert.ok(A.compute({ targetEy: 22.1 }).warnings.some((w) => w.code === 'ey-high'));
  assert.strictEqual(A.compute({ targetEy: 18 }).target.eyBand, 'balanced');
  assert.strictEqual(A.compute({ targetEy: 17.99 }).target.eyBand, 'under');
  assert.strictEqual(A.compute({ targetEy: 22 }).target.eyBand, 'balanced');
  assert.strictEqual(A.compute({ targetEy: 22.01 }).target.eyBand, 'over');
});
test('阈值：浓度分档 1.15 / 1.45 是含边界', () => {
  /* 用默认 15 g / 210 g 杯量构造精确的浓度 */
  const mk = (tds) => A.compute({ dose: 15, ratio: 16, targetEy: tds * 210 / 15 });
  assert.strictEqual(mk(1.15).target.tdsBand, 'ok', '1.15 算正常');
  assert.strictEqual(mk(1.14).target.tdsBand, 'light');
  assert.strictEqual(mk(1.45).target.tdsBand, 'ok', '1.45 算正常');
  assert.strictEqual(mk(1.46).target.tdsBand, 'strong');
});
test('阈值：实测 TDS 必须严格落在 (0, 5) 内', () => {
  assert.strictEqual(A.compute({ measuredTds: 0 }).ok, false);
  assert.strictEqual(A.compute({ measuredTds: -1 }).ok, false);
  assert.strictEqual(A.compute({ measuredTds: 5 }).ok, false);
  assert.strictEqual(A.compute({ measuredTds: 0.01 }).ok, true);
  assert.strictEqual(A.compute({ measuredTds: 4.99 }).ok, true);
  assert.strictEqual(A.compute({ measuredTds: null }).ok, true, '不填是合法状态');
});
test('阈值：冰占比 0 与 0.95 合法，负数与 1 非法', () => {
  assert.strictEqual(A.compute({ iced: true, iceFrac: 0 }).ok, true);
  assert.strictEqual(A.compute({ iced: true, iceFrac: 0.95 }).ok, true);
  assert.strictEqual(A.compute({ iced: true, iceFrac: -0.01 }).ok, false);
  assert.strictEqual(A.compute({ iced: true, iceFrac: 1 }).ok, false);
  assert.strictEqual(A.compute({ iced: false, iceFrac: 99 }).ok, true, '不勾冰冲就不校验冰占比');
});

/* ─────────────── 非法输入（逐条核字段，不只看 ok=false） ─────────────── */
test('非法输入：33 条，逐条核对错误字段与 code', () => {
  const cases = [
    [{ dose: 4 }, 'dose', 'dose-too-small'],
    [{ dose: 0 }, 'dose', 'dose-too-small'],
    [{ dose: -5 }, 'dose', 'dose-too-small'],
    [{ dose: 61 }, 'dose', 'dose-too-large'],
    [{ dose: 1000 }, 'dose', 'dose-too-large'],
    [{ ratio: 1 }, 'ratio', 'ratio-too-small'],
    [{ ratio: 0.5 }, 'ratio', 'ratio-too-small'],
    [{ ratio: 41 }, 'ratio', 'ratio-too-large'],
    [{ ratio: 500 }, 'ratio', 'ratio-too-large'],
    [{ tempC: 69 }, 'tempC', 'temp-out-of-range'],
    [{ tempC: 20 }, 'tempC', 'temp-out-of-range'],
    [{ tempC: 101 }, 'tempC', 'temp-out-of-range'],
    [{ tempC: 200 }, 'tempC', 'temp-out-of-range'],
    [{ targetEy: 11 }, 'targetEy', 'ey-out-of-range'],
    [{ targetEy: 0 }, 'targetEy', 'ey-out-of-range'],
    [{ targetEy: 31 }, 'targetEy', 'ey-out-of-range'],
    [{ targetEy: 99 }, 'targetEy', 'ey-out-of-range'],
    [{ measuredTds: 0 }, 'measuredTds', 'tds-out-of-range'],
    [{ measuredTds: 5 }, 'measuredTds', 'tds-out-of-range'],
    [{ measuredTds: 12 }, 'measuredTds', 'tds-out-of-range'],
    [{ iced: true, iceFrac: -0.5 }, 'iceFrac', 'ice-out-of-range'],
    [{ iced: true, iceFrac: 1 }, 'iceFrac', 'ice-out-of-range'],
    [{ iced: true, iceFrac: 2 }, 'iceFrac', 'ice-out-of-range'],
    [{ dose: 'abc' }, 'dose', 'not-a-number'],
    [{ ratio: 'x1' }, 'ratio', 'not-a-number'],
    [{ tempC: '九十二' }, 'tempC', 'not-a-number'],
    [{ targetEy: 'high' }, 'targetEy', 'not-a-number'],
    [{ vesselId: 'v60', dose: 15, ratio: 2 }, 'ratio', 'no-beverage'],
    [{ vesselId: 'cake', dose: 15, ratio: 2.2 }, 'ratio', 'no-beverage'],
    [{ vesselId: 'immersion', dose: 15, ratio: 1 }, 'ratio', 'no-beverage'],
    [{ vesselId: 'immersion', dose: 15, ratio: 0.5 }, 'ratio', 'no-beverage'],
    [{ vesselId: 'aeropress', dose: 15, ratio: 0.8 }, 'ratio', 'no-beverage'],
    [{ vesselId: 'espresso', dose: 15, ratio: 1 }, 'ratio', 'no-beverage'],
  ];
  assert.strictEqual(cases.length, 33);
  for (const [patch, field, code] of cases) {
    const r = A.compute(Object.assign(A.defaults(), patch));
    assert.strictEqual(r.ok, false, JSON.stringify(patch) + ' 应当非法');
    assert.ok(r.errors.some((e) => e.field === field && e.code === code),
      JSON.stringify(patch) + ' 期望 ' + field + '/' + code + '，实际 ' + JSON.stringify(r.errors.map((e) => e.field + '/' + e.code)));
    assert.ok(r.errors.every((e) => typeof e.msg === 'string' && e.msg.length > 6), '每条错误都要有人话说明');
  }
});
test('非法输入：错误文案里带上实际数字（不是空话）', () => {
  const r1 = A.compute({ dose: 100 });
  assert.ok(/100/.test(r1.warnings.find((x) => x.code === 'dose-small' || x.code === 'dose-large').msg), '粉重提示要含实际值');
  const r2 = A.compute({ tempC: 200 });
  assert.ok(/200/.test(r2.errors.find((x) => x.code === 'temp-out-of-range').msg), '水温报错要含实际值');
  const r3 = A.compute({ dose: 'abc' });
  assert.ok(/abc/.test(r3.errors.find((x) => x.code === 'not-a-number').msg), '非数字报错要含用户填的原文');
});

/* ─────────────── 退化：null / 空 / 缺字段 / 类型错 ─────────────── */
test('退化：null / undefined / {} / 数组 / 字符串 一律不抛异常', () => {
  for (const bad of [null, undefined, {}, [], 'v60', 42, true, NaN, { dose: null, ratio: null }]) {
    assert.doesNotThrow(() => A.compute(bad), 'compute(' + JSON.stringify(bad) + ') 抛了异常');
    const r = A.compute(bad);
    assert.strictEqual(r.ok, true, JSON.stringify(bad) + ' 应回落到默认值');
    assert.strictEqual(r.card.waterTotal, 240);
  }
});
test('退化：字段缺省与空串都回落到默认值', () => {
  for (const patch of [{}, { dose: '' }, { ratio: '' }, { tempC: '' }, { grindIdx: '' }, { targetEy: '' }, { vesselId: 'nope' }, { iceFrac: '' }]) {
    const r = A.compute(Object.assign({}, patch));
    assert.strictEqual(r.card.waterTotal, 240, JSON.stringify(patch));
    assert.strictEqual(r.card.tempC, 92, JSON.stringify(patch));
    assert.strictEqual(r.input.vesselId, 'v60', JSON.stringify(patch));
  }
});
test('退化：研磨档超范围被夹到 0..5，非整数被四舍五入', () => {
  assert.strictEqual(A.compute({ grindIdx: -3 }).input.grindIdx, 0);
  assert.strictEqual(A.compute({ grindIdx: 99 }).input.grindIdx, 5);
  assert.strictEqual(A.compute({ grindIdx: 2.6 }).input.grindIdx, 3);
  assert.strictEqual(A.compute({ grindIdx: 2.4 }).input.grindIdx, 2);
});
test('退化：不可行时不给出注水表、不给反解、杯量不是有效正数', () => {
  const r = A.compute({ ratio: 1.5 });
  assert.strictEqual(r.feasible, false);
  assert.deepStrictEqual(r.pours, []);
  assert.strictEqual(r.inverse, null);
  assert.ok(!(r.card.beverage > 0));
  assert.strictEqual(r.target.eyBand, null);
  assert.strictEqual(r.target.tdsBand, null);
  assert.strictEqual(r.target.tds, null);
  assert.strictEqual(r.target.tdsRaw, null);
  assert.strictEqual(r.target.extractMass, null);
});
test('退化：ok=false 时「水与粉的关系」推出来的 8 个量一律为 null（保留用户输入）', () => {
  const bad = [
    { dose: 100 }, { ratio: 40.01 }, { ratio: 1.5 }, { tempC: 200 }, { targetEy: 31 },
    { measuredTds: 6 }, { dose: 'abc' }, { iced: true, iceFrac: 1 },
  ];
  bad.forEach((patch) => {
    const r = A.compute(patch);
    assert.strictEqual(r.ok, false, JSON.stringify(patch));
    const derived = ['waterTotal', 'waterRetained', 'beverage'];
    derived.forEach((k) => assert.strictEqual(r.card[k], null, JSON.stringify(patch) + ' card.' + k));
    ['tds', 'tdsRaw', 'extractMass'].forEach((k) => assert.strictEqual(r.target[k], null, JSON.stringify(patch) + ' target.' + k));
    assert.strictEqual(r.card.iceG, null, JSON.stringify(patch) + ' iceG');
    assert.strictEqual(r.card.hotWaterG, null, JSON.stringify(patch) + ' hotWaterG');
    /* 用户填的东西必须留着，用户要知道「你填的是 100」 */
    assert.strictEqual(typeof r.input.dose, 'number');
    assert.strictEqual(typeof r.input.ratio, 'number');
    assert.strictEqual(typeof r.input.tempC, 'number');
  });
});
test('冰冲：热水部分盖不住吸水时给出 iced-hot-insufficient 提示（仍出卡）', () => {
  const r = A.compute({ dose: 15, ratio: 2.5, iced: true, iceFrac: 0.4, vesselId: 'v60' });
  assert.strictEqual(r.ok, true, 'R=2.5 > k=2.0，仍然出卡');
  assert.ok(r.warnings.some((w) => w.code === 'iced-hot-insufficient'),
    '必须给出 iced-hot-insufficient：' + JSON.stringify(r.warnings.map((w) => w.code)));
  const w = r.warnings.find((x) => x.code === 'iced-hot-insufficient');
  assert.ok(/22\.5/.test(w.msg) && /30/.test(w.msg), '提示要带上具体数字：' + w.msg);
  /* 侧 1：冰占比降到 0 就不再提示 */
  const ok0 = A.compute({ dose: 15, ratio: 2.5, iced: true, iceFrac: 0, vesselId: 'v60' });
  assert.ok(!ok0.warnings.some((x) => x.code === 'iced-hot-insufficient'), '冰 0 % 不该提示');
  /* 侧 2：比例提上去就不再提示 */
  const ok1 = A.compute({ dose: 15, ratio: 8, iced: true, iceFrac: 0.4, vesselId: 'v60' });
  assert.ok(!ok1.warnings.some((x) => x.code === 'iced-hot-insufficient'), '比例 8 不该提示');
  /* 侧 3：不勾冰冲时永远不出现这条 */
  const dry = A.compute({ dose: 15, ratio: 2.5, iced: false, vesselId: 'v60' });
  assert.ok(!dry.warnings.some((x) => x.code === 'iced-hot-insufficient'));
});
test('零分母：杯量为 0 时浓度不能给出有限数', () => {
  const r = A.compute({ vesselId: 'v60', dose: 15, ratio: 2.0 });
  assert.strictEqual(r.target.tds, null, 'R=k 时浓度必须是 null，不能给一个假数');
  assert.strictEqual(r.target.tdsRaw, null, 'R=k 时全精度浓度也必须是 null');
  assert.strictEqual(r.card.iceG, null, '不可行时冰量必须是 null');
  assert.strictEqual(r.card.hotWaterG, null, '不可行时热水量必须是 null');
});
test('反解：目标杯量为 0 / 负数 / null 一律返回 null，不抛异常', () => {
  const r = A.compute(A.defaults());
  [0, -1, null, undefined, '', 'abc', NaN].forEach((v) => {
    assert.strictEqual(r.inverse.forBeverage(v), null, 'forBeverage(' + String(v) + ') 应为 null');
  });
  assert.strictEqual(r.inverse.forBeverage(230).dose, 16.43);
  assert.strictEqual(r.inverse.forBeverage(230).water, 262.9);
  assert.strictEqual(r.inverse.forBeverage(300).dose, 21.43);
});

/* ─────────────── 单调性 ─────────────── */
test('单调：粉重 ↑ → 注水 ↑、杯量 ↑、可溶物不降（比例固定）', () => {
  let prev = null;
  /* 步长 0.5（从 5 g 起）：让「1 位小数显示」本身严格递增。
     注意断言用的是显示值（杯量 1 位、可溶物 3 位），所以步长必须大于显示粒度。 */
  for (let i = 0; i <= 110; i++) {
    const d = Math.round((5 + i * 0.5) * 10) / 10;
    if (d > 60) break;
    const r = A.compute({ dose: d, ratio: 16 });
    assert.strictEqual(r.ok, true, 'dose=' + d);
    if (prev) {
      assert.ok(r.card.waterTotal > prev.card.waterTotal, 'dose=' + d + ' W 未严格递增（上一点 ' + prev.card.dose + ' W=' + prev.card.waterTotal + '）');
      assert.ok(r.card.beverage > prev.card.beverage, 'dose=' + d + ' V 未严格递增（上一点 ' + prev.card.dose + ' V=' + prev.card.beverage + '）');
      /* 可溶物是 3 位小数的显示值：显示抖动最多 ±0.001，所以用显示精度做下限。 */
      assert.ok(r.target.extractMass >= prev.target.extractMass - 0.0011, 'dose=' + d + ' E 下降（上一点 ' + prev.card.dose + ' E=' + prev.target.extractMass + '）');
    }
    prev = r;
  }
});

test('单调：比例 ↑ → 杯量 ↑ 但浓度不升（粉重固定）', () => {
  let prev = null;
  /* 浓度是按 2 位小数显示的口径：比例到 20 以后相邻两档的浓度差小于 0.01，
     因此这里断言「不升」；严格递减另用 1 位小数的比例步长单独验。 */
  for (let R = 3; R <= 40; R += 0.5) {
    const r = A.compute({ dose: 20, ratio: R, targetEy: 20 });
    assert.ok(r.feasible, 'R=' + R + ' 应当可行：' + JSON.stringify(r.errors));
    if (prev) {
      assert.ok(r.card.beverage > prev.card.beverage, 'R=' + R + ' V 未递增');
      assert.ok(r.target.tds <= prev.target.tds, 'R=' + R + ' 浓度反而升了');
    }
    prev = r;
  }
  /* 比例上限内浓度必须始终大于 0 */
  assert.ok(A.compute({ dose: 20, ratio: 40, targetEy: 20 }).target.tds > 0);
  /* 步长 1 时浓度必须严格递减 */
  let p2 = null;
  for (let R = 3; R <= 40; R += 1) {
    const r = A.compute({ dose: 20, ratio: R, targetEy: 20 });
    if (p2) assert.ok(r.target.tds < p2.target.tds, 'R=' + R + ' 浓度未严格递减（步长 1）');
    p2 = r;
  }
});
test('单调：水温不改变几何量（水温只影响 EY 建议，不影响水量/杯量）', () => {
  const a = A.compute({ tempC: 80 });
  const b = A.compute({ tempC: 96 });
  assert.strictEqual(a.card.waterTotal, b.card.waterTotal);
  assert.strictEqual(a.card.beverage, b.card.beverage);
});
test('单调：实测 TDS ↑ → 反推的萃取率 ↑', () => {
  let prev = -1;
  for (const t of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.8]) {
    const r = A.compute({ dose: 15, ratio: 16, measuredTds: t });
    assert.ok(r.diag.measured.ey > prev, 'TDS=' + t);
    prev = r.diag.measured.ey;
  }
});

/* ─────────────── 诊断：实测 TDS 路线 ─────────────── */
test('诊断：实测 TDS 1.10 % → 萃取率 15.4 %，判「不足」，建议磨细且不超过 3 档', () => {
  const r = A.compute({ dose: 15, ratio: 16, targetEy: 20, measuredTds: 1.1 });
  assert.strictEqual(r.diag.measured.ey, 15.4);
  assert.strictEqual(r.diag.measured.eyBand, 'under');
  assert.strictEqual(r.diag.measured.tdsBand, 'light');
  const adv = r.diag.tdsAdvice;
  assert.strictEqual(adv.gapPp, 4.6);
  assert.strictEqual(adv.grindSteps, 3, '不得超过 3 档上限');
  assert.strictEqual(adv.grindDir, '细');
  assert.strictEqual(adv.tempDelta, 1);
  assert.ok(/3 档/.test(adv.text) && /细/.test(adv.text), adv.text);
});
test('诊断：实测 TDS 已达标 → 不动研磨，且文案要说明差多少', () => {
  const r = A.compute({ dose: 15, ratio: 16, targetEy: 20, measuredTds: 20 * 15 / 210 });
  const adv = r.diag.tdsAdvice;
  assert.strictEqual(adv.grindSteps, 0);
  assert.strictEqual(adv.grindDir, '不动');
  assert.strictEqual(adv.tempDelta, 0);
  assert.ok(/落在目标上/.test(adv.text), adv.text);
});
test('诊断：实测 TDS 偏高 → 方向必须是「粗」', () => {
  const r = A.compute({ dose: 15, ratio: 16, targetEy: 18, measuredTds: 1.6 });
  const adv = r.diag.tdsAdvice;
  assert.ok(adv.eyNow > 18, 'eyNow=' + adv.eyNow);
  assert.strictEqual(adv.grindDir, '粗');
  assert.ok(adv.grindSteps < 0);
});
test('诊断：水温撞上限时不再建议升温，并如实说明', () => {
  const r = A.compute({ dose: 15, ratio: 16, targetEy: 20, measuredTds: 1.1, tempC: 96 });
  assert.strictEqual(r.diag.tdsAdvice.tempDelta, 0);
  assert.ok(r.diag.tdsAdvice.notes.some((n) => /水温/.test(n)), JSON.stringify(r.diag.tdsAdvice.notes));
});
test('诊断：没填实测 TDS 时 tdsAdvice 必须是 null（不能瞎编）', () => {
  assert.strictEqual(A.compute(A.defaults()).diag.tdsAdvice, null);
  assert.strictEqual(A.compute(A.defaults()).diag.measured, null);
});

/* ─────────────── 诊断：味觉路线（六条分支逐条走） ─────────────── */
test('味觉：六种味觉逐条给出判定与至少一个可执行动作', () => {
  const expect = {
    'weak-sour': /萃取不足/,
    'weak-bitter': /过萃/,
    'ok-sour': /不足/,
    'ok-bitter': /过度/,
    'strong-bitter': /浓度偏高/,
  };
  for (const t of Object.keys(expect)) {
    const r = A.compute({ taste: t });
    assert.ok(r.diag.tasteAdvice, t + ' 必须给出建议');
    assert.ok(expect[t].test(r.diag.tasteAdvice.verdict), t + ' 判定文案：' + r.diag.tasteAdvice.verdict);
    assert.ok(r.diag.tasteAdvice.steps.length >= 1, t + ' 至少一个动作');
    assert.ok(r.diag.tasteAdvice.steps.every((s) => typeof s.text === 'string' && s.text.length > 2));
    assert.ok(r.diag.tasteAdvice.why.length > 8, t + ' 要说明为什么');
    assert.strictEqual(r.diag.tasteAdvice.basedOn, '味觉（没有实测 TDS）');
  }
});
test('味觉：不填（空串）与非法值都给 null', () => {
  assert.strictEqual(A.compute({ taste: '' }).diag.tasteAdvice, null);
  assert.strictEqual(A.compute({ taste: 'nonsense' }).diag.tasteAdvice, null);
  assert.strictEqual(A.compute({ taste: null }).diag.tasteAdvice, null);
});
test('味觉：研磨已在最细档时不再建议磨细，并如实加说明', () => {
  const r = A.compute({ taste: 'weak-sour', grindIdx: 5 });
  assert.ok(!r.diag.tasteAdvice.steps.some((s) => s.lever === 'grind' && s.delta > 0), '不该再磨细');
  assert.ok(r.diag.tasteAdvice.notes.some((n) => /最细/.test(n)), JSON.stringify(r.diag.tasteAdvice.notes));
});
test('味觉：研磨已在最粗档时不再建议磨粗', () => {
  const r = A.compute({ taste: 'ok-bitter', grindIdx: 0 });
  assert.ok(!r.diag.tasteAdvice.steps.some((s) => s.lever === 'grind' && s.delta < 0), '不该再磨粗');
  assert.ok(r.diag.tasteAdvice.notes.some((n) => /最粗/.test(n)));
});
test('味觉：水温撞上限/下限时对应动作被摘掉并说明', () => {
  const hot = A.compute({ taste: 'weak-sour', tempC: 96 });
  assert.ok(!hot.diag.tasteAdvice.steps.some((s) => s.lever === 'temp' && s.delta > 0));
  assert.ok(hot.diag.tasteAdvice.notes.length >= 1);
  const cold = A.compute({ taste: 'ok-bitter', tempC: 80 });
  assert.ok(!cold.diag.tasteAdvice.steps.some((s) => s.lever === 'temp' && s.delta < 0));
  assert.ok(cold.diag.tasteAdvice.notes.length >= 1);
});
test('味觉：同时填了实测 TDS 时，basedOn 要写明两个来源', () => {
  const r = A.compute({ taste: 'ok-bitter', measuredTds: 1.5 });
  assert.ok(/味觉 \+ 实测萃取率/.test(r.diag.tasteAdvice.basedOn), r.diag.tasteAdvice.basedOn);
});

/* ─────────────── 自检会红（反向验证） ─────────────── */
test('自检：默认场景 12 项全绿', () => {
  const ck = A.runChecks(A.compute(A.defaults()));
  const bad = ck.filter((c) => !c.pass);
  assert.deepStrictEqual(bad, [], JSON.stringify(bad));
  assert.ok(ck.length >= 12, '检查项数量 ' + ck.length);
});
test('自检会红：16 套人工注入的错误各自让指定检查变红', () => {
  const base = A.compute(A.defaults());
  /* 深拷贝必须保留 inverse.forBeverage 这个函数，否则注入器自己就把函数弄丢了 */
  const clone = () => {
    const r = JSON.parse(JSON.stringify(base));
    r.inverse.forBeverage = base.inverse.forBeverage;   // 用同一个函数引用
    return r;
  };
  const redCases = [
    ['注水量写错', (r) => { r.card.waterTotal = 250; }, '注水量'],
    ['留水量写错', (r) => { r.card.waterRetained = 10; }, '留住的水'],
    ['杯量写错', (r) => { r.card.beverage = 999; }, '杯里液重'],
    ['全精度浓度写错', (r) => { r.target.tdsRaw = 9.9; }, '全精度'],
    ['显示浓度写错', (r) => { r.target.tds = 9.9; }, '显示浓度'],
    ['杯量写错（同时打断内部自洽）', (r) => { r.card.beverage = 5; }, '可溶物'],
    ['可溶物写错（路径1）', (r) => { r.target.extractMass = 9; }, '可溶物质量'],
    ['每克粉杯量写错（同时打断两条）', (r) => { r.inverse.perGram.beverage = 99; r.inverse.forBeverage = () => ({ dose: 99, water: 1, beverage: 1 }); }, '反解粉重'],
    ['冗余字段写错', (r) => { r.inverse.perGram.beverage = 99; }, '冗余字段'],
    ['注水表末段累计写错', (r) => { r.pours[r.pours.length - 1].cum = 1; }, '分段注水累计'],
    ['冰拆分写错', (r) => { r.card.iced = true; r.card.iceG = 0; r.card.hotWaterG = 999; }, '冰冲'],
    ['杯量写成负数', (r) => { r.card.beverage = -5; }, '杯里液重'],
    ['反解粉重写错', (r) => { r.inverse.forBeverage = () => ({ dose: 999 }); }, '反解粉重'],
    ['k 与器具不一致', (r) => { r.input.k = 5; }, '留住的水'],
    ['比例被改', (r) => { r.input.ratio = 12; }, '注水量'],
    ['注水表之和写错', (r) => { r.pours[1].amount = 0; }, '分段注水之和'],
  ];
  assert.strictEqual(redCases.length, 16);
  for (const [name, mutate, expectNamePart] of redCases) {
    const r = clone();
    mutate(r);
    const ck = A.runChecks(r);
    const hit = ck.filter((c) => !c.pass && c.name.indexOf(expectNamePart) >= 0);
    assert.ok(hit.length >= 1, '注入「' + name + '」后没有任何检查变红（期望命中 ' + expectNamePart + '）：' + JSON.stringify(ck.map((c) => c.name + ':' + c.pass)));
  }
});
test('自检：空结果不抛异常，直接判红', () => {
  assert.doesNotThrow(() => A.runChecks(null));
  assert.strictEqual(A.runChecks(null)[0].pass, false);
  assert.strictEqual(A.runChecks({})[0].pass, false);
});

/* ─────────────── 纯函数与确定性 ─────────────── */
test('纯函数：不改传入对象；同一输入两次结果完全一致', () => {
  const inp = A.defaults();
  const snapshot = JSON.stringify(inp);
  const r1 = A.compute(inp);
  const r2 = A.compute(inp);
  assert.strictEqual(JSON.stringify(inp), snapshot, 'compute 修改了调用方的输入对象');
  assert.strictEqual(JSON.stringify(r1), JSON.stringify(r2), '两次结果不一致');
  assert.strictEqual(r1.generatedAt, null, '核心层不写时间，保证纯函数');
});
test('纯函数：defaults() 每次返回新对象，改一个不影响另一个', () => {
  const a = A.defaults(); const b = A.defaults();
  a.dose = 99;
  assert.strictEqual(b.dose, 15);
  assert.strictEqual(A.defaults().dose, 15);
});
test('纯函数：常量表没有被 compute 改动（VESSELS / GRINDS 冻结检查）', () => {
  const before = JSON.stringify(A.VESSELS) + JSON.stringify(A.GRINDS) + JSON.stringify(A.CONST);
  A.compute({ vesselId: 'immersion', dose: 30, ratio: 12, iced: true });
  A.compute(A.defaults());
  assert.strictEqual(JSON.stringify(A.VESSELS) + JSON.stringify(A.GRINDS) + JSON.stringify(A.CONST), before);
});

/* ─────────────── 输出契约与格式化 ─────────────── */
test('契约：默认结果的字段齐全且类型正确', () => {
  const r = A.compute(A.defaults());
  const keys = ['version', 'input', 'ok', 'feasible', 'errors', 'warnings', 'card', 'target', 'pours', 'diag', 'inverse', 'notes'];
  keys.forEach((k) => assert.ok(k in r, '缺字段 ' + k));
  assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings) && Array.isArray(r.pours) && Array.isArray(r.notes));
  assert.strictEqual(typeof r.ok, 'boolean');
  assert.strictEqual(r.version, '1.0.0');
  ['dose', 'waterTotal', 'waterRetained', 'beverage'].forEach((k) => assert.strictEqual(typeof r.card[k], 'number', k));
  assert.ok(r.notes.length >= 3, '边界说明至少 3 条');
  assert.ok(r.notes.every((n) => typeof n === 'string' && n.length > 10));
});
test('契约：小数位口径（杯量 1 位、浓度 2 位、可溶物 3 位）', () => {
  const r = A.compute({ vesselId: 'aeropress', dose: 18, ratio: 13, targetEy: 21 });
  assert.strictEqual(r.card.beverage, 219.6, '1 位小数');
  assert.strictEqual(r.target.tds, 1.72, '2 位小数');
  assert.strictEqual(r.target.extractMass, 3.78, '3 位小数');
  assert.ok(Math.abs(r.target.extractMass - r.card.beverage * r.target.tds / 100) <= r.card.beverage * 0.00005 + 0.0006, '显式口径下两条路径必须落进推导容差');
  assert.ok(Math.abs(r.target.tdsRaw - 3.78 / 219.6 * 100) < 1e-9, 'tdsRaw 必须是全精度');
});
test('契约：每个器具的 k 与说明都能取到', () => {
  A.VESSELS.forEach((v) => {
    assert.ok(v.k > 0, v.id);
    assert.ok(v.name.length > 2 && v.note.length > 6, v.id);
    const r = A.compute({ vesselId: v.id, dose: 15, ratio: Math.max(4, v.k + 6) });
    assert.strictEqual(r.input.vesselId, v.id);
    assert.strictEqual(r.input.k, v.k);
  });
  assert.strictEqual(A.VESSELS.length, 5);
  assert.strictEqual(A.GRINDS.length, 6);
});
test('契约：场景预设 7 个，每个都能算出 ok 且 ID 唯一', () => {
  const sc = A.scenarios();
  assert.strictEqual(sc.length, 7);
  assert.strictEqual(new Set(sc.map((s) => s.id)).size, 7);
  sc.forEach((s) => {
    const r = A.compute(s.input);
    assert.strictEqual(r.ok, true, s.id + ' 场景应当可算：' + JSON.stringify(r.errors));
  });
});

/* ─────────────── 随机压力 + 不变量 ─────────────── */
test('随机压力：300 组随机输入 × 15 条不变量，0 违反', () => {
  let seed = 20261113;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let viol = 0, checked = 0, feasibleCount = 0;
  const v = [];
  for (let i = 0; i < 300; i++) {
    const inp = {
      vesselId: pick(A.VESSELS).id,
      dose: Math.round((3 + rnd() * 62) * 10) / 10,
      ratio: Math.round((1 + rnd() * 42) * 10) / 10,
      tempC: Math.round(60 + rnd() * 45),
      grindIdx: Math.floor(rnd() * 6),
      targetEy: Math.round((10 + rnd() * 22) * 10) / 10,
      iced: rnd() < 0.5,
      iceFrac: Math.round(rnd() * 100) / 100,
      measuredTds: rnd() < 0.5 ? Math.round(rnd() * 400) / 100 : null,
      taste: pick(['', 'weak-sour', 'weak-bitter', 'ok-sour', 'ok-bitter', 'strong-bitter']),
    };
    const r = A.compute(inp);
    const k = r.input.k, D = r.input.dose, R = r.input.ratio;
    const inv = [
      ['ok 与 feasible 一致', r.feasible === (r.ok && D * (R - k) > 0)],
      ['errors 数组', Array.isArray(r.errors)],
      ['ok=false 必有 errors', r.ok || r.errors.length > 0],
      ['注水 = R·D', r.feasible ? Math.abs(r.card.waterTotal - R * D) < 0.06 : r.card.waterTotal === null],
      ['留存 = k·D', r.feasible ? Math.abs(r.card.waterRetained - k * D) < 0.06 : r.card.waterRetained === null],
      ['杯量 = D(R−k)', r.feasible ? Math.abs(r.card.beverage - D * (R - k)) < 0.11 : r.card.beverage === null],
      ['可行性两侧的有限性', r.feasible ? (isFinite(r.card.waterTotal) && isFinite(r.card.beverage)) : (r.card.waterTotal === null && r.card.beverage === null)],
      ['温度原样', r.card.tempC === r.input.tempC],
      ['研磨标签合法', A.GRINDS.indexOf(r.card.grindLabel) >= 0],
    ];
    if (r.feasible) {
      feasibleCount++;
      inv.push(
        ['杯量为正', r.card.beverage > 0],
        ['浓度为正', r.target.tds > 0],
        ['可溶物守恒（含显示舍入容差）', Math.abs(r.target.extractMass - r.card.beverage * r.target.tds / 100) <= 0.0006 + 0.05 * r.target.tds / 100 + r.card.beverage * 0.005 / 100 + r.card.dose * 0.0053 / 100],
        ['冰守恒', !r.card.iced || Math.abs(r.card.iceG + r.card.hotWaterG - r.card.waterTotal) < 0.11],
        ['注水表累计 = 注水目标', Math.abs(r.pours[r.pours.length - 1].cum - (r.card.iced ? r.card.hotWaterG : r.card.waterTotal)) < 0.11],
        ['自检全绿', A.runChecks(r).every((c) => c.pass)],
      );
    } else {
      inv.push(['不可行时无注水表', r.pours.length === 0]);
      inv.push(['不可行时 8 个推导量全为 null', r.card.waterTotal === null && r.card.waterRetained === null && r.card.beverage === null
        && r.target.tds === null && r.target.tdsRaw === null && r.target.extractMass === null
        && r.card.iceG === null && r.card.hotWaterG === null]);
    }
    checked += inv.length;
    inv.forEach(([name, cond]) => { if (!cond) { viol++; v.push(JSON.stringify(inp) + ' → ' + name); } });
  }
  assert.ok(feasibleCount > 120, '可行样本太少，压力不够：' + feasibleCount);
  assert.strictEqual(viol, 0, viol + ' 条不变量被违反：\n' + v.slice(0, 12).join('\n'));
  assert.ok(checked > 3500, '不变量检查次数 ' + checked);
});
test('随机压力：任意输入下 compute 与 runChecks 都不抛异常', () => {
  let seed = 777;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 200; i++) {
    const weird = {
      vesselId: rnd() < 0.3 ? 'nope' : A.VESSELS[Math.floor(rnd() * 5)].id,
      dose: rnd() < 0.2 ? null : (rnd() < 0.5 ? -rnd() * 10 : rnd() * 200),
      ratio: rnd() < 0.2 ? 'x' : rnd() * 100,
      tempC: rnd() < 0.2 ? NaN : rnd() * 300,
      grindIdx: rnd() < 0.2 ? 3.5 : rnd() * 10 - 2,
      targetEy: rnd() * 50,
      iced: rnd() < 0.5, iceFrac: rnd() * 2 - 0.5,
      measuredTds: rnd() < 0.5 ? rnd() * 20 - 5 : undefined,
      taste: rnd() < 0.5 ? 'weak-sour' : 123,
    };
    assert.doesNotThrow(() => { const r = A.compute(weird); A.runChecks(r); }, '第 ' + i + ' 组抛异常：' + JSON.stringify(weird));
  }
});
