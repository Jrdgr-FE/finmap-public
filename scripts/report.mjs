#!/usr/bin/env node
/**
 * 数据覆盖报告。
 *   node scripts/report.mjs
 *
 * 除了打印各分类/类型的家数，还会拿 data/roster-reference.json
 * （从监管总局《银行业金融机构法人名单》解析出的官方基线）逐类核对：
 * 该序列到底收全了没有。这是判断"内容是否完善"最硬的依据。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getStats,
  getTaxonomy,
  getCollections,
  getWarnings,
  getRegistryDropped,
  getAllEntities,
} from '../src/lib/data.ts';

const stats = getStats();
const tax = getTaxonomy();
const cols = getCollections();
const all = getAllEntities();

const pad = (s, n) => String(s).padEnd(n, ' ');
const padL = (s, n) => String(s).padStart(n, ' ');

console.log('='.repeat(74));
console.log('FinMap 数据覆盖报告');
console.log('='.repeat(74));
console.log(
  `持牌法人主体 ${stats.entities}（正常经营 ${stats.active} / 风险处置 ${stats.distressed} / 已退出 ${stats.exited}）` +
    ` · 去重来源 ${stats.sources} · 有许可证编码 ${stats.licensed} · 有官网 ${stats.withWebsite}`,
);
console.log();

console.log('集合构成');
for (const c of cols) {
  console.log(`  ${pad(c.short, 14)} ${padL(c.entities.length, 5)} 家  ${c.is_group ? '有股权谱系' : ''}`);
}
console.log();

console.log('按分类 / 牌照类型');
for (const { category, count, types } of stats.byCategory) {
  if (!count) {
    console.log(`  ${category.name}  —— 0 家（分类为空）`);
    continue;
  }
  console.log(`  ${category.name}  ${count} 家`);
  for (const { type, count: n } of types) {
    console.log(`      ${pad(type.name, 22)} ${padL(n, 4)}`);
  }
}
console.log();

const emptyTypes = tax.categories.flatMap((c) =>
  c.types.filter((t) => !stats.byCategory.find((b) => b.category.id === c.id)?.types.some((x) => x.type.id === t.id)),
);
// 把"明确决定不收"和"还没收"分开——前者是判断，后者是缺口，混在一起会让人误以为漏了。
const excluded = emptyTypes.filter((t) => t.outOfScope);
const missingTypes = emptyTypes.filter((t) => !t.outOfScope);
if (missingTypes.length) {
  console.log(`尚未收录任何机构的牌照类型（${missingTypes.length} 个）`);
  console.log('  ' + missingTypes.map((t) => t.name).join('、'));
  console.log();
} else {
  console.log('✓ 分类里每一个应当收录的牌照类型都有机构。');
  console.log();
}
if (excluded.length) {
  console.log(`明确不收录的牌照类型（${excluded.length} 个，附理由）`);
  for (const t of excluded) console.log(`  ${t.name}：${t.outOfScope}`);
  console.log();
}

const noWeb = stats.entities - stats.withWebsite;
console.log(`缺官网 ${noWeb} 家（${((noWeb / stats.entities) * 100).toFixed(0)}%）· 缺许可证编码 ${stats.entities - stats.licensed} 家`);
console.log();

const dropped = getRegistryDropped();
if (dropped.length) {
  console.log(`名录制去重（保留集团版本）${dropped.length} 条`);
  for (const d of dropped.slice(0, 40)) console.log(`  ${d}`);
  if (dropped.length > 40) console.log(`  … 另有 ${dropped.length - 40} 条`);
  console.log();
}

const warns = getWarnings();
if (warns.length) {
  console.log(`警告 ${warns.length} 条（持股比例缺时点，界面已标记）`);
  console.log();
}

// ── 与监管总局官方名单逐类核对 ────────────────────────────────────
const refPath = path.join(process.cwd(), 'data', 'roster-reference.json');
if (!fs.existsSync(refPath)) {
  console.log('（没有 data/roster-reference.json，跳过官方基线核对）');
  process.exit(0);
}

const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));

/** 官方名单的"机构类型" → 本项目的 type（"其他金融机构"按名称细分） */
function toType(code, r) {
  const t = r.t;
  const map = {
    开发性金融机构: 'development-bank',
    政策性银行: 'policy-bank',
    国有大型商业银行: 'state-commercial-bank',
    股份制商业银行: 'joint-stock-commercial-bank',
    城市商业银行: 'city-commercial-bank',
    民营银行: 'private-bank',
    外资法人银行: 'foreign-bank',
    住房储蓄银行: 'housing-savings-bank',
    农村商业银行: 'rural-commercial-bank',
    农村合作银行: 'rural-cooperative-bank',
    农村信用社: 'rural-credit-cooperative',
    农村资金互助社: 'rural-mutual-aid',
    村镇银行: 'village-bank',
    企业集团财务公司: 'finance-company',
    金融租赁公司: 'financial-leasing',
    信托公司: 'trust-company',
    汽车金融公司: 'auto-finance',
    消费金融公司: 'consumer-finance',
    货币经纪公司: 'money-broker',
    金融资产管理公司: 'amc',
    直销银行: 'direct-bank',
  };
  if (map[t]) return map[t];
  if (t === '其他金融机构') {
    if (/金融资产投资/.test(r.n)) return 'aic';
    if (/理财/.test(r.n)) return 'wealth-management';
    return null;
  }
  return null;
}

