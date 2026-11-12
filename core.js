/* 一杯手冲的配比卡 · 核心引擎（纯函数，浏览器与 node 通用）
 *
 * 一句话：填粉重、比例、器具、水温，算出壶里该烧多少水（粉会吸走一部分）、
 *         分段注水时刻表、杯里该有多少克；再用你实测的 TDS 或一句味觉，
 *         算出下一杯具体改哪一格、改几格。
 *
 * 口径与假设全部写在页面上（也在 需求与调研.md §3 里）：本引擎不联网、不认任何品牌、
 * 不预测口感、不评价豆子、不处理水质、不诊断意式流速。
 *
 * 公式（与页面、说明里每个数字同一套）：
 *   W  = R · D                                 总注水量 = 比例 × 粉重
 *   Rw = k · D                                 被粉留住的水 = 吸水系数 × 粉重
 *   V  = W − Rw = D · (R − k)                  杯里液重
 *   E  = V · TDS / 100                         被萃取出的可溶物质量
 *   EY = 100 · E / D = V · TDS / D             萃取率（%）
 *   TDS_target = EY_target · D / V             反解浓度
 *   D' = V_wanted / (R − k)                    反解粉重
 *   W' = R · V_wanted / (R − k)                反解总注水量
 *   冰冲：W_hot = W · (1 − iceFrac)，冰 = W · iceFrac
 */
