#!/usr/bin/env node
/**
 * 从国家金融监督管理总局《银行业金融机构法人名单》批量导入"名册级"法人机构。
 *
 * 为什么需要它：农商行 1505 家、村镇银行 1440 家、农村信用社 401 家……这些序列
 * 逐个上网核实官网和简介不现实，但把它们排除在外，"银行业"就永远是不完整的。
 * 所以走批量导入，只保留能确定的事实（名称、机构编码、牌照类型、监管单位），
 * 并在数据里标 tier: mass，界面会明确区分"名册级"和"已逐一核实"。
 *
 * 用法：
 *   pdftotext -layout 名单.pdf roster.txt
 *   node scripts/import-nfra-roster.mjs roster.txt           # 试运行
 *   node scripts/import-nfra-roster.mjs roster.txt --write   # 写文件
 *
 * 解析要点：
 *  - 行解析不可靠（大表的行会跨行、列会错位），所以用"机构编码"当锚点：
 *    先在全文定位编码，再取其后 60 字符窗口确定牌照类型与监管单位。
 *  - 名称不在编码紧前面——中间夹着英文名。所以取编码之前最后一个"序号 + 中文名"对。
 *  - 这三条都是踩过坑才定下来的：用行正则只能解析出 1886 家（真值 4070），
 *    用"紧贴编码取名称"只能拿到 46%。
 */

import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const write = process.argv.includes('--write');

if (!input) {
  console.error('用法: node scripts/import-nfra-roster.mjs <pdftotext 输出.txt> [--write]');
  process.exit(1);
}

const CODE_G = /[A-Z]\d{4}[A-Z]\d{9}/g;
const TYPES = [
  '开发性金融机构', '政策性银行', '国有大型商业银行', '股份制商业银行', '城市商业银行',
  '民营银行', '外资法人银行', '住房储蓄银行', '农村商业银行', '农村合作银行',
  '农村信用社', '村镇银行', '贷款公司', '农村资金互助社', '金融租赁公司',
  '企业集团财务公司', '信托公司', '汽车金融公司', '消费金融公司', '货币经纪公司',
  '理财公司', '金融资产管理公司', '金融资产投资公司', '直销银行', '其他金融机构',
];
const TYPE_RE = new RegExp(TYPES.join('|'));
const REGION_RE = /([\u4e00-\u9fff]{2,8}?金融监管(?:总局|分局|局))/;
// 名称的匹配要防一个坑：某些行的中文名折行到了序号之前，
// 此时"编码前最后一个 序号+中文名"会命中上一行编码的后 4 位 + 本行的类型标签，
// 结果把「村镇银行」这种类型名当成机构名。加 (?<!\d) 拒绝从编码中间截断的匹配。
const NAME_PAIR = /(?<!\d)(\d{1,4}) ([\u4e00-\u9fff][\u4e00-\u9fff（）·A-Za-z0-9]{3,})/;
const NAME_PAIR_G = /(?<!\d)(\d{1,4}) ([\u4e00-\u9fff][\u4e00-\u9fff（）·A-Za-z0-9]{3,})/g;

const SOURCE = {
  title: '国家金融监督管理总局《银行业金融机构法人名单》（截至2025年6月30日）',
  url: 'https://www.nfra.gov.cn/chinese/docfile/2025/86c58b1ad810422c8fa6c6d0107f1626.pdf',
  date: '2025-06-30',
};

const raw = fs.readFileSync(input, 'utf8');
const flat = raw.replace(/[ \t\u3000]+/g, ' ').replace(/\n/g, ' ');

const records = new Map();
for (const m of flat.matchAll(CODE_G)) {
  const code = m[0];
  if (records.has(code)) continue;
  const after = flat.slice(m.index + code.length, m.index + code.length + 60);
  const typeMatch = TYPE_RE.exec(after);
  if (!typeMatch) continue;
  const regionMatch = REGION_RE.exec(after);
  const regulator = regionMatch ? regionMatch[1] : '国家金融监督管理总局';
  const region = regulator.replace(/金融监管(总局|分局|局)$/, '') || '全国';
  // 名称紧跟在序号之后，但和机构编码之间隔着英文名，所以要往前找最后一个"序号 + 中文名"对
  const before = flat.slice(Math.max(0, m.index - 300), m.index).trimEnd();
  const name = [...before.matchAll(NAME_PAIR_G)].pop()?.[2] ?? '';
  records.set(code, { code, name, type: typeMatch[0], region, regulator });
}

const total = records.size;
const named = [...records.values()].filter((r) => r.name).length;
console.log(`解析到法人机构 ${total} 家，其中 ${named} 家取到了中文名`);