const byCode = new Map(all.filter((e) => e.license_code).map((e) => [e.license_code, e]));
const byName = new Map(all.map((e) => [e.name, e]));

/**
 * 基线名单（截至 2025-06-30）里仍在列、但此后法人资格已经消灭的机构。
 * 这些不算缺口——收进来反而是错的，所以从核对里剔除。
 */
const SUPERSEDED = new Map([
  ['Z0042H131000001', '中邮邮惠万家银行：已被邮储银行吸收合并，法人资格消灭'],
  ['B1043H365400001', '新疆汇和银行：已被新疆银行吸收合并，2025-12-31 期名单已移除，城商行家数 124→123'],
]);

const refByType = new Map();
for (const [code, r] of Object.entries(ref)) {
  if (SUPERSEDED.has(code)) continue;
  const t = toType(code, r);
  if (!t) continue;
  if (!refByType.has(t)) refByType.set(t, []);
  refByType.get(t).push({ code, ...r });
}

// ── 没有全量基线的序列：按官方公布家数做回归检查 ────────────────────
// 这些序列的家数来自各自官方名录的实读（不是记忆），但没有像银行/保险那样
// 逐条解析成基线，所以只能核对总数，不能列出缺哪一家。
const EXPECTED = [
  ['fund-management', 150, '证监会《公募基金管理机构名录（2026年7月）》.xls，实读 150 行'],
  ['futures-company', 150, '证监会《期货公司名录（2026年8月）》+ 中期协公示，两边均 150'],
  ['securities-firm', 115, '中证协《证券公司基本信息公示》150 条，剔除 30 家资管子公司 + 5 家承销保荐子公司'],
  ['investment-advisory', 76, '证监会《证券投资咨询机构名录（2026年7月）》.xls，序号 1–76'],
  ['local-amc', 61, '银保监会《地方资产管理公司名单》59 家 + 深圳资产(2023) + 上海申信(2026)，含 1 家已注销'],
  ['local-financial-holding', 1, '取得央行金融控股公司设立许可的地方平台，目前仅北京金控'],
];
console.log('按官方公布家数核对（无逐条基线的序列）');
console.log();
console.log(`  ${pad('牌照类型', 24)}${padL('官方', 6)}${padL('已收', 6)}  依据`);
let expBad = 0;
for (const [type, want, why] of EXPECTED) {
  const got = all.filter((e) => e.type === type).length;
  const ok = got === want;
  if (!ok) expBad++;
  console.log(`  ${pad(type, 24)}${padL(want, 6)}${padL(got, 6)}  ${ok ? '✓' : '← 不一致'}  ${why}`);
}
console.log();
if (expBad === 0) console.log('✓ 以上序列家数与官方公布一致。');
console.log();
// ── 保险业：与监管总局《保险机构法人名单》核对 ──────────────────────
const insRefPath = path.join(process.cwd(), 'data', 'insurance-reference.json');
if (fs.existsSync(insRefPath)) {
  const insRef = JSON.parse(fs.readFileSync(insRefPath, 'utf8'));
  const INS_TYPE = {
    '财险公司': 'pnc-insurer',
    '寿险公司': 'life-insurer',
    '养老保险公司': 'life-insurer',
    '健康险公司': 'life-insurer',
    '再保险公司': 'reinsurer',
    '保险资产管理公司': 'insurance-amc',
    '保险集团（控股）': 'insurance-group',
    '政策性保险公司': 'pnc-insurer',
    '其他': null,
  };
  const byType = new Map();
  for (const r of Object.values(insRef)) {
    const t = INS_TYPE[r.t];
    if (!t) continue;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }
  console.log('与监管总局《保险机构法人名单》逐类核对');
  console.log(`（基线 = 官方名单 ${Object.keys(insRef).length} 家保险法人；"已收"按机构全称匹配）`);
  console.log();
  console.log(`  ${pad('牌照类型', 22)}${padL('官方', 6)}${padL('已收', 6)}${padL('漏', 6)}`);
  let miss = 0;
  const mgaps = [];
  for (const [t, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    const got = list.filter((x) => byName.has(x.n)).length;
    const m = list.length - got;
    miss += m;
    if (m > 0) mgaps.push({ t, m, list: list.filter((x) => !byName.has(x.n)) });
    console.log(`  ${pad(t, 22)}${padL(list.length, 6)}${padL(got, 6)}${padL(m, 6)}${m ? '  ← 有缺口' : ''}`);
  }
  console.log();
  if (miss === 0) {
    console.log('✓ 保险机构法人名单覆盖的每一个牌照类型都已收全。');
  } else {
    console.log(`保险口径下共缺 ${miss} 家：`);
    for (const g of mgaps) {
      console.log(`  ${g.t}（缺 ${g.m}）：${g.list.slice(0, 6).map((x) => x.n).join('、')}${g.list.length > 6 ? ' …' : ''}`);
    }
  }
  console.log();
}
console.log('与监管总局《银行业金融机构法人名单》逐类核对');
console.log('（基线 = 官方名单 4070 家法人；"已收"按机构编码或机构全称匹配）');
if (SUPERSEDED.size) {
  console.log(`（已剔除 ${SUPERSEDED.size} 家基线中法人资格已消灭的机构：${
    [...SUPERSEDED.values()].join('；')
  }）`);
}
console.log();
console.log(`  ${pad('牌照类型', 22)}${padL('官方', 6)}${padL('已收', 6)}${padL('漏', 6)}`);
let totalMissing = 0;
const gaps = [];
for (const [t, list] of [...refByType].sort((a, b) => b[1].length - a[1].length)) {
  const got = list.filter((x) => byCode.has(x.code) || byName.has(x.n)).length;
  const missing = list.length - got;
  totalMissing += missing;
  if (missing > 0) gaps.push({ t, missing, list: list.filter((x) => !byCode.has(x.code) && !byName.has(x.n)) });
  console.log(
    `  ${pad(t, 22)}${padL(list.length, 6)}${padL(got, 6)}${padL(missing, 6)}${missing ? '  ← 有缺口' : ''}`,
  );
}
console.log();
if (totalMissing === 0) {
  console.log('✓ 官方名单覆盖的每一个牌照序列都已收全。');
} else {
  console.log(`官方名单口径下共缺 ${totalMissing} 家，明细：`);
  for (const g of gaps) {
    console.log(`  ${g.t}（缺 ${g.missing}）：${g.list.slice(0, 6).map((x) => x.n).join('、')}${g.list.length > 6 ? ' …' : ''}`);
  }
}
console.log();