(function (root, factory) {
  const A = factory();
  if (typeof module === 'object' && module.exports) module.exports = A;
  if (root) root.AppCore = A;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ─────────────── 器具与吸水留存系数 k ───────────────
     k = 每 1 g 干粉会带走多少 g 水。
     性质：**记忆中的经验值**（本轮未取得可引用一手来源，见 需求与调研.md §1.2），
     不是精确物理常数；法压/爱乐压因为能压、能倒干净，留存明显低于滤纸。
     用户在界面上可以改，改了立刻重算。 */
  const VESSELS = [
    { id: 'v60', name: '锥形滤纸（V60 类）', k: 2.0, kind: 'filter', note: '滤纸会挂水，粉床里那部分倒不出来' },
    { id: 'cake', name: '蛋糕杯 / 平底滤纸', k: 2.2, kind: 'filter', note: '平底粉床更厚，挂水略多' },
    { id: 'immersion', name: '法压壶（浸泡式）', k: 1.0, kind: 'immersion', note: '浸泡完压下去、倒到液面见渣，能多倒出一些' },
    { id: 'aeropress', name: '爱乐压（加压）', k: 0.8, kind: 'immersion', note: '加压压出，留存最少' },
    { id: 'espresso', name: '意式（仅参考系数）', k: 1.0, kind: 'espresso', note: '本项目不做意式流速/压粉诊断，只给参考系数' },
  ];
  const VESSEL_BY_ID = {};
  VESSELS.forEach(function (v) { VESSEL_BY_ID[v.id] = v; });

  /* 研磨档：0 最粗 → 5 最细。每细 1 档约 +1.0 个百分点 EY。
     **这是本工具显式声明的量级换算，不是任何磨豆机的刻度**。 */
  const GRINDS = ['粗砂糖', '中粗', '中细（默认）', '细', '很细', '极细（接近意式）'];
  const GRIND_EY_PER_STEP = 1.0;

  /* ─────────────── 常量与区间（性质逐条标明） ─────────────── */
  const CONST = {
    /* 记忆中的行业常用区间，本轮未取得可引用一手来源 → 页面只写「常用工作区间」 */
    eyBalanced: [18.0, 22.0],
    tdsFilterRange: [1.15, 1.45],
    /* 本工具的设计选择（产品定义，不是科学结论） */
    tdsBand: { light: 1.15, strong: 1.45 },     // <1.15 偏淡；>1.45 偏浓
    eyBand: { under: 18.0, over: 22.0 },        // <18 不足；>22 过度
    defaultTempC: 92,
    tempEyPerDegC: -0.3,                        // 温度每 +1 °C，EY 约 −? 见下注
    tempStepDegC: 2,
    tempStepEy: 0.6,                            // 一次建议改 2 °C ≈ 0.6 个百分点 EY
    ratioStep: 1.0,                             // 一次建议改 1 个比例单位 ≈ 0.10 个百分点 TDS
    ratioStepTds: 0.10,
    iceFracDefault: 0.4,
    bloomRatio: 2.0,                            // 闷蒸水量 = 2 × 粉重
    bloomMinG: 30,
    bloomSec: 30,
    /* 「前段至 60 %」的基准 = 总注水量 W（不是 W − 闷蒸）。这是澄清后的硬口径。 */
    pour2CumFrac: 0.60,
    /* 总时长 = 150 + 2 × (D − 15) 秒；下限是闷蒸的 30 秒；浸泡式抬到 240 秒。 */
    totalSecBase: 150,
    totalSecPerG: 2,
    totalSecFloor: 30,
    immersionSec: 240,
    maxGrindSteps: 3,                           // 单次建议最多改 3 档
  };
  /* 注：tempEyPerDegC 的符号约定 —— 这里用「每 +1 °C 使 EY 增加 0.3 个百分点」，
     实现里统一写成 +0.3/°C 的绝对值，方向由建议文案表达，避免符号写反。 */
  const TEMP_EY_PER_DEG = 0.3;

  const LIMITS = {
    dose: { min: 5, max: 60 },
    doseSmall: 8,        // < 8 g 提示
    doseLarge: 40,       // > 40 g 提示分两壶
    ratio: { min: 1.5, max: 40 },
    ratioDilute: 22,     // > 22 提示偏淡
    ratioTight: 1.5,     // R − k < 1.5 时给「杯量很少」警告
    temp: { min: 70, max: 100 },
    tempSuggest: [82, 96],
    targetEy: { min: 12, max: 30 },
    tds: { min: 0, max: 5 },
    iceFrac: { min: 0, max: 0.95 },
  };

  const FIELDS = ['vesselId', 'dose', 'ratio', 'tempC', 'grindIdx', 'targetEy', 'iced', 'iceFrac', 'measuredTds', 'taste'];
  const TASTES = [
    { id: '', label: '不填（我没测 TDS，也没细品）' },
    { id: 'weak-sour', label: '又淡又酸（像柠檬水）' },
    { id: 'weak-bitter', label: '淡，但后段发苦发涩' },
    { id: 'ok-sour', label: '浓淡还行，就是尖酸' },
    { id: 'ok-bitter', label: '浓淡还行，但苦、发干' },
    { id: 'strong-bitter', label: '太浓又苦' },
  ];
  const DEFAULTS = {
    vesselId: 'v60', dose: 15, ratio: 16, tempC: 92, grindIdx: 2,
    targetEy: 20, iced: false, iceFrac: 0.4, measuredTds: null, taste: '',
  };
  const SCENARIOS = [
    { id: 'default', name: '默认：中烘 15 g / 1:16 / V60', patch: {} },
    { id: 'big', name: '两杯量：22 g / 1:15.5', patch: { dose: 22, ratio: 15.5 } },
    { id: 'light', name: '浅烘尖酸：把水温提到 94 °C', patch: { tempC: 94, grindIdx: 3 } },
    { id: 'dark', name: '深烘怕苦：降到 88 °C、粗一档', patch: { tempC: 88, grindIdx: 1 } },
    { id: 'press', name: '法压壶 30 g / 1:15', patch: { vesselId: 'immersion', dose: 30, ratio: 15, grindIdx: 0 } },
    { id: 'iced', name: '冰手冲：15 g，四成水是冰', patch: { iced: true, iceFrac: 0.4 } },
    { id: 'calib', name: '校准演示：实测 TDS 1.10 %', patch: { measuredTds: 1.1 } },
  ];

  /* ─────────────── 工具 ─────────────── */
  function round(x, d) {
    if (!isFinite(x)) return NaN;
    const f = Math.pow(10, d == null ? 0 : d);
    return Math.round(x * f) / f;
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return isFinite(n) ? n : null;
  }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function vesselOf(id) { return VESSEL_BY_ID[id] || VESSEL_BY_ID.v60; }
  function grindLabel(i) { return GRINDS[clamp(Math.round(i), 0, GRINDS.length - 1)]; }

  /* ─────────────── 输入归一化（对 null / 空 / 非数字一律不抛异常） ─────────────── */
  function normalizeInput(input) {
    const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
    const o = {};
    o.vesselId = VESSEL_BY_ID[src.vesselId] ? src.vesselId : DEFAULTS.vesselId;
    const dn = num(src.dose); o.dose = dn === null ? DEFAULTS.dose : dn;
    const rn = num(src.ratio); o.ratio = rn === null ? DEFAULTS.ratio : rn;
    const tn = num(src.tempC); o.tempC = tn === null ? DEFAULTS.tempC : tn;
    const gn = num(src.grindIdx); o.grindIdx = gn === null ? DEFAULTS.grindIdx : clamp(Math.round(gn), 0, GRINDS.length - 1);
    const en = num(src.targetEy); o.targetEy = en === null ? DEFAULTS.targetEy : en;
    o.iced = src.iced === true || src.iced === 'true' || src.iced === 1;
    const icn = num(src.iceFrac); o.iceFrac = icn === null ? DEFAULTS.iceFrac : icn;
    o.measuredTds = num(src.measuredTds);
    o.taste = (typeof src.taste === 'string' && TASTES.some(function (t) { return t.id === src.taste; })) ? src.taste : '';
    /* 保留「用户到底填了什么」用于报错：字段是否存在、以及是否是可解析的数字 */
    o._raw = {};
    ['dose', 'ratio', 'tempC', 'targetEy'].forEach(function (f) {
      o._raw[f] = Object.prototype.hasOwnProperty.call(src, f) ? src[f] : undefined;
    });
    /* 数值字段统一成产品口径的小数位：保证「显示的数」与「参与判定/比较的数」是同一个数。
       温度与研磨档取整；比例最多 2 位；目标萃取率 2 位。 */
    o.tempC = Math.round(o.tempC);
    o.ratio = round(o.ratio, 2);
    o.targetEy = round(o.targetEy, 2);
    o.iceFrac = round(o.iceFrac, 4);
    o.measuredTds = o.measuredTds === null ? null : round(o.measuredTds, 2);
    return o;
  }
  function defaults() { return Object.assign({}, DEFAULTS); }
  function scenarios() { return SCENARIOS.map(function (s) { return { id: s.id, name: s.name, input: normalizeInput(Object.assign({}, DEFAULTS, s.patch)) }; }); }

  /* ─────────────── 校验：返回 {ok, errors[], warnings[]} ───────────────
     只接受「已经归一化过」的输入对象（带 _raw）。compute 直接把它传进来，
     这样「用户填的原文」和「四舍五入前的原值」都还在，不会校验到一个被改过的数。
     外部若直接调用 validate，请先 A.normalizeInput(...)。 */
  function validate(norm) {
    const o = (norm && norm._raw) ? norm : normalizeInput(norm);
    const errors = [], warnings = [];
    const raw = o._raw;
    /* 只有「用户真的填了一个值，但那不是数字」才算错；字段缺省或空串按默认值处理，不算错。 */
    function badText(v) {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string' && v.trim() === '') return false;
      return num(v) === null;
    }

    ['dose', 'ratio', 'tempC', 'targetEy'].forEach(function (f) {
      if (badText(raw[f])) errors.push({ field: f, code: 'not-a-number', msg: '「' + f + '」填的是「' + String(raw[f]) + '」，不是数字 —— 这一项已按默认值处理，请检查' });
    });

    if (o.dose < LIMITS.dose.min) errors.push({ field: 'dose', code: 'dose-too-small', msg: '粉重填的是 ' + o.dose + ' g，至少要 ' + LIMITS.dose.min + ' g（再少粉床太浅，注水不可能均匀）' });
    if (o.dose > LIMITS.dose.max) errors.push({ field: 'dose', code: 'dose-too-large', msg: '粉重填的是 ' + o.dose + ' g，最多 ' + LIMITS.dose.max + ' g（再多请分两壶）' });
    if (o.ratio < LIMITS.ratio.min) errors.push({ field: 'ratio', code: 'ratio-too-small', msg: '比例填的是 1 : ' + o.ratio + '，至少要 1 : ' + LIMITS.ratio.min });
    if (o.ratio > LIMITS.ratio.max) errors.push({ field: 'ratio', code: 'ratio-too-large', msg: '比例填的是 1 : ' + o.ratio + '，最多 1 : ' + LIMITS.ratio.max + '（这不是手冲了）' });
    if (o.tempC < LIMITS.temp.min || o.tempC > LIMITS.temp.max) errors.push({ field: 'tempC', code: 'temp-out-of-range', msg: '水温填的是 ' + o.tempC + ' °C，超出 ' + LIMITS.temp.min + '–' + LIMITS.temp.max + ' °C 这个范围（建议 ' + LIMITS.tempSuggest[0] + '–' + LIMITS.tempSuggest[1] + '）' });
    if (o.targetEy < LIMITS.targetEy.min || o.targetEy > LIMITS.targetEy.max) errors.push({ field: 'targetEy', code: 'ey-out-of-range', msg: '目标萃取率填的是 ' + o.targetEy + ' %，要在 ' + LIMITS.targetEy.min + '–' + LIMITS.targetEy.max + ' % 之间' });
    if (o.iced && (o.iceFrac < LIMITS.iceFrac.min || o.iceFrac > LIMITS.iceFrac.max)) errors.push({ field: 'iceFrac', code: 'ice-out-of-range', msg: '冰占比填的是 ' + o.iceFrac + '，要在 ' + LIMITS.iceFrac.min + '–' + LIMITS.iceFrac.max + ' 之间' });
    if (o.measuredTds !== null && (o.measuredTds <= LIMITS.tds.min || o.measuredTds >= LIMITS.tds.max)) errors.push({ field: 'measuredTds', code: 'tds-out-of-range', msg: '滤泡咖啡实测 TDS 一般在 1–2 %（意式 6–12 %）；' + o.measuredTds + ' % 超出本工具能解释的范围' });

    const v = vesselOf(o.vesselId);
    const k = v.k;
    /* 决定性退化：R ≤ k 时杯里不会有咖啡液 */
    if (o.ratio <= k) {
      errors.push({ field: 'ratio', code: 'no-beverage', msg: '这个比例下杯里不会有咖啡液：' + o.dose + ' g 粉会带走 ' + round(k * o.dose, 1) + ' g 水，而总注水只有 ' + round(o.ratio * o.dose, 1) + ' g。请把比例调到大于 1 : ' + k });
    }

    /* 提示与错误分开算：即使这一格填错了，其它格的提示也要照给，
       否则「粉重填 100」这种输入只会看到一条错，看不到「建议分两壶」这条更有用的提示。 */
    if (o.dose < LIMITS.doseSmall) warnings.push({ field: 'dose', code: 'dose-small', msg: '只有 ' + o.dose + ' g 粉，粉床很浅 —— 注水要更慢更稳，否则容易局部过萃' });
    if (o.dose >= LIMITS.doseLarge) warnings.push({ field: 'dose', code: 'dose-large', msg: o.dose + ' g 已经到或超过常见滤杯的舒适容量，建议分两壶（每壶 ' + round(o.dose / 2, 1) + ' g）' });
    if (o.ratio > LIMITS.ratioDilute) warnings.push({ field: 'ratio', code: 'ratio-dilute', msg: '1 : ' + o.ratio + ' 已经很淡了；再加水只会更淡，不会更「清爽」' });
    const margin = o.ratio - k;
    if (margin > 0 && margin <= LIMITS.ratioTight) warnings.push({ field: 'ratio', code: 'ratio-tight', msg: '杯里液重只有粉重的 ' + round(margin, 2) + ' 倍（' + round(margin * o.dose, 1) + ' g），非常少 —— 这已经到或接近这个器具的极限' });
    if (o.tempC < LIMITS.tempSuggest[0]) warnings.push({ field: 'tempC', code: 'temp-low', msg: o.tempC + ' °C 偏低，萃取会明显变慢，容易又酸又淡' });
    if (o.tempC > LIMITS.tempSuggest[1]) warnings.push({ field: 'tempC', code: 'temp-high', msg: o.tempC + ' °C 偏高，深烘豆容易出焦苦和涩' });
    if (o.targetEy < CONST.eyBalanced[0]) warnings.push({ field: 'targetEy', code: 'ey-low', msg: '目标萃取率 ' + o.targetEy + ' % 低于常用工作区间 ' + CONST.eyBalanced[0] + '–' + CONST.eyBalanced[1] + ' %，成品会偏酸偏薄' });
    if (o.targetEy > CONST.eyBalanced[1]) warnings.push({ field: 'targetEy', code: 'ey-high', msg: '目标萃取率 ' + o.targetEy + ' % 高于常用工作区间 ' + CONST.eyBalanced[0] + '–' + CONST.eyBalanced[1] + ' %，容易出苦涩和干口感' });
    if (v.kind === 'espresso') warnings.push({ field: 'vesselId', code: 'espresso-ref', msg: '意式只提供参考系数：本项目不做流速、压粉与粉饼诊断' });
    /* 冰冲专属：注水只针对热水部分，热水部分也可能盖不住粉吸走的量。
       这不是新的退化状态（R > k 仍成立），但必须如实提示 —— 文本没写清，已按 §9 澄清。 */
    if (o.iced && errors.length === 0) {
      const wHot = o.ratio * o.dose * (1 - o.iceFrac);
      if (wHot - k * o.dose <= 0) {
        warnings.push({
          field: 'iceFrac', code: 'iced-hot-insufficient',
          msg: '冰占 ' + Math.round(o.iceFrac * 100) + ' % 时，留给咖啡的热水只有 ' + round(wHot, 1) + ' g，盖不住粉会吸走的 ' +
            round(k * o.dose, 1) + ' g —— 热冲当下不会有咖啡液。把比例调大，或把冰占比调小。',
        });
      }
    }

    /* 保留字段：器具 k 被改成 ≤0（器具表固定，但保留这条判断以便测试与将来开放自定义） */
    if (!(k > 0)) errors.push({ field: 'vesselId', code: 'k-nonpositive', msg: '吸水留存系数必须大于 0' });

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ─────────────── 分段注水时刻表 ───────────────
     澄清后的口径（见 需求与调研.md §3.2）：
       · 注水分 3 段：① 闷蒸 max(2D, 30) g；② 注到「60 % × W」这个累计量；③ 把剩下的注完（累计 = W）。
       · 基准一律是 W；冰冲时注水只针对热水部分 W_hot = W × (1 − 冰占比)，
         所以冰冲的段 2 累计 = 60 % × W_hot，段 3 累计 = W_hot。
       · 总时长 = 150 + 2 × (D − 15) 秒，下限 30 秒；浸泡式抬到 240 秒。
       · 时刻：段 1 固定 0–30 秒；其余时间由段 2、3 均分。
       · 若 60 % × 基准 ≤ 闷蒸量（小水量时会发生），段 2 的量为 0 →
         该段并入段 1，时刻表退化成 2 段（不编造一个 0 g 的段）。 */
  function pourBase(o, v) {
    /* 注水针对的水量：冰冲只注热水部分；不勾冰冲就是 W。 */
    const W = o.ratio * o.dose;
    return o.iced ? W * (1 - o.iceFrac) : W;
  }
  function totalSeconds(D, v) {
    if (v.kind === 'immersion') return CONST.immersionSec;
    /* 计时器上只有整秒：计算值四舍五入成整数秒再排时刻。 */
    return Math.max(CONST.totalSecFloor, Math.round(CONST.totalSecBase + CONST.totalSecPerG * (D - 15)));
  }
  function pourSchedule(W, D, vessel, o) {
    const v = vesselOf(vessel && vessel.id ? vessel.id : vessel);
    const base = o ? pourBase(o, v) : W;     /* 注水的总克数（冰冲时是热水部分） */
    const totalSec = totalSeconds(D, v);

    if (v.kind === 'immersion') {
      return [
        { idx: 1, label: '一次注满', startSec: 0, endSec: CONST.bloomSec, amount: round(base, 1), cum: round(base, 1),
          note: '全部热水一次倒进去，搅一下让粉全湿' },
        { idx: 2, label: '浸泡', startSec: CONST.bloomSec, endSec: Math.max(CONST.bloomSec + 1, totalSec - 30), amount: 0, cum: round(base, 1),
          note: '盖盖子静置；到第 ' + Math.max(CONST.bloomSec + 1, totalSec - 30) + ' 秒开始压' },
        { idx: 3, label: '压下倒出', startSec: Math.max(CONST.bloomSec + 1, totalSec - 30), endSec: totalSec, amount: 0, cum: round(base, 1),
          note: '慢压到底，倒到液面见渣就停' },
      ];
    }

    const bloom = Math.min(Math.max(CONST.bloomMinG, CONST.bloomRatio * D), base);
    const c2 = base * CONST.pour2CumFrac;                 /* 段 2 的累计目标 = 60 % × 基准 */
    const seg2 = c2 - bloom;
    const seg3 = base - c2;

    if (seg2 <= 1e-9) {
      /* 段 2 塌成 0：并进段 1 */
      return [
        { idx: 1, label: '闷蒸 + 一次注完', startSec: 0, endSec: CONST.bloomSec, amount: round(base, 1), cum: round(base, 1),
          note: '水太少，闷蒸量已经占满了 60 % 的累计目标 —— 一次注完，然后等它滴' },
        { idx: 2, label: '等滴完', startSec: CONST.bloomSec, endSec: totalSec, amount: 0, cum: round(base, 1),
          note: '等到不再成线、开始一滴一滴就移开滤杯，别让它滴干' },
      ];
    }
    const rest = totalSec - CONST.bloomSec;
    const t2 = CONST.bloomSec + Math.round(rest / 2);
    return [
      { idx: 1, label: '闷蒸', startSec: 0, endSec: CONST.bloomSec, amount: round(bloom, 1), cum: round(bloom, 1),
        note: '从中心往外绕圈，把粉全部打湿，然后等 ' + CONST.bloomSec + ' 秒让它排气' },
      { idx: 2, label: '第二段', startSec: CONST.bloomSec, endSec: t2, amount: round(seg2, 1), cum: round(c2, 1),
        note: '细水流绕小圈，注到累计 ' + round(c2, 1) + ' g 为止' },
      { idx: 3, label: '第三段', startSec: t2, endSec: totalSec, amount: round(seg3, 1), cum: round(base, 1),
        note: '把剩下的注完，轻轻晃一下滤杯让粉床平，然后等它滴完（总时长约 ' + totalSec + ' 秒）' },
    ];
  }

  /* ─────────────── 味觉 / 实测 TDS → 具体改哪一格 ─────────────── */
  function tasteAdvice(o, v, beverage, eyNow) {
    /* eyNow: 实测 TDS 算出的当前萃取率；没有实测则为 null */
    const t = o.taste;
    if (!t) return null;
    const atCeiling = o.grindIdx >= GRINDS.length - 1;
    const atFloor = o.grindIdx <= 0;
    const hot = o.tempC >= LIMITS.tempSuggest[1];
    const cold = o.tempC <= LIMITS.tempSuggest[0];

    const A = {
      'weak-sour': {
        verdict: '萃取不足 + 浓度偏低',
        steps: [{ lever: 'grind', delta: 1, text: '研磨细 1 档' }, { lever: 'temp', delta: 1, text: '水温 +' + CONST.tempStepDegC + ' °C' }],
        why: '又淡又酸是「东西没萃出来」：先磨细，再补一点温度。',
      },
      'weak-bitter': {
        verdict: '浓度偏低但后段过萃',
        steps: [{ lever: 'grind', delta: 0, text: '研磨先不动' }, { lever: 'temp', delta: -1, text: '水温 −' + CONST.tempStepDegC + ' °C' }, { lever: 'pour', delta: 0, text: '注水更温柔、缩短后段拖尾' }],
        why: '淡说明水多，苦说明后段把不好的东西也带出来了 —— 先降温、改注水手法，别急着磨细。',
      },
      'ok-sour': {
        verdict: '浓度可以、萃取不足（多半不均匀）',
        steps: [{ lever: 'grind', delta: 1, text: '研磨细 1 档' }, { lever: 'pour', delta: 0, text: '闷蒸后搅一下粉层，减少通道效应' }],
        why: '浓淡对了但尖酸，通常是粉层里有水走得太快的「通道」，不是整体不够。',
      },
      'ok-bitter': {
        verdict: '浓度可以、萃取过度',
        steps: [{ lever: 'grind', delta: -1, text: '研磨粗 1 档' }, { lever: 'temp', delta: -1, text: '水温 −' + CONST.tempStepDegC + ' °C' }],
        why: '苦和干是萃太多了：粗一档、降一点温，杯量不变。',
      },
      'strong-bitter': {
        verdict: '浓度偏高 + 萃取过度',
        steps: [{ lever: 'ratio', delta: 1, text: '比例加水 1 个单位（1 : ' + round(o.ratio + CONST.ratioStep, 1) + '）' }, { lever: 'grind', delta: -1, text: '研磨粗 1 档' }],
        why: '又浓又苦：先加水把浓度降下来，再把研磨放粗一档。',
      },
    };
    const a = A[t] || null;
    if (!a) return null;

    /* 撞到边界时如实改口 */
    const notes = [];
    if (atCeiling && a.steps.some(function (s) { return s.lever === 'grind' && s.delta > 0; })) {
      a.steps = a.steps.filter(function (s) { return !(s.lever === 'grind' && s.delta > 0); });
      notes.push('研磨已经是最细一档，再细会堵滤纸 —— 本轮只能靠水温和注水手法。');
    }
    if (atFloor && a.steps.some(function (s) { return s.lever === 'grind' && s.delta < 0; })) {
      a.steps = a.steps.filter(function (s) { return !(s.lever === 'grind' && s.delta < 0); });
      notes.push('研磨已经是最粗一档，再粗就成泡豆子了 —— 换成降温、缩短浸泡时间。');
    }
    if (hot && a.steps.some(function (s) { return s.lever === 'temp' && s.delta > 0; })) {
      a.steps = a.steps.filter(function (s) { return !(s.lever === 'temp' && s.delta > 0); });
      notes.push('水温已经到 ' + LIMITS.tempSuggest[1] + ' °C 上限，不再往上加。');
    }
    if (cold && a.steps.some(function (s) { return s.lever === 'temp' && s.delta < 0; })) {
      a.steps = a.steps.filter(function (s) { return !(s.lever === 'temp' && s.delta < 0); });
      notes.push('水温已经到 ' + LIMITS.tempSuggest[0] + ' °C 下限，不再往下减。');
    }
    a.notes = notes;
    a.basedOn = eyNow === null || eyNow === undefined ? '味觉（没有实测 TDS）' : '味觉 + 实测萃取率 ' + round(eyNow, 2) + ' %';
    return a;
  }

  function tdsAdvice(o, eyNow) {
    if (eyNow === null || eyNow === undefined) return null;
    const gap = o.targetEy - eyNow;                        // 百分点
    const steps = clamp(round(gap / GRIND_EY_PER_STEP, 2), -CONST.maxGrindSteps, CONST.maxGrindSteps);
    const dir = steps > 0.05 ? '细' : (steps < -0.05 ? '粗' : '不动');
    const tempDelta = Math.abs(gap) < 0.5 ? 0 : (gap > 0 ? 1 : -1);
    const hot = o.tempC >= LIMITS.tempSuggest[1];
    const cold = o.tempC <= LIMITS.tempSuggest[0];
    const notes = [];
    let finalTemp = tempDelta;
    if ((tempDelta > 0 && hot) || (tempDelta < 0 && cold)) { finalTemp = 0; notes.push('水温已经在建议区间边界上，这一步只动研磨。'); }
    const out = {
      eyNow: round(eyNow, 2),
      eyTarget: round(o.targetEy, 1),
      gapPp: round(gap, 2),
      grindSteps: Math.abs(steps) < 0.05 ? 0 : steps,
      grindDir: dir,
      grindLabelNow: grindLabel(o.grindIdx),
      grindLabelNext: grindLabel(clamp(o.grindIdx + Math.round(steps), 0, GRINDS.length - 1)),
      tempDelta: finalTemp,
      text: (Math.abs(steps) < 0.05
        ? '萃取率已经落在目标上（差 ' + round(gap, 2) + ' 个百分点），研磨不用动'
        : '下一杯把研磨' + dir + ' ' + Math.abs(round(steps, 1)) + ' 档（' + grindLabel(o.grindIdx) + ' → ' + grindLabel(clamp(o.grindIdx + Math.round(steps), 0, GRINDS.length - 1)) + '）')
        + (finalTemp ? '，水温' + (finalTemp > 0 ? '+' : '−') + CONST.tempStepDegC + ' °C' : ''),
      howMuch: '本工具的换算：每细 1 档约 +' + GRIND_EY_PER_STEP.toFixed(1) + ' 个百分点萃取率；实际取决于你的磨豆机，请把它当量级而不是刻度。',
      notes: notes,
    };
    return out;
  }

  /* ─────────────── 主计算 ─────────────── */
  function compute(input) {
    const o = normalizeInput(input);
    const v = vesselOf(o.vesselId);
    const k = v.k;
    const report = validate(o);  /* o 已归一化，_raw 保留用户原文 */

    const D = o.dose, R = o.ratio;
    const W = R * D;
    const Rw = k * D;
    const Vraw = W - Rw;                                  // 可能 ≤ 0（已在 validate 里判为错误）
    const V = Vraw;
    const feasible = Vraw > 0 && report.ok;
    const iceFrac = o.iced ? o.iceFrac : 0;
    /* 出卡才给这些量：不可行时「冰多少 / 热水多少」没有意义，给 null 而不是给一个假数。 */
    const iceG = feasible ? W * iceFrac : null;
    const hotWaterG = feasible ? W - iceG : null;
    /* 由 EY = V·TDS/D 且 TDS = EY·D/V，可溶物质量 E = V·TDS/100 = EY·D/100。
       直接写 EY·D/100，避免两条路径各自舍入产生不一致。 */
    const Emass = feasible ? o.targetEy * D / 100 : NaN;
    const tdsTargetRaw = feasible ? o.targetEy * D / V : NaN;
    const tdsTargetR = round(tdsTargetRaw, 2);
    const eyBand = !feasible ? null
      : (o.targetEy < CONST.eyBand.under ? 'under' : (o.targetEy > CONST.eyBand.over ? 'over' : 'balanced'));
    const tdsBand = !feasible ? null
      : (tdsTargetR < CONST.tdsBand.light ? 'light' : (tdsTargetR > CONST.tdsBand.strong ? 'strong' : 'ok'));
    const pours = feasible ? pourSchedule(W, D, v, o) : [];

    const eyNow = (feasible && o.measuredTds !== null) ? (V * o.measuredTds / D) : null;
    const diag = {
      tdsAdvice: tdsAdvice(o, eyNow),
      tasteAdvice: feasible ? tasteAdvice(o, v, V, eyNow) : null,
      measured: eyNow === null ? null : {
        tds: round(o.measuredTds, 2),
        ey: round(eyNow, 2),
        eyBand: eyNow < CONST.eyBand.under ? 'under' : (eyNow > CONST.eyBand.over ? 'over' : 'balanced'),
        tdsBand: o.measuredTds < CONST.tdsBand.light ? 'light' : (o.measuredTds > CONST.tdsBand.strong ? 'strong' : 'ok'),
      },
    };

    /* 反解路径：想要 V_wanted 时该用多少粉、多少水 */
    const inverse = feasible ? {
      perGram: { dose: 1, ratio: R, water: R, beverage: round(R - k, 4) },
      forBeverage: function (vWanted) {
        const n = num(vWanted);
        if (n === null || n <= 0) return null;
        const dNeed = n / (R - k);
        return { dose: round(dNeed, 2), water: round(R * dNeed, 1), beverage: round(n, 1) };
      },
    } : null;

    return {
      version: VERSION,
      input: {
        vesselId: o.vesselId, vesselName: v.name, vesselKind: v.kind, k: k,
        dose: round(D, 2), ratio: round(R, 2), tempC: o.tempC, grindIdx: o.grindIdx,
        grindLabel: grindLabel(o.grindIdx), targetEy: round(o.targetEy, 2), iced: o.iced, iceFrac: iceFrac,
        measuredTds: o.measuredTds, taste: o.taste,
      },
      ok: report.ok,
      feasible: feasible,
      errors: report.errors,
      warnings: report.warnings,
      card: {
        /* 出卡才给「水与粉的关系」推出来的量：不可行时给 null，不给一个假数（负数杯量不是结果也不是输入）。 */
        dose: round(D, 2),
        waterTotal: feasible ? round(W, 1) : null,
        waterRetained: feasible ? round(Rw, 1) : null,
        beverage: feasible ? round(V, 1) : null,
        ratioText: '1 : ' + round(R, 2),
        tempC: o.tempC, grindLabel: grindLabel(o.grindIdx),
        iceG: feasible ? round(iceG, 1) : null, hotWaterG: feasible ? round(hotWaterG, 1) : null, iced: o.iced,
      },
      target: {
        ey: round(o.targetEy, 2), eyTarget: round(o.targetEy, 2),
        tds: feasible ? tdsTargetR : null, tdsRaw: feasible ? tdsTargetRaw : null,
        extractMass: feasible ? round(Emass, 3) : null, eyBand: eyBand, tdsBand: tdsBand,
        eyBalanced: CONST.eyBalanced.slice(), tdsRange: CONST.tdsFilterRange.slice(),
      },
      pours: pours,
      diag: diag,
      inverse: inverse,
      notes: buildNotes(o, v, V, feasible, k),
      generatedAt: null,   // 由调用方（UI）写时间，保证核心是纯函数
    };
  }

  function buildNotes(o, v, V, feasible, k) {
    const n = [];
    n.push('吸水留存按 ' + k + ' g 水 / g 粉（' + v.name + '）：' + v.note + '。这是经验值，不是精确常数。');
    n.push('目标萃取率是你自己定的；本工具只用它反解浓度，不替你判断好不好喝。');
    if (feasible) n.push('每 1 g 粉出 ' + round(V / o.dose, 2) + ' g 咖啡液（比例减去吸水系数）；想要某个杯量，就用「杯量 ÷ ' + round(o.ratio - k, 2) + '」作粉重。');
    return n;
  }

  /* ─────────────── 自检（页面里也跑同一套，用来防公式被改坏） ─────────────── */
  function runChecks(result) {
    const ck = [];
    function t(name, cond, detail) { ck.push({ name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) }); return !!cond; }
    if (!result || !result.card) { t('结果存在', false, 'result 为空'); return ck; }
    const c = result.card, tg = result.target;
    const near = function (a, b, eps) { return isFinite(a) && isFinite(b) && Math.abs(a - b) <= (eps === undefined ? 0.02 : eps); };

    t('注水量 = 比例 × 粉重', near(c.waterTotal, result.input.ratio * c.dose, 0.06), c.waterTotal + ' vs ' + round(result.input.ratio * c.dose, 2));
    t('留住的水 = k × 粉重', near(c.waterRetained, result.input.k * c.dose, 0.06));
    t('杯里液重 = 注水 − 留住', near(c.beverage, c.waterTotal - c.waterRetained, 0.11), c.beverage + ' vs ' + round(c.waterTotal - c.waterRetained, 2));
    if (result.feasible) {
      /* ── 容差口径（全部按「显示值的小数位」推导，不是拍的数） ──
         公开字段是显示值：杯量 1 位（±0.05 g）、总注水 1 位（±0.05 g）、浓度 2 位（±0.005 %）、
         可溶物 3 位（±0.0005 g）、萃取率 2 位（±0.005 个百分点）。
         小剂量时 ±0.05 g 的显示舍入相对于粉重很大，所以容差用「显示精度 ÷ 杯量」这类相对量推。 */
      const etaV = 0.05 / c.beverage;                 // 杯量显示精度（1 位）带来的相对误差
      const etaW = 0.05 / c.waterTotal;               // 总注水显示精度（1 位）带来的相对误差
      const eyDelta = 0.005;                          // 萃取率显示精度（2 位）
      const eyRawTol = tg.ey * (etaV + etaW) + eyDelta;                              // 全精度浓度回代
      const eyShowTol = tg.ey * (etaV + etaW + 0.005 / (tg.tds || 1)) + eyDelta;      // 显示浓度回代
      /* 可溶物两条路径：杯量 1 位的绝对误差 ±0.05 g 直接乘浓度（百分比）→ /100 转到克；
         再加上可溶物自身 3 位小数的 ±0.0005 与浓度 2 位小数的贡献。 */
      /* 可溶物两条路径的容差 = 可溶物自身 3 位小数的 ±0.0005
         + 杯量 1 位小数的 ±0.05 g 乘浓度（百分比）→ /100 转到克
         + 浓度 2 位小数的 ±0.005 乘杯量 → /100 转到克 */
      const massTolFinal = 0.0006 + 0.05 * tg.tds / 100 + c.beverage * 0.005 / 100 + c.dose * 0.0053 / 100;

      t('萃取率 → 浓度 → 萃取率 回到原值（全精度）', near(tg.tdsRaw * c.beverage / c.dose, tg.ey, eyRawTol), round(tg.tdsRaw * c.beverage / c.dose, 4) + ' vs ' + tg.ey + '（容差 ' + round(eyRawTol, 4) + '）');
      t('萃取率 → 显示浓度 → 萃取率（含显示舍入容差）', near(tg.tds * c.beverage / c.dose, tg.ey, eyShowTol), round(tg.tds * c.beverage / c.dose, 4) + ' vs ' + tg.ey + '（容差 ' + round(eyShowTol, 4) + '）');
      t('可溶物质量 = 萃取率 × 粉重 / 100', near(tg.extractMass, tg.ey * c.dose / 100, 0.0006));
      t('可溶物质量 = 杯量 × 浓度 / 100（含显示舍入容差）', near(tg.extractMass, c.beverage * tg.tds / 100, massTolFinal), tg.extractMass + ' vs ' + round(c.beverage * tg.tds / 100, 4) + '（容差 ' + round(massTolFinal, 4) + '）');
      /* 容差同样按显示精度推：杯量 ÷ 粉重 里，杯量的 ±0.05 g 被粉重除会放大 1/粉重 倍，
         再加上粉重自身 2 位小数的 ±0.005。小剂量时这两项都不小，所以不能拍一个固定小数。 */
      const perGramTol = 0.05 / c.dose + 0.005 + 1e-9;
      t('每克粉的杯量 = 比例 − k', near(c.beverage / c.dose, result.input.ratio - result.input.k, perGramTol), round(c.beverage / c.dose, 4) + ' vs ' + round(result.input.ratio - result.input.k, 4) + '（容差 ' + round(perGramTol, 4) + '）');
      t('冗余字段 inverse.perGram 与实际口径一致', near(result.inverse.perGram.beverage, result.input.ratio - result.input.k, 0.0001)
        && near(result.inverse.perGram.water, result.input.ratio, 0.0001)
        && result.inverse.perGram.dose === 1, JSON.stringify(result.inverse.perGram));
      /* 反解用的是「显示杯量」（1 位小数，±0.05 g），除以 (R−k) 后误差被放大 1/(R−k) 倍。 */
      const invTol = 0.05 / (result.input.ratio - result.input.k) + 0.005 + 1e-9;
      const inv = result.inverse.forBeverage(c.beverage);
      t('反解粉重能还原目标杯量', !!inv && near(inv.dose, c.dose, invTol), (inv ? inv.dose : 'null') + ' vs ' + c.dose + '（容差 ' + round(invTol, 4) + '）');
      const pourTarget = c.iced ? c.hotWaterG : c.waterTotal;
      t('分段注水累计 = 注水目标（冰冲时是热水部分）', near(result.pours[result.pours.length - 1].cum, pourTarget, 0.11));
      t('分段注水之和 = 注水目标', near(result.pours.reduce(function (s, p) { return s + p.amount; }, 0), pourTarget, 0.35));
      t('冰冲：冰 + 热水 = 总注水', !c.iced || near(c.iceG + c.hotWaterG, c.waterTotal, 0.11));
      t('杯量为正', c.beverage > 0);
    } else {
      t('不可行时不给出杯量数字', !isFinite(c.beverage) || c.beverage <= 0 || c.waterTotal <= 0);
    }
    return ck;
  }

  return {
    VERSION: VERSION, VESSELS: VESSELS, VESSEL_BY_ID: VESSEL_BY_ID, GRINDS: GRINDS,
    GRIND_EY_PER_STEP: GRIND_EY_PER_STEP, CONST: CONST, LIMITS: LIMITS, TEMP_EY_PER_DEG: TEMP_EY_PER_DEG,
    FIELDS: FIELDS, TASTES: TASTES, DEFAULTS: DEFAULTS, SCENARIOS: SCENARIOS,
    defaults: defaults, scenarios: scenarios, normalizeInput: normalizeInput, validate: validate,
    compute: compute, runChecks: runChecks, pourSchedule: pourSchedule, vesselOf: vesselOf,
    grindLabel: grindLabel, round: round, clamp: clamp,
  };
});
