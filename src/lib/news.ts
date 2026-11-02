import fs from 'node:fs';
import path from 'node:path';
import { getVentures } from './ventures.ts';

export interface CompanyNewsAssociation {
  companyId: string;
  matchType: 'title' | 'summary' | 'official';
  alias: string;
}
export interface CompanyNewsItem {
  id: string;
  title: string;
  url: string;
  finhotUrl?: string;
  origin?: 'finhot' | 'official';
  officialFeedId?: string;
  publishedAt: string;
  sourceName: string;
  summary: string;
  /** All automatic matches remain reported leads. Reviewed events live in ventures YAML. */
  status: 'reported';
  associations: CompanyNewsAssociation[];
}
export interface CompanyNewsSnapshot {
  version: 1;
  source: 'finhot-public-api' | 'mixed-public-feeds';
  endpoint: string;
  generatedAt: string;
  fetchedAt: string;
  upstreamSyncedAt: string | null;
  finhotFetchedAt?: string;
  degraded?: boolean;
  feeds?: Array<{ id: string; url: string; status: 'ok' | 'failed' | 'cached' | 'skipped'; fetchedAt: string | null; count: number; error?: string }>;
  publicDomains: string[];
  fetch: { pages: number; scanned: number; maxPages: number; truncated: boolean; from: string | null; oldest: string | null; newest: string | null; inputSha256: string };
  retention: { days: number; maxArticles: number };
  coverage: string;
  matchingVersion: number;
  archiveCoverage?: { bootstrapIncomplete: boolean; gaps: Array<{ from: string; to: string; detectedAt: string; reason: string }>; lastCompleteFetchAt: string | null };
  items: CompanyNewsItem[];
}
const NEWS_PATH = path.join(process.cwd(), 'public/data/venture-news.json');
let cached: CompanyNewsSnapshot | null = null;
function isHttp(raw: string): boolean {
  try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function getNewsSnapshot(): CompanyNewsSnapshot {
  if (cached) return cached;
  const empty: CompanyNewsSnapshot = {
    version: 1, source: 'finhot-public-api', endpoint: 'https://finhot.fun/api/items', generatedAt: '', fetchedAt: '', upstreamSyncedAt: null, publicDomains: [],
    fetch: { pages: 0, scanned: 0, maxPages: 50, truncated: false, from: null, oldest: null, newest: null, inputSha256: '' },
    retention: { days: 180, maxArticles: 20000 }, coverage: '尚未导入公开新闻', matchingVersion: 1, items: [],
  };
  const data = fs.existsSync(NEWS_PATH) ? JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8')) as CompanyNewsSnapshot : empty;
  if (data.version !== 1 || !['finhot-public-api', 'mixed-public-feeds'].includes(data.source) || data.endpoint !== 'https://finhot.fun/api/items' || !Array.isArray(data.items)) throw new Error('Invalid public company news archive');
  const ids = new Set(getVentures().map((v) => v.id));
  const officialSources = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data/news/official-feeds.json'), 'utf8')) as Array<{ id: string; companyId: string; allowedHosts: string[] }>;
  for (const item of data.items) {
    if (!item.title || !isHttp(item.url) || (item.origin !== 'official' && !item.finhotUrl?.startsWith('https://finhot.fun/articles/')) || !Number.isFinite(Date.parse(item.publishedAt)) || item.status !== 'reported') throw new Error(`Invalid public news article ${item.id}`);
    if (item.origin === 'official') {
      const source = officialSources.find((entry) => entry.id === item.officialFeedId);
      if (!source || !source.allowedHosts.includes(new URL(item.url).hostname) || item.summary || !item.associations?.some((a) => a.companyId === source.companyId && a.matchType === 'official')) throw new Error(`Invalid official-source attribution ${item.id}`);
    }
    if (!Array.isArray(item.associations) || item.associations.some((a) => !ids.has(a.companyId) || !['title', 'summary', 'official'].includes(a.matchType) || !a.alias)) throw new Error(`Invalid public news association ${item.id}`);
  }
  cached = data;
  return data;
}
export function getAllCompanyNews(): CompanyNewsItem[] { return getNewsSnapshot().items; }
export function getCompanyNews(companyId: string, options: { limit?: number; includeMentions?: boolean } = {}): CompanyNewsItem[] {
  const list = getAllCompanyNews().filter((item) => item.associations.some((a) => a.companyId === companyId && (options.includeMentions !== false || a.matchType !== 'summary')));
  return options.limit === undefined ? list : list.slice(0, Math.max(0, options.limit));
}
export const newsForCompany = getCompanyNews;
export function getNewsStats() {
  const snapshot = getNewsSnapshot(), items = snapshot.items;
  const associations = items.flatMap((item) => item.associations);
  return {
    articles: items.length, companies: new Set(associations.map((a) => a.companyId)).size,
    titleMatches: associations.filter((a) => a.matchType === 'title').length,
    mentions: associations.filter((a) => a.matchType === 'summary').length,
    officialMatches: associations.filter((a) => a.matchType === 'official').length,
    degraded: snapshot.degraded ?? false, feeds: snapshot.feeds ?? [],
    bootstrapIncomplete: snapshot.archiveCoverage?.bootstrapIncomplete ?? false,
    coverageGapCount: snapshot.archiveCoverage?.gaps.length ?? 0,
    updatedAt: snapshot.fetchedAt, generatedAt: snapshot.generatedAt, oldestArticleAt: items.at(-1)?.publishedAt ?? null,
    newestArticleAt: items[0]?.publishedAt ?? null, scannedArticles: snapshot.fetch.scanned,
    fetchedPages: snapshot.fetch.pages, fetchLimit: snapshot.fetch.maxPages * 20,
    truncated: snapshot.fetch.truncated, publicDomains: snapshot.publicDomains,
  };
}
