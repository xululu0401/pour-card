#!/usr/bin/env node
/* 封面：1200×1200，取值全部来自同一次引擎运行，并落盘 evidence/封面取值.json。
   用法：node make-cover.cjs
 */
'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const AB = '/Users/xululu/.workbuddy/binaries/node/versions/22.22.2-6/bin/agent-browser';
const PROFILE = '/Users/xululu/.agent-browser/zhihu-profile';
const SESSION = 'codex61-cover';
const OUT = path.join(__dirname, 'cover.png');
const RAW = path.join(__dirname, '..', 'evidence', '封面-原始截图.png');
const HTML = path.join(__dirname, '..', 'evidence', '封面临时.html');
const PY = '/Users/xululu/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3';
const A = require('./core.js');

const r = A.compute(A.defaults());
const vals = {
  doseG: r.card.dose, waterTotalG: r.card.waterTotal, beverageG: r.card.beverage,
  waterRetainedG: r.card.waterRetained, tempC: r.card.tempC, grindLabel: r.card.grindLabel,
  ratioText: r.card.ratioText, targetEy: r.target.ey, targetTds: r.target.tds,
  extractMass: r.target.extractMass, perGram: Math.round(r.card.beverage / r.card.dose * 100) / 100,
  pours: r.pours.map(function (p) { return { idx: p.idx, label: p.label, amount: p.amount, cum: p.cum, startSec: p.startSec, endSec: p.endSec }; }),
  f1: function (x) { return Number(x).toFixed(1); },
  f2: function (x) { return Number(x).toFixed(2); },
  f3: function (x) { return Number(x).toFixed(3); },
  mmss: function (sec) { const s = Math.round(sec); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
};
fs.writeFileSync(path.join(__dirname, '..', 'evidence', '封面取值.json'), JSON.stringify({
  note: '以下每个数字都来自这一次 AppCore.compute(AppCore.defaults()) 的运行结果',
  input: r.input, card: r.card, target: r.target, pours: r.pours,
}, null, 2) + '\n');

const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1200px;height:1200px;background:#fbf8f3;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#2b2622;overflow:hidden}
  .card{position:absolute;inset:40px;background:#fffdf9;border:2px solid #ded5c9;border-radius:6px;padding:52px 56px}
  .kicker{font-size:22px;letter-spacing:10px;color:#938a80}
  h1{font-size:62px;letter-spacing:2px;margin:14px 0 10px;line-height:1.15}
  .sub{font-size:25px;color:#6b6158;line-height:1.5}
  .rule{height:2px;background:#efe8dd;margin:36px 0 30px}
  .big{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .big .k{font-size:20px;color:#938a80;margin-bottom:8px}
  .big .v{font-family:ui-monospace,Menlo,monospace;font-size:52px;font-weight:700;letter-spacing:-1.5px}
  .big .u{font-size:22px;color:#6b6158;font-weight:400;margin-left:3px;font-family:inherit}
  .meta{font-size:23px;color:#6b6158;margin-top:26px}
  .steps{margin-top:30px}
  .steps h2{font-size:21px;color:#6b6158;letter-spacing:2px;margin-bottom:16px;font-weight:600}
  table{width:100%;border-collapse:collapse;font-size:22px}
  th{text-align:left;color:#938a80;font-weight:500;font-size:18px;padding:0 0 8px;border-bottom:1px solid #efe8dd}
  td{padding:12px 0;border-bottom:1px solid #efe8dd}
  td.t{font-family:ui-monospace,Menlo,monospace;color:#6b6158;white-space:nowrap}
  td.r{text-align:right;font-family:ui-monospace,Menlo,monospace;white-space:nowrap}
  .foot{margin-top:30px;font-size:19px;color:#938a80;line-height:1.55}
  .badge{display:inline-block;margin-top:18px;font-size:20px;padding:7px 16px;border:1px solid #ded5c9;border-radius:22px;color:#6b6158}
</style></head><body><div class="card">
  <div class="kicker">配 比 卡</div>
  <h1>一杯手冲的配比卡</h1>
  <div class="sub">壶里烧多少水 · 杯里得多少克 · 下一杯改哪一格</div>
  <div class="rule"></div>
  <div class="big">
    <div><div class="k">壶里要烧的水</div><div class="v">${vals.f1(vals.waterTotalG)}<span class="u">g</span></div></div>
    <div><div class="k">杯里会得到</div><div class="v">${vals.f1(vals.beverageG)}<span class="u">g</span></div></div>
    <div><div class="k">被粉留住</div><div class="v">${vals.f1(vals.waterRetainedG)}<span class="u">g</span></div></div>
  </div>
  <div class="meta">${vals.f1(vals.doseG)} g 粉 ｜ ${vals.ratioText} ｜ ${vals.tempC} °C ｜ ${vals.grindLabel}</div>
  <div class="steps">
    <h2>注 水 时 刻 表</h2>
    <table>
      <tr><th>时刻</th><th>这一段做什么</th><th style="text-align:right">加水</th><th style="text-align:right">累计</th></tr>
      ${vals.pours.map(function (p) {
        return '<tr><td class="t">' + vals.mmss(p.startSec) + '–' + vals.mmss(p.endSec) + '</td><td>' + p.idx + '. ' + p.label + '</td>' +
          '<td class="r">' + (p.amount > 0 ? vals.f1(p.amount) + ' g' : '—') + '</td><td class="r">' + vals.f1(p.cum) + ' g</td></tr>';
      }).join('')}
    </table>
  </div>
  <div class="badge">目标萃取率 ${vals.f2(vals.targetEy)} % ｜ 杯里浓度 ${vals.f2(vals.targetTds)} % ｜ 可溶物 ${vals.f3(vals.extractMass)} g</div>
  <div class="foot">按吸水留存 2 g 水 / g 粉算 —— 这是经验值与本工具的显式声明，不是精确物理常数。<br>
  封面上的每个数字都来自同一次计算；默认场景是虚构示例，不是实测数据。</div>
</div></body></html>`;
fs.writeFileSync(HTML, html);

(async function () {
  try { execFileSync(AB, ['close', '--all'], { encoding: 'utf8', timeout: 60000 }); } catch (e) { /* ignore */ }
  await new Promise((r) => setTimeout(r, 700));
  execFileSync(AB, ['--profile', PROFILE, '--session', SESSION, 'open', 'file://' + HTML], { encoding: 'utf8', timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1200));
  execFileSync(AB, ['--session', SESSION, 'set', 'viewport', '1200', '1200'], { encoding: 'utf8', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 500));
  const dims = execFileSync(AB, ['--session', SESSION, 'eval', 'JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight})'], { encoding: 'utf8' }).trim().split('\n').pop();
  console.log('画布尺寸：' + dims);
  execFileSync(AB, ['--session', SESSION, 'screenshot', RAW], { encoding: 'utf8', timeout: 180000 });
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(RAW)})
print("原始截图", im.size)
im = im.convert("RGB")
if im.size != (1200,1200):
    im = im.crop((0,0,min(1200,im.width),min(1200,im.height)))
im.save(${JSON.stringify(OUT)}, "PNG")
print("封面", im.size, ${JSON.stringify(OUT)})
`;
  console.log(execFileSync(PY, ['-c', py], { encoding: 'utf8' }).trim());
  execFileSync(AB, ['--session', SESSION, 'close'], { encoding: 'utf8', timeout: 60000 });
  console.log('取数已落盘 evidence/封面取值.json');
})().catch((e) => { console.error(e.stack); process.exit(1); });
