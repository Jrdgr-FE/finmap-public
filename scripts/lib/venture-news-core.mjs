/** Deterministic public-news entity matching. Never reads the private FinHot article store. */
import { createHash } from 'node:crypto';

export const PUBLIC_ENDPOINT = 'https://finhot.fun/api/items';
export const SAFE_SHORT = new Set(['amd', 'ibm', 'dji', 'byd', 'catl', 'asml', 'tsmc', 'smic', 'nvidia']);
const COMMON = new Set(['ai', 'agi', 'arm', 'figure', 'meta', 'apple', '苹果', '小米', '理想', '地平线', '商汤', '寒武纪', '零一', 'world', 'physical', 'applied', 'reflection', 'essential', 'moonshot', 'ami', '1x', 'face', 'sense', 'honor', 'oppo', 'vivo']);
const CONTEXT = /公司|集团|融资|估值|营收|净利|财报|上市|股份|科技|机器人|芯片|模型|大模型|汽车|量产|产品|发布|股价|投资|手机|半导体|智能|研发|采购|订单|iPhone|MacBook|NVIDIA|OpenAI|robot|chip|company|revenue|funding|raises?|invest|shares?|earnings|AI\b|model|semiconductor|smartphone|launch|CEO|acquires?|acquisition|factory|manufactur/i;
const NEVER_BARE = new Set(['ai', 'agi', 'arm', 'figure', 'world', 'physical', 'applied', 'reflection', 'essential', 'face', 'sense', 'ami', 'intuitive', 'modal', 'claude', 'lambda', 'whoop', '阶跃', '傅利叶', 'fourier']);
const text = (value, max = 2000) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const folded = (value) => value.normalize('NFKC').toLowerCase();
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}
export function canonicalUrl(value) {
  const url = safeUrl(value);
  if (!url) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid|spm)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
}
export function normalizePublicArticle(raw) {
  if (raw.public === false || raw.is_public === false || raw.visibility === 'private') return null;
  const title = text(raw.original_title || raw.title, 500), url = canonicalUrl(raw.url);
  const date = raw.published_at;
  if (!title || !url || !date || !Number.isFinite(Date.parse(date))) return null;
  const id = text(raw.id, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const origin = ['official', 'filing', 'report', 'monitor'].includes(raw.origin) ? raw.origin : 'finhot';
  return {
    id, title, url,
    ...(origin === 'official'
      ? { origin: 'official', officialFeedId: text(raw.officialFeedId, 100) }
      : origin === 'filing' || origin === 'report' || origin === 'monitor'
        ? { origin, companyId: text(raw.companyId, 100), companyName: text(raw.companyName, 160) }
        : { origin: 'finhot', finhotUrl: `https://finhot.fun/articles/${encodeURIComponent(id)}` }),
    publishedAt: new Date(date).toISOString(),
    sourceName: text(raw.source_name, 160) || new URL(url).hostname,
    summary: text(raw.summary, 1000), status: 'reported',
  };
}
export function compileAliases(companies) {
  const aliasOwners = new Map();
  const rows = companies.map((company) => {
    const aliases = [...new Set((company.match ?? [company.name, company.en, ...(company.aliases ?? [])]).map((v) => text(v, 160)).filter(Boolean))];
    for (const alias of aliases) {
      const key = folded(alias);
      if (!aliasOwners.has(key)) aliasOwners.set(key, new Set());
      aliasOwners.get(key).add(company.id);
    }
    return { companyId: company.id, aliases };
  });
  return rows.map((row) => ({ companyId: row.companyId, aliases: row.aliases.flatMap((alias) => {
    const key = folded(alias), latin = /^[\x00-\x7f]+$/.test(key);
    // A shared alias cannot safely identify either entity. Short acronyms need an explicit allowlist.
    if (aliasOwners.get(key).size > 1 || key.length < 2 || NEVER_BARE.has(key) || (latin && key.length <= 3 && !SAFE_SHORT.has(key) && !COMMON.has(key))) return [];
    return [{ alias, key, brandCase: key === 'minimax', cautious: COMMON.has(key), re: new RegExp(latin ? `(?<![a-z0-9])${escaped(key)}(?![a-z0-9])` : escaped(key), 'u') }];
  }).sort((a, b) => b.alias.length - a.alias.length) }));
}
export function matchCompanies(article, compiled) {
  const title = folded(article.title), summary = folded(article.summary || '');
  const result = [];
  for (const company of compiled) {
    let best;
    for (const rule of company.aliases) {
      if (rule.re.test(title) && (!rule.brandCase || /MiniMax|MINIMAX/.test(article.title) && !/minimax[ -]*(algorithm|theorem|strategy)|MINIMAX算法|MiniMax算法/i.test(article.title)) && (!rule.cautious || CONTEXT.test(article.title))) {
        best = { companyId: company.companyId, matchType: 'title', alias: rule.alias }; break;
      }
    }
    if (!best) {
      // Common names are never inferred from a summary alone; summaries can contain generic language.
      for (const rule of company.aliases) if (!rule.cautious && rule.re.test(summary) && (!rule.brandCase || /MiniMax|MINIMAX/.test(article.summary) && !/minimax[ -]*(algorithm|theorem|strategy)|MINIMAX算法|MiniMax算法/i.test(article.summary))) {
        best = { companyId: company.companyId, matchType: 'summary', alias: rule.alias }; break;
      }
    }
    if (best) result.push(best);
  }
  return result;
}
export function archiveNews(previous, publicItems, companies, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const cutoff = Date.parse(now) - (options.retentionDays ?? 180) * 86400000;
  const excluded = new Set(options.excludedIds ?? []), byUrl = new Map();
  const compiled = compileAliases(companies);
  const companyIds = new Set(companies.map((company) => company.id));
  const officialSources = new Map((options.officialSources ?? []).map((source) => [source.id, source]));
  // Previous archive is already an allowlisted public projection. Re-match on every run to include new companies.
  for (const item of [...(previous ?? []), ...publicItems.map(normalizePublicArticle).filter(Boolean)]) {
    if (excluded.has(item.id) || Date.parse(item.publishedAt) < cutoff || !safeUrl(item.url)) continue;
    if (item.origin === 'official') { const source = officialSources.get(item.officialFeedId); if (!source || !companyIds.has(source.companyId) || !source.allowedHosts.includes(new URL(item.url).hostname)) continue; }
    if (['filing', 'report', 'monitor'].includes(item.origin) && item.companyId && !companyIds.has(item.companyId)) continue;
    const key = canonicalUrl(item.url), prior = byUrl.get(key);
    const isStrong = (o) => o === 'official' || o === 'filing' || o === 'report';
    // The official/statutory source is stronger provenance than a syndicated copy, even during a feed outage.
    if (!prior || (isStrong(item.origin) && !isStrong(prior.origin)) || (!isStrong(prior.origin) && !isStrong(item.origin) && item.publishedAt >= prior.publishedAt) || (isStrong(prior.origin) && isStrong(item.origin) && item.publishedAt >= prior.publishedAt)) byUrl.set(key, item);
  }
  return [...byUrl.values()].map((item) => {
    const associations = matchCompanies(item, compiled);
    if (item.origin === 'official') {
      const source = officialSources.get(item.officialFeedId);
      const existing = associations.findIndex((a) => a.companyId === source.companyId);
      if (existing >= 0) associations.splice(existing, 1);
      associations.unshift({ companyId: source.companyId, matchType: 'official', alias: source.name });
    } else if (item.origin === 'filing' || item.origin === 'report' || item.origin === 'monitor') {
      const targetCompanyId = item.companyId || associations[0]?.companyId;
      if (targetCompanyId && companyIds.has(targetCompanyId)) {
        const existing = associations.findIndex((a) => a.companyId === targetCompanyId);
        if (existing >= 0) associations.splice(existing, 1);
        const companyObj = companies.find((c) => c.id === targetCompanyId);
        associations.unshift({
          companyId: targetCompanyId,
          matchType: item.origin === 'filing' ? 'official' : 'title',
          alias: item.companyName || companyObj?.name || targetCompanyId,
        });
      }
    }
    return {
      id: item.id, title: text(item.title, 500), url: canonicalUrl(item.url),
      ...(item.origin === 'official'
        ? { origin: 'official', officialFeedId: item.officialFeedId }
        : item.origin === 'filing' || item.origin === 'report' || item.origin === 'monitor'
          ? { origin: item.origin, companyId: item.companyId, companyName: item.companyName }
          : { origin: 'finhot', finhotUrl: `https://finhot.fun/articles/${encodeURIComponent(item.id)}` }),
      publishedAt: item.publishedAt, sourceName: text(item.sourceName, 160), summary: item.origin === 'official' ? '' : text(item.summary, 1000), status: 'reported', associations,
    };
  }).filter((item) => options.matchedOnly === false || item.associations.length)
    // Unmatched finance metadata must not evict company history from the bounded archive.
    .sort((a, b) => Number(Boolean(b.associations.length)) - Number(Boolean(a.associations.length)) || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, options.maxArticles ?? 20000)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}
export function inputFingerprint(items) {
  return createHash('sha256').update(JSON.stringify(items)).digest('hex');
}
export async function fetchPublicPages({ fetchImpl = fetch, maxPages = 50, from, now = new Date().toISOString() } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new Error('maxPages must be 1–50');
  const items = [], seen = new Set();
  let hasMore = false, pages = 0, publicDomains = [], syncedAt = null;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(PUBLIC_ENDPOINT);
    url.searchParams.set('all', '1'); url.searchParams.set('offset', String(page * 20));
    if (page === 0) url.searchParams.set('catalog', '1');
    if (from) url.searchParams.set('from', from);
    const response = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'FinMap-public-news-index/1.0 (+https://map.finhot.fun/)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Public FinHot API HTTP ${response.status}; archive was not replaced`);
    const body = await response.json();
    if (!Array.isArray(body.items) || typeof body.hasMore !== 'boolean') throw new Error('Unexpected public API format');
    pages++;
    if (page === 0) { publicDomains = (body.domains ?? []).map((d) => d.key); syncedAt = body.syncedAt ?? null; }
    for (const item of body.items) if (!seen.has(item.id)) { items.push(item); seen.add(item.id); }
    hasMore = body.hasMore;
    if (!hasMore || !body.items.length) break;
  }
  return { version: 1, source: 'finhot-public-api', endpoint: PUBLIC_ENDPOINT, fetchedAt: now, publicDomains, syncedAt, pages, truncated: hasMore, from: from ?? null, items };
}
export function validatePublicInput(input) {
  if (input?.version !== 1 || input.source !== 'finhot-public-api' || input.endpoint !== PUBLIC_ENDPOINT || !Array.isArray(input.items) || !Number.isFinite(Date.parse(input.fetchedAt))) throw new Error('Input must be a public FinHot API snapshot, never a private candidates export');
  return input;
}

