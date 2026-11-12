/* 一杯手冲的配比卡 · 界面层
 * 约定：所有数字都来自 AppCore.compute() 的同一次结果；界面自己不算任何数字（除了显示宽度）。
 * 四条历史教训照做：① 每个控件都有 id；② 监听器不把 event 对象当 override 传；
 * ③ 下载钩子绝不吞掉真正的下载动作；④ 格式化函数对 null/NaN 一律返回占位符。
 */
(function () {
  'use strict';
  const A = window.AppCore;
  const $ = function (id) { return document.getElementById(id); };
  const LS_KEY = 'pour-card.v1';

  const state = {
    input: A.defaults(),   /* 归一化后的输入：界面上显示的、与引擎一致的一份 */
    raw: A.defaults(),     /* 用户/控件里真正填的东西：用来让引擎判「这不是数字」 */
    result: null,
    savedAt: null,
    lastAction: '',
  };

  /* ─────────────── 控件初始化 ─────────────── */
  function fillStaticOptions() {
    const vs = $('vesselId');
    vs.innerHTML = '';
    A.VESSELS.forEach(function (v) {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.name;
      vs.appendChild(o);
    });
    const g = $('grindIdx');
    g.innerHTML = '';
    A.GRINDS.forEach(function (name, i) {
      const o = document.createElement('option');
      o.value = String(i); o.textContent = (i + 1) + '. ' + name;
      g.appendChild(o);
    });
    const t = $('taste');
    t.innerHTML = '';
    A.TASTES.forEach(function (x) {
      const o = document.createElement('option');
      o.value = x.id; o.textContent = x.label;
      t.appendChild(o);
    });
  }

  function applyInputToControls(inp) {
    $('vesselId').value = inp.vesselId;
    $('dose').value = inp.dose;
    $('ratio').value = inp.ratio;
    $('tempC').value = inp.tempC;
    $('grindIdx').value = String(inp.grindIdx);
    $('targetEy').value = inp.targetEy;
    $('iced').checked = !!inp.iced;
    $('iceFrac').value = Math.round((inp.iceFrac == null ? A.DEFAULTS.iceFrac : inp.iceFrac) * 100);
    $('measuredTds').value = (inp.measuredTds === null || inp.measuredTds === undefined) ? '' : inp.measuredTds;
    $('taste').value = inp.taste || '';
    $('iceWrap').hidden = !inp.iced;
    updateVesselNote();
  }

  function readControls() {
    return {
      vesselId: $('vesselId').value,
      dose: $('dose').value,
      ratio: $('ratio').value,
      tempC: $('tempC').value,
      grindIdx: $('grindIdx').value,
      targetEy: $('targetEy').value,
      iced: $('iced').checked,
      iceFrac: $('iceFrac').value === '' ? null : Number($('iceFrac').value) / 100,
      measuredTds: $('measuredTds').value === '' ? null : $('measuredTds').value,
      taste: $('taste').value,
    };
  }

  function updateVesselNote() {
    const v = A.vesselOf($('vesselId').value);
    $('vesselNote').textContent = v.name + '：每 1 g 粉会带走约 ' + v.k + ' g 水 —— ' + v.note + '。';
    $('iceWrap').hidden = !$('iced').checked;
  }

  /* ─────────────── 格式化（null/NaN 一律占位符） ─────────────── */
  function f1(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toFixed(1); }
  function f2(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toFixed(2); }
  function f3(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : Number(x).toFixed(3); }
  function f0(x) { return (x === null || x === undefined || !isFinite(x)) ? '—' : String(Math.round(x)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mmss(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  const EY_BAND_TXT = { under: '偏低（会偏酸偏薄）', balanced: '落在常用工作区间', over: '偏高（容易苦涩发干）' };
  const TDS_BAND_TXT = { light: '偏淡', ok: '正常带', strong: '偏浓' };

  /* ─────────────── 渲染 ─────────────── */
  function render() {
    /* 关键：把「用户原样填的东西」交给引擎，它才知道要报「粉重填的是 abc，不是数字」。
       如果把归一化后的值传进去，非法文本就已经被悄悄换成默认值了 —— 那是静默吞掉用户的输入。 */
    const r = A.compute(state.raw);
    state.result = r;
    /* 归一化那一份用来回填控件与后续比较，保证界面上显示的数 = 参与判定的数 */
    state.input = A.normalizeInput(r.input);
    renderMessages(r);
    renderCard(r);
    renderSaveState();
  }

  function renderMessages(r) {
    const eb = $('errBox'), wb = $('warnBox');
    if (r.errors.length) {
      eb.hidden = false;
      eb.innerHTML = '<div class="ttl">这个组合算不出来（' + r.errors.length + ' 条）</div><ul>' +
        r.errors.map(function (e) { return '<li>' + esc(e.msg) + '</li>'; }).join('') + '</ul>';
    } else { eb.hidden = true; eb.innerHTML = ''; }
    if (r.warnings.length) {
      wb.hidden = false;
      wb.innerHTML = '<div class="ttl">可以算，但有一点要先说（' + r.warnings.length + ' 条）</div><ul>' +
        r.warnings.map(function (w) { return '<li>' + esc(w.msg) + '</li>'; }).join('') + '</ul>';
    } else { wb.hidden = true; wb.innerHTML = ''; }
  }

  function renderCard(r) {
    const host = $('cardHost');
    if (!r.feasible) {
      /* 上方错误框已经把每条原因逐条列出来了，这里不再重复同一句话，
         也不要把所有失败都归因到「比例」—— 粉重越界、水温越界、填了非数字都会走到这里。 */
      const onlyRatio = r.errors.length > 0 && r.errors.every(function (e) { return e.field === 'ratio'; });
      const hint = onlyRatio
        ? '这个器具（' + esc(r.input.vesselName) + '，吸水系数 ' + esc(r.input.k) + ' g 水 / g 粉）在比例 ≤ 1 : ' + esc(r.input.k) +
          ' 时，粉会把水全部吸走，杯里什么都不剩。把比例调到大于 1 : ' + esc(r.input.k) + '，再回来看这张卡。'
        : '左边红框里列了具体原因（' + r.errors.length + ' 条）。改掉之后这张卡会自动出来 —— 你填的其它数值都还在，不用重填。';
      host.innerHTML =
        '<div class="receipt"><div class="rc-head"><p class="rc-title">配 比 卡</p>' +
        '<div class="stale"><b>这张卡先出不来。</b><br>' + hint + '</div></div></div>';
      return;
    }
    const c = r.card, tg = r.target;

    const big =
      '<div class="rc-big">' +
      '<div><div class="k">壶里要烧的水</div><div class="v">' + f1(c.waterTotal) + '<span class="u">g</span></div></div>' +
      '<div><div class="k">杯里会得到</div><div class="v">' + f1(c.beverage) + '<span class="u">g</span></div></div>' +
      '<div><div class="k">被粉留住</div><div class="v">' + f1(c.waterRetained) + '<span class="u">g</span></div></div>' +
      '</div>';

    const head =
      '<div class="rc-head">' +
      '<p class="rc-title">配 比 卡</p>' +
      big +
      '<div class="rc-note">' + f1(c.dose) + ' g 粉 ｜ 比例 ' + esc(c.ratioText) + ' ｜ ' + esc(c.tempC) + ' °C ｜ 研磨 ' +
      esc(c.grindLabel) + (c.iced ? ' ｜ 冰手冲：冰 ' + f1(c.iceG) + ' g + 热水 ' + f1(c.hotWaterG) + ' g' : '') + '</div>' +
      '</div>';

    /* 注水时刻表 */
    const rows = r.pours.map(function (p) {
      const amt = p.amount > 0 ? f1(p.amount) + ' g' : '—';
      return '<tr>' +
        '<td class="t-right mono nowrap">' + mmss(p.startSec) + '–' + mmss(p.endSec) + '</td>' +
        '<td><div class="stepname"><span class="num-badge">' + p.idx + '</span>' + esc(p.label) + '</div>' +
        '<div class="stepnote">' + esc(p.note) + '</div></td>' +
        '<td class="t-right mono nowrap">' + amt + '</td>' +
        '<td class="t-right mono nowrap">' + f1(p.cum) + ' g</td>' +
        '</tr>';
    }).join('');
    const steps =
      '<div class="rc-sec"><h3>注水时刻表</h3>' +
      '<table class="steps"><thead><tr><th>时刻</th><th>这一段做什么</th><th class="t-right">加水</th><th class="t-right">累计</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="rc-note">目标总时长约 ' + mmss(r.pours[r.pours.length - 1].endSec) + '。时刻是给手快的参考，不是必须踩点。</div>' +
      '</div>';

    /* 这一杯的数字 */
    const nums =
      '<div class="rc-sec"><h3>这一杯的数字</h3>' +
      '<dl class="kv">' +
      '<dt>目标萃取率</dt><dd>' + f2(tg.ey) + ' %</dd>' +
      '<dt>对应杯里浓度</dt><dd>' + f2(tg.tds) + ' %</dd>' +
      '<dt>被萃取出的可溶物</dt><dd>' + f3(tg.extractMass) + ' g</dd>' +
      '<dt>每 1 g 粉出液</dt><dd>' + f2(c.beverage / c.dose) + ' g</dd>' +
      '<dt>折算</dt><dd class="txt">' + cupTargetText(r) + '</dd>' +
      '</dl>' +
      '<div class="bandrow">' +
      '<span class="band ' + esc(tg.eyBand) + '">萃取率：' + esc(EY_BAND_TXT[tg.eyBand]) + '</span>' +
      '<span class="band ' + esc(tg.tdsBand) + '">浓度：' + esc(TDS_BAND_TXT[tg.tdsBand]) + '</span>' +
      '<span class="band">常用区间 ' + tg.eyBalanced[0] + '–' + tg.eyBalanced[1] + ' % ／ 浓度 ' + tg.tdsRange[0] + '–' + tg.tdsRange[1] + ' %</span>' +
      '</div>' +
      '</div>';

    /* 校准与下一杯 */
    let calib;
    if (r.diag.measured === null && !r.diag.tasteAdvice) {
      calib = '<div class="rc-sec"><h3>校准：下一杯怎么改</h3>' +
        '<p class="why" style="font-size:12.5px;color:var(--ink2);line-height:1.6">' +
        '这一栏空着。要么在左边填一个实测 TDS（有折光仪才算），要么选一句你喝到的味道 —— ' +
        '本工具不会凭空猜你的口感。</p></div>';
    } else {
      let html = '<div class="rc-sec"><h3>校准：下一杯怎么改</h3>';
      if (r.diag.measured) {
        html += '<dl class="kv" style="margin-bottom:9px">' +
          '<dt>实测 TDS</dt><dd>' + f2(r.diag.measured.tds) + ' %</dd>' +
          '<dt>反推萃取率</dt><dd>' + f2(r.diag.measured.ey) + ' %</dd>' +
          '<dt>与目标差</dt><dd>' + (r.diag.measured.ey >= tg.ey ? '+' : '') + f2(r.diag.measured.ey - tg.ey) + ' 个百分点</dd>' +
          '</dl>' +
          '<div class="bandrow" style="margin-bottom:9px">' +
          '<span class="band ' + esc(r.diag.measured.eyBand) + '">萃取率：' + esc(EY_BAND_TXT[r.diag.measured.eyBand]) + '</span>' +
          '<span class="band ' + esc(r.diag.measured.tdsBand) + '">浓度：' + esc(TDS_BAND_TXT[r.diag.measured.tdsBand]) + '</span>' +
          '</div>';
        const a = r.diag.tdsAdvice;
        html += '<div class="diag"><div class="verdict">按实测：' + esc(a.text) + '</div>' +
          '<div class="why">' + esc(a.howMuch) + '</div>';
        if (a.notes && a.notes.length) html += '<div class="aside-note">' + a.notes.map(esc).join('；') + '</div>';
        html += '<ul class="actions">' + actionButtons([
          { lever: 'grind', delta: a.grindSteps, text: '按这个改研磨：' + esc(a.grindLabelNow) + ' → ' + esc(a.grindLabelNext) },
          { lever: 'temp', delta: a.tempDelta, text: a.tempDelta ? '水温 ' + (a.tempDelta > 0 ? '+' : '−') + A.CONST.tempStepDegC + ' °C' : '水温不动' },
        ]) + '</ul></div>';
      }
      const ta = r.diag.tasteAdvice;
      if (ta) {
        if (r.diag.measuredChain) { /* 占位，见下 */ }
        html += '<div class="diag" style="margin-top:' + (r.diag.measured ? '14px' : '0') + '">' +
          '<div class="verdict">按味道：' + esc(ta.verdict) + '</div>' +
          '<div class="why">' + esc(ta.why) + '</div>' +
          '<div class="aside-note">判据：' + esc(ta.basedOn) + '</div>' +
          '<ul class="actions">' + actionButtons(ta.steps) + '</ul>' +
          (ta.notes && ta.notes.length ? '<div class="aside-note">' + ta.notes.map(esc).join('；') + '</div>' : '') +
          (r.diag.measured
            ? '<div class="aside-note"><b>两条路都填了时以实测为准</b>：上面「按实测」的档数是根据你这杯测出来的数字算的；「按味道」只是你没带折光仪时的替代判断。两条不一致时，先按实测调，味道那条不要同时叠加。</div>'
            : '') +
          '</div>';
      }
      html += '<div class="aside-note">每细 1 档约 +' + A.GRIND_EY_PER_STEP.toFixed(1) +
        ' 个百分点萃取率、一次调温 ' + A.CONST.tempStepDegC + ' °C 约 ' + A.CONST.tempStepEy +
        ' 个百分点 —— 都是本工具声明的量级换算，实际取决于你的磨豆机和水壶。</div>';
      html += '</div>';
      calib = html;
    }

    /* 边界 */
    const bounds = '<div class="rc-sec"><h3>这张卡有多少可信度</h3><div class="bounds"><ul>' +
      r.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
      '<li>本工具<b>不</b>预测口感、<b>不</b>评价豆子、<b>不</b>处理水质；意式只给参考系数，不做流速与压粉诊断。</li>' +
      '<li>平衡区间与浓度区间是「常用工作区间」，本工具在 2026-11-13 这一轮<b>没取得可引用的一手来源</b>，请当成参考带而不是合格线。</li>' +
      '<li>默认场景（中烘水洗豆、V60、15 g）是<b>虚构示例</b>，不是实测数据、也不代表任何真实用户分布。</li>' +
      '<li>不校验你的秤、温度计、折光仪是否校准；你填进来的实测值被当作已校准数据使用。</li>' +
      '</ul></div></div>';

    host.innerHTML = '<div class="receipt">' + head + steps + nums + calib + bounds + '</div>';
    bindActionButtons();
  }

  function cupTargetText(r) {
    return '每 1 g 粉出 ' + f2(r.card.beverage / r.card.dose) + ' g 液；想要别的杯量，按这个倍数折粉重';
  }

  function actionButtons(steps) {
    const out = [];
    (steps || []).forEach(function (s, i) {
      const d = Number(s.delta) || 0;
      const inert = (s.lever === 'temp' && d === 0) || (s.lever === 'grind' && d === 0);
      if (s.lever === 'pour') {
        out.push('<li class="act-item"><button type="button" class="actbtn" disabled style="opacity:.72;cursor:default">' + esc(s.text) + '（手法，无法一键应用）</button></li>');
        return;
      }
      if (inert && s.lever === 'temp' && s.text.indexOf('不动') < 0) {
        out.push('<li class="act-item"><button type="button" class="actbtn" disabled style="opacity:.72;cursor:default">' + esc(s.text) + '（已到边界，不作改动）</button></li>');
        return;
      }
      if (s.lever === 'grind' && d === 0) return;
      if (s.lever === 'temp' && d === 0) return;
      out.push('<li class="act-item"><button type="button" class="actbtn" data-lever="' + esc(s.lever) + '" data-delta="' + d + '">' +
        '<span class="go">点这里应用</span> · ' + esc(s.text) + '</button></li>');
    });
    return out.join('');
  }

  function bindActionButtons() {
    Array.prototype.forEach.call(document.querySelectorAll('#cardHost button.actbtn:not([disabled])'), function (b) {
      b.addEventListener('click', function () {
        const lever = b.getAttribute('data-lever');
        const delta = Number(b.getAttribute('data-delta'));
        applyChange(lever, delta);
      });
    });
  }

  /* 建议能作用于输入：点了就真的改掉输入并立刻重算 */
  function applyChange(lever, delta) {
    /* 以引擎归一化后的输入为准（state.input 与 state.result.input 必须是同一口径） */
    state.input = A.normalizeInput(state.input);
    state.raw = Object.assign({}, state.input);
    if (lever === 'grind') {
      const next = Math.max(0, Math.min(A.GRINDS.length - 1, state.input.grindIdx + Math.round(delta)));
      if (next === state.input.grindIdx) { toast('已经在这一档边界上了'); return; }
      state.input.grindIdx = next;
      state.lastAction = '研磨改到「' + A.grindLabel(next) + '」，已重算。';
    } else if (lever === 'temp') {
      const step = A.CONST.tempStepDegC;
      const next = Math.max(A.LIMITS.temp.min, Math.min(A.LIMITS.temp.max, Math.round(state.input.tempC + delta * step)));
      state.input.tempC = next;
      state.lastAction = '水温改到 ' + next + ' °C，已重算。';
    } else if (lever === 'ratio') {
      const next = A.round(state.input.ratio + delta * A.CONST.ratioStep, 2);
      state.input.ratio = next;
      state.lastAction = '比例改到 1 : ' + next + '，已重算。';
    } else {
      return;
    }
    /* 顺序很重要：先把新值写回控件，再让它成为 state.raw，最后才 render。
       如果先 render，render 会拿旧的 state.raw 重算，把刚点上来的改动又盖回去。 */
    applyInputToControls(state.input);
    state.raw = Object.assign({}, state.input);
    render();
    toast(state.lastAction);
  }

  /* ─────────────── 事件绑定 ─────────────── */
  function onFieldChange() {
    /* 改任何字段都清掉上一句动作提示，避免提示与当前输入不一致 */
    state.lastAction = '';
    state.raw = readControls();
    render();
  }

  function bind() {
    ['dose', 'ratio', 'tempC', 'targetEy', 'measuredTds', 'iceFrac'].forEach(function (id) {
      const el = $(id);
      el.addEventListener('input', onFieldChange);
      el.addEventListener('change', onFieldChange);
    });
    ['vesselId', 'grindIdx', 'taste'].forEach(function (id) {
      $(id).addEventListener('change', onFieldChange);
    });
    $('iced').addEventListener('change', function () {
      $('iceWrap').hidden = !$('iced').checked;
      onFieldChange();
    });
    $('vesselId').addEventListener('change', function () {
      const v = A.vesselOf($('vesselId').value);
      /* 器具换了以后，原来那个比例可能算不出咖啡液；不自动改用户的数，只如实报警 */
      updateVesselNote();
      if (v) { /* 注释保留：这里刻意不做「自动纠正」，以免偷偷改掉用户输入 */ }
      onFieldChange();
    });
    $('saveBtn').addEventListener('click', saveLocal);
    $('resetBtn').addEventListener('click', function () {
      state.raw = A.defaults();
      state.lastAction = '';
      render();
      applyInputToControls(state.input);
      toast('已恢复默认场景');
    });
    $('dlCsv').addEventListener('click', function () { downloadCsv(); });
    $('dlMd').addEventListener('click', function () { downloadMd(); });
    $('dlPng').addEventListener('click', function () { downloadPng(); });
    $('dlJson').addEventListener('click', function () { downloadJson(); });

    const pv = $('presets');
    pv.innerHTML = '';
    A.scenarios().forEach(function (s) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s.name;
      b.addEventListener('click', function () {
        state.raw = Object.assign(A.defaults(), s.input);
        state.lastAction = '已套用场景：' + s.name + '。';
        render();
        applyInputToControls(state.input);
        toast(state.lastAction);
      });
      pv.appendChild(b);
    });
  }

  /* ─────────────── 本机保存与恢复 ─────────────── */
  function saveLocal() {
    try {
      state.savedAt = new Date().toISOString();
      localStorage.setItem(LS_KEY, JSON.stringify({ input: state.input, savedAt: state.savedAt }));  /* 存归一化后的那一份 */
      renderSaveState();
      toast('已保存到本机，刷新后会自动恢复');
    } catch (e) {
      toast('保存失败：' + (e && e.message ? e.message : '本机存储不可用'));
    }
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || !o.input) return false;
      state.input = A.normalizeInput(o.input);
      state.raw = Object.assign({}, state.input);
      state.savedAt = o.savedAt || null;
      return true;
    } catch (e) { return false; }
  }
  function renderSaveState() {
    const el = $('saveState');
    if (!el) return;
    const bits = [];
    if (state.savedAt) bits.push('本机存档：' + state.savedAt.replace('T', ' ').slice(0, 19));
    if (state.lastAction) bits.push(state.lastAction);
    el.textContent = bits.join(' ｜ ');
  }

  /* ─────────────── 四种导出 ─────────────── */
  function fileStamp() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function triggerDownload(blob, filename) {
    /* 注意：这里绝对不能 return —— 批次 59 曾因为钩子里写了 return 把真正的下载动作吞掉，
       blob 尺寸对得上但磁盘上什么都没有。必须真的走 a.click()。 */
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  function csvText(r) {
    const c = r.card, tg = r.target;
    const L = [];
    L.push('# 一杯手冲的配比卡 · 导出');
    L.push('# 导出时间,' + new Date().toISOString());
    L.push('# 说明,默认场景是虚构示例；所有数字来自同一次引擎计算');
    L.push('分区,项目,数值,单位');
    function row(sec, k, v, u) { L.push([sec, k, v, u || ''].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(',')); }
    row('输入', '器具', r.input.vesselName, '');
    row('输入', '吸水留存系数 k', r.input.k, 'g水/g粉');
    row('输入', '粉重', c.dose, 'g');
    row('输入', '粉水比', '1 : ' + r.input.ratio, '');
    row('输入', '水温', c.tempC, '°C');
    row('输入', '研磨档', c.grindLabel, '');
    row('输入', '目标萃取率', tg.ey, '%');
    row('输入', '冰手冲', c.iced ? '是' : '否', '');
    if (c.iced) { row('输入', '冰占比', r.input.iceFrac, ''); row('输入', '冰', c.iceG, 'g'); row('输入', '热水', c.hotWaterG, 'g'); }
    row('结果', '壶里总注水量', c.waterTotal, 'g');
    row('结果', '被粉留住的水', c.waterRetained, 'g');
    row('结果', '杯里液重', c.beverage, 'g');
    row('结果', '对应浓度 TDS', tg.tds, '%');
    row('结果', '被萃取出的可溶物', tg.extractMass, 'g');
    row('结果', '每 1 g 粉出液', Math.round(c.beverage / c.dose * 10000) / 10000, 'g');
    r.pours.forEach(function (p) {
      row('注水段 ' + p.idx, p.label + '（' + mmss(p.startSec) + '–' + mmss(p.endSec) + '）', p.amount, 'g');
      row('注水段 ' + p.idx, p.label + ' 累计', p.cum, 'g');
    });
    if (r.diag.measured) {
      row('校准', '实测 TDS', r.diag.measured.tds, '%');
      row('校准', '反推萃取率', r.diag.measured.ey, '%');
    }
    if (r.diag.tasteAdvice) {
      row('校准', '味觉判定', r.diag.tasteAdvice.verdict, '');
      r.diag.tasteAdvice.steps.forEach(function (s, i) { row('校准', '动作 ' + (i + 1), s.text, ''); });
    }
    r.warnings.forEach(function (w, i) { row('提示 ' + (i + 1), w.code, w.msg, ''); });
    r.notes.forEach(function (n, i) { row('边界 ' + (i + 1), 'note', n, ''); });
    return L.join('\r\n') + '\r\n';
  }

  function mdText(r) {
    const c = r.card, tg = r.target;
    const L = [];
    L.push('# 一杯手冲的配比卡');
    L.push('');
    L.push('> 导出时间：' + new Date().toISOString() + '　（默认场景是虚构示例；以下数字来自同一次引擎计算）');
    L.push('');
    L.push('## 一句话');
    L.push('');
    L.push('**' + f1(c.dose) + ' g 粉，壶里烧 ' + f1(c.waterTotal) + ' g 水，杯里得到 ' + f1(c.beverage) +
      ' g**（' + f1(c.waterRetained) + ' g 水被粉留住），比例 ' + c.ratioText + '，' + c.tempC + ' °C，研磨 ' + c.grindLabel + '。');
    L.push('');
    L.push('## 注水时刻表');
    L.push('');
    L.push('| 时刻 | 这一段做什么 | 加水 | 累计 |');
    L.push('|---|---|---|---|');
    r.pours.forEach(function (p) {
      L.push('| ' + mmss(p.startSec) + '–' + mmss(p.endSec) + ' | ' + p.idx + '. ' + p.label + '　' + p.note.replace(/\|/g, '\\|') + ' | ' +
        (p.amount > 0 ? f1(p.amount) + ' g' : '—') + ' | ' + f1(p.cum) + ' g |');
    });
    L.push('');
    L.push('## 这一杯的数字');
    L.push('');
    L.push('| 项目 | 数值 |');
    L.push('|---|---|');
    L.push('| 目标萃取率 | ' + f2(tg.ey) + ' % |');
    L.push('| 对应杯里浓度 | ' + f2(tg.tds) + ' % |');
    L.push('| 被萃取出的可溶物 | ' + f3(tg.extractMass) + ' g |');
    L.push('| 每 1 g 粉出液 | ' + f2(c.beverage / c.dose) + ' g |');
    L.push('| 萃取率判定 | ' + EY_BAND_TXT[tg.eyBand] + ' |');
    L.push('| 浓度判定 | ' + TDS_BAND_TXT[tg.tdsBand] + ' |');
    if (c.iced) {
      L.push('| 冰 | ' + f1(c.iceG) + ' g |');
      L.push('| 热水 | ' + f1(c.hotWaterG) + ' g |');
    }
    L.push('');
    if (r.diag.measured) {
      L.push('## 校准（实测）');
      L.push('');
      L.push('- 实测 TDS ' + f2(r.diag.measured.tds) + ' % → 反推萃取率 ' + f2(r.diag.measured.ey) + ' %（与目标差 ' +
        f2(r.diag.measured.ey - tg.ey) + ' 个百分点）');
      L.push('- ' + r.diag.tdsAdvice.text);
      L.push('- ' + r.diag.tdsAdvice.howMuch);
      L.push('');
    }
    if (r.diag.tasteAdvice) {
      L.push('## 校准（味觉）');
      L.push('');
      L.push('- 判定：**' + r.diag.tasteAdvice.verdict + '**');
      L.push('- 为什么：' + r.diag.tasteAdvice.why);
      r.diag.tasteAdvice.steps.forEach(function (s) { L.push('- 动作：' + s.text); });
      L.push('- 判据：' + r.diag.tasteAdvice.basedOn);
      L.push('');
    }
    if (r.warnings.length) {
      L.push('## 提示');
      L.push('');
      r.warnings.forEach(function (w) { L.push('- ' + w.msg); });
      L.push('');
    }
    L.push('## 这张卡有多少可信度');
    L.push('');
    r.notes.forEach(function (n) { L.push('- ' + n); });
    L.push('- 本工具不预测口感、不评价豆子、不处理水质；意式只给参考系数。');
    L.push('- 平衡区间与浓度区间是「常用工作区间」，本轮未取得可引用一手来源，请当参考带而不是合格线。');
    L.push('- 默认场景是虚构示例，不是实测数据，也不代表任何真实用户分布。');
    return L.join('\n') + '\n';
  }

  function jsonText(r) {
    return JSON.stringify({
      app: '一杯手冲的配比卡', version: r.version, exportedAt: new Date().toISOString(),
      savedAt: state.savedAt, input: r.input, card: r.card, target: r.target, pours: r.pours,
      diag: { measured: r.diag.measured, tdsAdvice: r.diag.tdsAdvice, tasteAdvice: r.diag.tasteAdvice },
      warnings: r.warnings, notes: r.notes, checks: A.runChecks(r),
    }, null, 2) + '\n';
  }

  function downloadCsv() {
    const r = state.result || A.compute(state.input);
    triggerDownload(new Blob([csvText(r)], { type: 'text/csv;charset=utf-8' }), 'pour-card-' + fileStamp() + '.csv');
    toast('已导出 CSV');
  }
  function downloadMd() {
    const r = state.result || A.compute(state.input);
    triggerDownload(new Blob([mdText(r)], { type: 'text/markdown;charset=utf-8' }), 'pour-card-' + fileStamp() + '.md');
    toast('已导出 Markdown');
  }
  function downloadJson() {
    const r = state.result || A.compute(state.input);
    triggerDownload(new Blob([jsonText(r)], { type: 'application/json;charset=utf-8' }), 'pour-card-' + fileStamp() + '.json');
    toast('已导出 JSON 备份');
  }

  /* 结果卡 PNG：1080×1350，画布上画的是同一次 r 的数字 */
  function drawCard(r) {
    const cv = $('pngCanvas');
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const c = r.card, tg = r.target;
    g.fillStyle = '#fbf8f3'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fffdf9'; g.fillRect(48, 48, W - 96, H - 96);
    g.strokeStyle = '#ded5c9'; g.lineWidth = 2; g.strokeRect(48, 48, W - 96, H - 96);
    g.textBaseline = 'top';
    function font(size, bold) { g.font = (bold ? '700 ' : '400 ') + size + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif'; }
    function mono(size, bold) { g.font = (bold ? '700 ' : '400 ') + size + 'px ui-monospace,Menlo,Consolas,monospace'; }

    g.fillStyle = '#6b6158'; font(30, false);
    g.fillText('一 杯 手 冲 的 配 比 卡', 92, 92);
    g.fillStyle = '#938a80'; font(20, false);
    g.fillText('壶里烧多少水 · 杯里得多少克 · 下一杯改哪一格', 92, 138);

    g.strokeStyle = '#efe8dd'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(92, 182); g.lineTo(W - 92, 182); g.stroke();

    /* 三个大数 */
    const bigs = [
      ['壶里要烧的水', f1(c.waterTotal) + ' g'],
      ['杯里会得到', f1(c.beverage) + ' g'],
      ['被粉留住', f1(c.waterRetained) + ' g'],
    ];
    bigs.forEach(function (b, i) {
      const x = 92 + i * 300;
      g.fillStyle = '#938a80'; font(20, false); g.fillText(b[0], x, 210);
      g.fillStyle = '#2b2622'; mono(44, true); g.fillText(b[1], x, 240);
    });

    g.fillStyle = '#6b6158'; font(21, false);
    g.fillText(f1(c.dose) + ' g 粉 ｜ 比例 ' + c.ratioText + ' ｜ ' + c.tempC + ' °C ｜ 研磨 ' + c.grindLabel, 92, 306);
    if (c.iced) g.fillText('冰手冲：冰 ' + f1(c.iceG) + ' g + 热水 ' + f1(c.hotWaterG) + ' g', 92, 338);

    g.beginPath(); g.moveTo(92, 380); g.lineTo(W - 92, 380); g.stroke();

    /* 注水表 */
    g.fillStyle = '#6b6158'; font(20, true); g.fillText('注水时刻表', 92, 404);
    let y = 444;
    g.fillStyle = '#938a80'; font(17, false);
    g.fillText('时刻', 92, y); g.fillText('这一段', 300, y);
    g.textAlign = 'right'; g.fillText('加水', W - 200, y); g.fillText('累计', W - 92, y); g.textAlign = 'left';
    y += 30;
    g.strokeStyle = '#efe8dd'; g.beginPath(); g.moveTo(92, y); g.lineTo(W - 92, y); g.stroke();
    y += 14;
    r.pours.forEach(function (p) {
      g.fillStyle = '#2b2622'; mono(21, false);
      g.fillText(mmss(p.startSec) + '-' + mmss(p.endSec), 92, y);
      font(21, false); g.fillText(p.idx + '. ' + p.label, 300, y);
      mono(21, false);
      g.textAlign = 'right';
      g.fillText(p.amount > 0 ? f1(p.amount) + ' g' : '—', W - 200, y);
      g.fillText(f1(p.cum) + ' g', W - 92, y);
      g.textAlign = 'left';
      y += 36;
    });

    y += 10;
    g.strokeStyle = '#efe8dd'; g.beginPath(); g.moveTo(92, y); g.lineTo(W - 92, y); g.stroke();
    y += 22;
    g.fillStyle = '#6b6158'; font(20, true); g.fillText('这一杯的数字', 92, y);
    y += 40;
    const kv = [
      ['目标萃取率', f2(tg.ey) + ' %'],
      ['对应杯里浓度', f2(tg.tds) + ' %'],
      ['被萃取出的可溶物', f3(tg.extractMass) + ' g'],
      ['每 1 g 粉出液', f2(c.beverage / c.dose) + ' g'],
      ['萃取率判定', EY_BAND_TXT[tg.eyBand]],
      ['浓度判定', TDS_BAND_TXT[tg.tdsBand]],
    ];
    kv.forEach(function (row) {
      g.fillStyle = '#938a80'; font(20, false); g.fillText(row[0], 92, y);
      g.fillStyle = '#2b2622'; mono(21, false); g.fillText(row[1], 470, y);
      y += 34;
    });

    /* 校准一句 */
    y += 14;
    g.strokeStyle = '#efe8dd'; g.beginPath(); g.moveTo(92, y); g.lineTo(W - 92, y); g.stroke();
    y += 22;
    g.fillStyle = '#6b6158'; font(20, true); g.fillText('下一杯怎么改', 92, y);
    y += 38;
    g.fillStyle = '#2b2622';
    const advice = (r.diag.tdsAdvice && r.diag.tdsAdvice.text) ||
      (r.diag.tasteAdvice && (r.diag.tasteAdvice.verdict + '：' + r.diag.tasteAdvice.steps.map(function (s) { return s.text; }).join('；'))) ||
      '没填实测 TDS 也没选味觉 —— 本工具不凭空猜你的口感。';
    font(21, false);
    wrapText(g, advice, 92, y, W - 184, 32);

    /* 页脚边界 */
    g.fillStyle = '#938a80'; font(16, false);
    const foot = [
      '经验值与设计选择，不是精确物理常数；平衡区间是常用工作区间，本轮未取得可引用一手来源。',
      '默认场景（中烘水洗豆 15 g / V60）是虚构示例，不是实测数据。不预测口感、不评价豆子、不处理水质。',
      '导出时间 ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    ];
    let fy = H - 132;
    foot.forEach(function (t) { wrapText(g, t, 92, fy, W - 184, 24); fy += 42; });
  }
  function wrapText(g, text, x, y, maxW, lh) {
    const chars = String(text).split('');
    let line = '';
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, y); y += lh; line = chars[i];
      } else { line = test; }
    }
    if (line) g.fillText(line, x, y);
    return y + lh;
  }
  function downloadPng() {
    const r = state.result || A.compute(state.input);
    drawCard(r);
    const cv = $('pngCanvas');
    /* toBlob 可能为 null（画布被污染等）；那时明确报错，不假装成功 */
    cv.toBlob(function (blob) {
      if (!blob) { toast('导出 PNG 失败：画布无法生成图片'); return; }
      triggerDownload(blob, 'pour-card-结果卡-' + fileStamp() + '.png');
      toast('已导出结果卡 PNG（1080×1350）');
    }, 'image/png');
  }

  /* ─────────────── toast ─────────────── */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  /* ─────────────── 启动 ─────────────── */
  function boot() {
    fillStaticOptions();
    const restored = loadLocal();
    applyInputToControls(state.input);
    bind();
    render();
    if (restored) toast('已从本机存档恢复上次的输入');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 供自动化验收使用：只读暴露，不改变行为 */
  window.PourCardUI = {
    state: state,
    get raw() { return state.raw; },
    render: render,
    read: function () { return state.result; },
    setInput: function (patch) {
      state.raw = Object.assign({}, state.input, patch);
      render();
      applyInputToControls(state.input);
    },
    texts: { csv: function () { return csvText(state.result || A.compute(state.input)); }, md: function () { return mdText(state.result || A.compute(state.input)); }, json: function () { return jsonText(state.result || A.compute(state.input)); } },
    saveLocal: saveLocal, loadLocal: loadLocal, drawCard: drawCard,
  };
})();