const byType = new Map();
for (const r of records.values()) {
  if (!byType.has(r.type)) byType.set(r.type, []);
  byType.get(r.type).push(r);
}
for (const [t, l] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${t.padEnd(12)} ${String(l.length).padStart(5)}`);
}

// ── 分类映射 ────────────────────────────────────────────────────────
/** 名单里的"机构类型" → taxonomy 的 category / type */
function classify(r) {
  if (r.type === '农村商业银行') return { category: 'banking', type: 'rural-commercial-bank' };
  if (r.type === '农村合作银行') return { category: 'banking', type: 'rural-cooperative-bank' };
  if (r.type === '农村信用社') return { category: 'banking', type: 'rural-credit-cooperative' };
  if (r.type === '农村资金互助社') return { category: 'banking', type: 'rural-mutual-aid' };
  if (r.type === '村镇银行') return { category: 'banking', type: 'village-bank' };
  if (r.type === '住房储蓄银行') return { category: 'banking', type: 'housing-savings-bank' };
  if (r.type === '企业集团财务公司') return { category: 'nonbank', type: 'finance-company' };
  // 名单把理财子公司、金融资产投资公司统一归在"其他金融机构"下，按名称细分
  if (/金融资产投资/.test(r.name)) return { category: 'nonbank', type: 'aic' };
  if (/理财/.test(r.name)) return { category: 'asset-management', type: 'wealth-management' };
  return null; // 信托登记、信托业保障基金、城商行合作联盟、养老金管理等，别处已有或暂无对应类型
}

const shortOf = (name) => name.replace(/股份有限公司$|有限责任公司$|有限公司$/g, '') || name;

function render(group, note) {
  const list = group.flatMap((t) => byType.get(t) ?? []).sort((a, b) => a.code.localeCompare(b.code));
  const out = ['note: >-', `  ${note}`, 'sources:', `  - { title: "${SOURCE.title}", url: "${SOURCE.url}", date: "${SOURCE.date}" }`, 'entities:'];
  let skipped = 0;
  for (const r of list) {
    const c = classify(r);
    if (!c) {
      skipped++;
      continue;
    }
    if (!r.name) {
      skipped++;
      continue;
    }
    out.push(
      `  - id: rk-${r.code.toLowerCase()}`,
      `    name: "${r.name}"`,
      `    short: "${shortOf(r.name)}"`,
      `    category: ${c.category}`,
      `    type: ${c.type}`,
      `    license_code: ${r.code}`,
      `    regulator: ${r.regulator}`,
      `    region: ${r.region}`,
      '    tier: mass',
      '    intro: >-',
      `      ${r.region}的${r.type}法人机构，金融许可证机构编码 ${r.code}。`,
      '      本条目为监管总局法人名单的名册级导入，未逐一核实官网与经营情况。',
      '    parent: ROOT',
      '    status: active',
      '    sources:',
      `      - { title: "${SOURCE.title}", url: "${SOURCE.url}", date: "${SOURCE.date}" }`,
    );
  }
  return { text: out.join('\n') + '\n', count: list.length - skipped, skipped };
}

const dir = path.join(process.cwd(), 'data', 'registry');
const jobs = [
  ['banking-rural.yaml', ['农村商业银行'], '农村商业银行法人机构——数量最大的一个牌照序列，采用监管名单批量导入。'],
  ['banking-village.yaml', ['村镇银行'], '村镇银行法人机构。这一序列历经"村改支"持续收缩，家数以监管名单为准。'],
  ['banking-cooperative.yaml', ['农村合作银行', '农村信用社', '农村资金互助社', '住房储蓄银行'], '农村合作银行、农村信用社、农村资金互助社与住房储蓄银行——农村金融体系里除了农商行之外的几类法人。'],
  ['finance-companies.yaml', ['企业集团财务公司'], '企业集团财务公司，为集团成员单位提供存贷结算的内部金融机构。'],
  ['wealth-and-aic-official.yaml', ['其他金融机构'], '监管名单把银行理财子公司与金融资产投资公司归在"其他金融机构"下，这里按名称细分还原：理财子公司归资产管理业，AIC 归非银行金融机构。'],
];

console.log();
let sum = 0;
for (const [file, types, note] of jobs) {
  const { text, count, skipped } = render(types, note);
  sum += count;
  console.log(`  ${file.padEnd(32)} ${String(count).padStart(5)} 家${skipped ? `（跳过 ${skipped} 家：无名称或无对应类型）` : ''}`);
  if (write) fs.writeFileSync(path.join(dir, file), text, 'utf8');
}
console.log(`\n合计 ${sum} 家`);

if (!write) {
  console.log('\n以上为试运行。加 --write 才会写文件。');
} else {
  console.log('已写入 data/registry/');
}
