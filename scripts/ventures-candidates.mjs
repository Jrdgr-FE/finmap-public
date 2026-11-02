#!/usr/bin/env node
/**
 * 硬科技图谱 · 候选动态
 *
 * 从 FinHot 的文章库里按公司名匹配出最近的相关报道，写成待审清单
 * data/ventures/candidates.json。这个文件不在网站上展示：匹配只看名字，
 * 会有误报，而且其中包括 FinHot 尚未公开发布的 AI 源文章。
 * 审核后由人（或 Claude）把确认的事件写进 ventures.yaml，带上来源。
 *
 *   npm run ventures:candidates            # 默认最近 14 天
 *   npm run ventures:candidates -- --days 30
 *
 * 对 FinHot 只做只读查询：通过 SSH（主机别名由 FINHOT_SSH_HOST 指定）在服务器上跑一条 SELECT，
 * 不改服务器、数据库和流水线的任何东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getVentures } from '../src/lib/ventures.ts';

const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(args[daysArg + 1]) : 14;
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('--days 必须是正数');
  process.exit(1);
}

const SSH_HOST = process.env.FINHOT_SSH_HOST;
if (!SSH_HOST) {
  console.error('请设置 FINHOT_SSH_HOST（能连到 FinHot 服务器的 SSH 主机别名）');
  process.exit(1);
}
// 服务器上读数据库连接串的方式。默认从 FinHot 的 env 文件里取 DATABASE_URL。
const DB_URL_CMD = process.env.FINHOT_DB_URL_CMD || "grep -h '^DATABASE_URL=' /etc/finhot/*.env | head -1 | cut -d= -f2- | tr -d '\"'";

// 文章表的列名。和 FinHot 的实际表结构对不上时，用环境变量覆盖。
const T = process.env.FINHOT_ARTICLES_TABLE || 'articles';
const C_ID = process.env.FINHOT_COL_ID || 'id';
const C_TITLE = process.env.FINHOT_COL_TITLE || 'title';
const C_SUMMARY = process.env.FINHOT_COL_SUMMARY || 'excerpt';
const C_URL = process.env.FINHOT_COL_URL || 'url';
const C_TIME = process.env.FINHOT_COL_TIME || 'timeline_at';
// 「是否已公开」：publications 里有一条 public 且进了内容池（eligible）的记录。
const PUBLIC_EXPR =
  process.env.FINHOT_PUBLIC_EXPR ||
  `EXISTS (SELECT 1 FROM publications p WHERE p.article_id = ${T}.${C_ID} AND p.visibility = 'public' AND p.eligible)`;

const sql = `
  COPY (
    SELECT ${C_ID}::text, ${C_TITLE}, coalesce(${C_SUMMARY}, ''), ${C_URL}, ${C_TIME}::text, (${PUBLIC_EXPR})::text
    FROM ${T}
    WHERE ${C_TIME} >= now() - interval '${Math.floor(DAYS)} days'
  ) TO STDOUT WITH (FORMAT csv)
`.replace(/\s+/g, ' ').trim();

// sql 只由本脚本拼出，不含外部输入；用单引号包给远端 shell
const remote = `psql "$(${DB_URL_CMD})" -v ON_ERROR_STOP=1 -At -c '${sql.replaceAll("'", "'\\''")}'`;

let raw;
try {
  raw = execFileSync('ssh', [SSH_HOST, remote], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
} catch (err) {
  console.error(`✗ 读取 FinHot 文章失败（ssh ${SSH_HOST}）`);
  console.error(String(err.stderr || err.message).trim());
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const articles = parseCsv(raw).map(([id, title, summary, url, time, pub]) => ({
  id, title, summary, url, time, public: pub === 'true' ? true : pub === 'false' ? false : null,
}));

// 名字太短（比如两个字母的英文名）容易误报，要求英文名按整词匹配。
// 名字是常用词的公司（Ultra、Sunday、Runway……）在 yaml 里写 match，只按 match 匹配
const ventures = getVentures();
const matchers = ventures.map((v) => {
  const names = (v.match ?? [v.name, v.en, ...(v.aliases ?? [])])
    .filter(Boolean)
    .map((n) => n.replace(/（.*?）|\(.*?\)/g, '').trim())
    .filter((n) => n.length >= 2);
  const res = [...new Set(names)].map((n) =>
    /^[\x00-\x7f]+$/.test(n)
      ? new RegExp(`(^|[^A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i')
      : new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  return { v, res };
});

// 已经写进图谱的来源不再重复提示
const known = new Set(ventures.flatMap((v) => v.events.flatMap((e) => e.sources.map((s) => s.url))));

const candidates = [];
for (const a of articles) {
  if (known.has(a.url)) continue;
  const text = `${a.title}\n${a.summary}`;
  for (const { v, res } of matchers) {
    if (res.some((re) => re.test(text))) {
      candidates.push({
        venture: v.id,
        name: v.name,
        title: a.title,
        url: a.url,
        time: a.time,
        public: a.public,
        finhot_id: a.id,
      });
    }
  }
}
candidates.sort((x, y) => String(y.time).localeCompare(String(x.time)));

const out = path.join(process.cwd(), 'data', 'ventures', 'candidates.json');
fs.writeFileSync(
  out,
  JSON.stringify({ generated: new Date().toISOString(), days: DAYS, scanned: articles.length, candidates }, null, 2) + '\n',
);

console.log(`✓ 扫描最近 ${DAYS} 天 ${articles.length} 篇文章，匹配到 ${candidates.length} 条候选动态 → ${path.relative(process.cwd(), out)}`);
const byCo = new Map();
for (const c of candidates) byCo.set(c.name, (byCo.get(c.name) ?? 0) + 1);
for (const [n, k] of [...byCo].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}  ${k}`);