/** A successful bounded fetch is not proof of complete history. Never silently clear known gaps. */
export function updateArchiveCoverage(previous, history, input, now = new Date().toISOString()) {
  const prior = previous?.archiveCoverage;
  const gaps = [...(prior?.gaps ?? [])];
  const oldFinhot = (history ?? []).filter((item) => !item.origin || item.origin === 'finhot');
  const current = (input.items ?? []).map(normalizePublicArticle).filter(Boolean);
  const oldKeys = new Set(oldFinhot.flatMap((item) => [item.id, canonicalUrl(item.url)]));
  const overlap = current.some((item) => oldKeys.has(item.id) || oldKeys.has(canonicalUrl(item.url)));
  const oldNewest = oldFinhot.map((item) => item.publishedAt).sort().at(-1);
  const newOldest = current.map((item) => item.publishedAt).sort()[0];
  if (input.truncated && oldNewest && newOldest && !overlap && newOldest > oldNewest) {
    const gap = { from: oldNewest, to: newOldest, detectedAt: now, reason: 'A capped public fetch did not overlap previously archived FinHot entries; this interval may contain missing stories.' };
    if (!gaps.some((item) => item.from === gap.from && item.to === gap.to)) gaps.push(gap);
  }
  return {
    bootstrapIncomplete: Boolean(prior?.bootstrapIncomplete || (!prior && (previous?.fetch?.truncated || input.truncated))),
    gaps,
    lastCompleteFetchAt: current.length && !input.truncated ? input.fetchedAt : prior?.lastCompleteFetchAt ?? null,
  };
}
