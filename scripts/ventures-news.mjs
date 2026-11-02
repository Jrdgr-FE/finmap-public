#!/usr/bin/env node
/** Compile public publication metadata into a static company news archive. No private DB or models. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVentures, validateVentures } from '../src/lib/ventures.ts';
import { archiveNews, fetchPublicPages, inputFingerprint, validatePublicInput, normalizePublicArticle, PUBLIC_ENDPOINT, updateArchiveCoverage } from './lib/venture-news-core.mjs';
import { fetchOfficialFeed } from './lib/official-news.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'public/data/venture-news.json');
const metaPath = path.join(root, 'data/news/metadata.json');
const historyPath = path.join(root, 'data/news/public-history.json');
const cachePath = path.join(root, '.cache/ventures/public-news-input.json');
const officialCachePath = path.join(root, '.cache/ventures/official-input.json');
const argv = process.argv.slice(2);
const value = (key) => { const index = argv.indexOf(key); return index < 0 ? undefined : argv[index + 1]; };
const read = (filename, fallback) => fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : fallback;
const atomicWrite = (filename, data) => { fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(`${filename}.tmp`, JSON.stringify(data)); fs.renameSync(`${filename}.tmp`, filename); };
if (argv.includes('--help')) {
  console.log('npm run ventures:news [--refresh] [--max-pages 1..50] [--input public-snapshot.json] [--full] [--skip-official]\nWithout --refresh, reuse cached public responses for 6h. Retains 180 days / max 20,000 public metadata items. --full omits the FinHot incremental 48h overlap. --input is offline and skips official network calls. No private database credentials or model calls.');
  process.exit(0);
}
validateVentures();
const previous = read(outPath, { items: [] }), history = read(historyPath, { items: previous.items });
const now = new Date().toISOString(), feeds = [];
let input;
if (value('--input')) {
  const inputPath = path.resolve(value('--input'));
  if (/candidates\.json$/i.test(inputPath)) throw new Error('Private candidates exports must never be used for the public archive');
  input = validatePublicInput(read(inputPath));
  feeds.push({ id: 'finhot', url: PUBLIC_ENDPOINT, status: 'cached', fetchedAt: input.fetchedAt, count: input.items.length });
} else {
  try {
    if (!argv.includes('--refresh') && fs.existsSync(cachePath) && Date.now() - fs.statSync(cachePath).mtimeMs < 6 * 3600000) {
      input = validatePublicInput(read(cachePath));
    } else {
      const lastSuccess = previous.finhotFetchedAt ?? previous.fetchedAt;
      const from = !argv.includes('--full') && lastSuccess ? new Date(Date.parse(lastSuccess) - 48 * 3600000).toISOString() : undefined;
      input = await fetchPublicPages({ maxPages: Number(value('--max-pages') ?? 50), from, now });
      atomicWrite(cachePath, input);
    }
    feeds.push({ id: 'finhot', url: PUBLIC_ENDPOINT, status: 'ok', fetchedAt: input.fetchedAt, count: input.items.length });
  } catch (error) {
    console.error(`FinHot update failed; retaining the previous public archive: ${error.message}`);
    input = { endpoint: PUBLIC_ENDPOINT, fetchedAt: previous.finhotFetchedAt ?? previous.fetchedAt ?? '', items: [], pages: 0, publicDomains: previous.publicDomains ?? [], truncated: false };
    feeds.push({ id: 'finhot', url: PUBLIC_ENDPOINT, status: 'failed', fetchedAt: input.fetchedAt, count: 0, error: error.message });
  }
}
const officialSources = read(path.join(root, 'data/news/official-feeds.json'), []);
const officialCache = read(officialCachePath, {}), officialItems = [];
for (const source of officialSources) {
  if (argv.includes('--skip-official') || value('--input')) {
    feeds.push({ id: source.id, url: source.url, status: 'skipped', fetchedAt: officialCache[source.id]?.fetchedAt ?? null, count: 0 }); continue;
  }
  try {
    let entry = officialCache[source.id];
    if (argv.includes('--refresh') || !entry || Date.now() - Date.parse(entry.fetchedAt) >= 6 * 3600000) {
      entry = { fetchedAt: now, items: await fetchOfficialFeed(source) };
      officialCache[source.id] = entry;
    }
    officialItems.push(...entry.items);
    feeds.push({ id: source.id, url: source.url, status: 'ok', fetchedAt: entry.fetchedAt, count: entry.items.length });
  } catch (error) {
    console.error(`Official feed ${source.id} failed; retaining its archived entries: ${error.message}`);
    feeds.push({ id: source.id, url: source.url, status: 'failed', fetchedAt: officialCache[source.id]?.fetchedAt ?? null, count: 0, error: error.message });
  }
}
if (!value('--input') && !argv.includes('--skip-official')) atomicWrite(officialCachePath, officialCache);
if (feeds.every((feed) => feed.status === 'failed' || feed.status === 'skipped')) throw new Error('All public feeds failed; existing archive remains intact');
const exclusions = read(path.join(root, 'data/news/exclusions.json'), { ids: [] });
const companies = getVentures();
const all = archiveNews(history.items, [...input.items, ...officialItems], companies, { now, excludedIds: exclusions.ids, officialSources, matchedOnly: false });
const items = all.filter((item) => item.associations.length);
const dates = input.items.map(normalizePublicArticle).filter(Boolean).map((item) => item.publishedAt).sort();
const metadata = {
  version: 1, source: 'mixed-public-feeds', endpoint: PUBLIC_ENDPOINT, generatedAt: now,
  fetchedAt: feeds.filter((feed) => feed.status === 'ok' || feed.status === 'cached').map((feed) => feed.fetchedAt).filter(Boolean).sort().at(-1) ?? previous.fetchedAt ?? '',
  finhotFetchedAt: input.fetchedAt, upstreamSyncedAt: input.syncedAt ?? previous.upstreamSyncedAt ?? null, publicDomains: input.publicDomains ?? [],
  feeds, degraded: feeds.some((feed) => feed.status === 'failed'),
  fetch: { pages: input.pages ?? 0, scanned: input.items.length, maxPages: Number(value('--max-pages') ?? 50), truncated: Boolean(input.truncated), from: input.from ?? null, oldest: dates[0] ?? null, newest: dates.at(-1) ?? null, inputSha256: inputFingerprint(input.items) },
  retention: { days: 180, maxArticles: 20000 },
  coverage: 'Only public FinHot metadata and verified official RSS/Atom titles/links/dates. Automatic associations are reading leads, not reviewed corporate events or a complete media archive.',
  matchingVersion: 3,
  archiveCoverage: updateArchiveCoverage(previous, history.items, input, now),
};
atomicWrite(historyPath, { version: 1, source: 'mixed-public-feeds', generatedAt: now, items: all });
atomicWrite(outPath, { ...metadata, items });
atomicWrite(metaPath, { ...metadata, articles: items.length, companies: new Set(items.flatMap((item) => item.associations.map((a) => a.companyId))).size });
if (metadata.degraded && process.env.GITHUB_ACTIONS) console.warn('::warning title=Public news feed degraded::One or more public sources failed; their previous archive was retained. Check data/news/metadata.json.');
console.log(`Public news archive: ${items.length} articles / ${new Set(items.flatMap((item) => item.associations.map((a) => a.companyId))).size} companies; ${input.items.length} FinHot items / ${officialItems.length} official entries scanned; truncated=${Boolean(input.truncated)}, degraded=${metadata.degraded}.`);
