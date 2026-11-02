import test from 'node:test';
import assert from 'node:assert/strict';
import { getVentures } from '../src/lib/ventures.ts';
import { archiveNews, compileAliases, matchCompanies, normalizePublicArticle, fetchPublicPages, validatePublicInput, PUBLIC_ENDPOINT } from '../scripts/lib/venture-news-core.mjs';
const companies = [
  { id: 'nvidia', name: '英伟达', en: 'NVIDIA' },
  { id: 'amd', name: '超威半导体', en: 'AMD' },
  { id: 'figure-ai', name: 'Figure AI', aliases: ['Figure'] },
  { id: 'arm', name: '安谋', en: 'Arm Holdings', aliases: ['ARM'] },
  { id: 'apple', name: '苹果', en: 'Apple' },
  { id: 'unitree', name: '宇树科技', en: 'Unitree', aliases: ['宇树'] },
];
const compiled = compileAliases(companies);
const match = (title, summary = '') => matchCompanies({ title, summary }, compiled);
const raw = (id = 'a', extra = {}) => ({ id, original_title: 'NVIDIA launches a new chip', title: '不采用这个生成标题', url: `https://example.com/${id}`, published_at: '2026-10-22T13:00:00Z', source_name: 'Public Source', summary: '', ...extra });
test('English aliases match complete words, including next to Chinese text', () => {
  assert.equal(match('NVIDIA发布新芯片')[0].companyId, 'nvidia');
  assert.equal(match('New AMD chip')[0].companyId, 'amd');
  assert.deepEqual(match('AMDocs and SuperNVIDIA'), []);
});
test('ambiguous common and short aliases are conservative', () => {
  assert.deepEqual(match('Figure 2 shows a robotic arm'), []);
  assert.deepEqual(match('ARM architecture helps this robot'), []);
  assert.deepEqual(match('今天苹果丰收了'), []);
  assert.deepEqual(match('Apple orchards expand in autumn'), []);
  assert.equal(match('苹果发布新款 iPhone')[0].companyId, 'apple');
  assert.equal(match('Figure AI introduces a robot')[0].companyId, 'figure-ai');
});
test('shared aliases cannot silently identify two companies', () => {
  assert.deepEqual(matchCompanies({ title: '共同科技完成融资', summary: '' }, compileAliases([{ id: 'a', name: '公司甲', aliases: ['共同科技'] }, { id: 'b', name: '公司乙', aliases: ['共同科技'] }])), []);
});
test('title identification and summary-only mention remain distinct', () => {
  const associations = match('英伟达公布财报', '报道提到宇树科技采购相关硬件。');
  assert.deepEqual(associations.map((a) => [a.companyId, a.matchType]), [['nvidia', 'title'], ['unitree', 'summary']]);
  assert.deepEqual(match('季度经济概览', '苹果公司发布了财报。'), []);
});
test('only allowlisted public metadata enters output; original headline controls matching', () => {
  const normalized = normalizePublicArticle(raw('a', { body: 'SECRET FULL BODY', private_notes: 'SECRET NOTES', title: '宇树科技融资' }));
  assert.equal(normalized.title, 'NVIDIA launches a new chip');
  assert.equal(JSON.stringify(normalized).includes('SECRET'), false);
  assert.equal(normalized.finhotUrl, 'https://finhot.fun/articles/a');
  assert.deepEqual(matchCompanies(normalized, compiled).map((a) => a.companyId), ['nvidia']);
});
test('duplicate URLs merge, old published articles persist, exclusions and retention apply', () => {
  const first = archiveNews([], [raw('a')], companies, { now: '2026-10-23T00:00:00Z' });
  const second = archiveNews(first, [raw('other', { url: 'https://example.com/a?utm_source=rss#top' }), raw('b')], companies, { now: '2026-10-23T00:00:00Z' });
  assert.equal(second.length, 2);
  assert.equal(second.every((item) => item.status === 'reported'), true);
  assert.equal(archiveNews(second, [], companies, { now: '2027-10-23T00:00:00Z' }).length, 0);
  assert.equal(archiveNews(first, [], companies, { now: '2026-10-23T00:00:00Z', excludedIds: ['a'] }).length, 0);
});
test('unsafe URLs and invalid dates are rejected', () => {
  assert.equal(normalizePublicArticle(raw('a', { url: 'javascript:alert(1)' })), null);
  assert.equal(normalizePublicArticle(raw('a', { url: 'https://user:password@example.com/' })), null);
  assert.equal(normalizePublicArticle(raw('a', { published_at: 'invalid' })), null);
});
test('public pagination is bounded, deduplicates shifting pages, and reports truncation', async () => {
  const calls = [];
  const input = await fetchPublicPages({ maxPages: 2, now: '2026-10-23T00:00:00Z', fetchImpl: async (url) => {
    calls.push(url.toString());
    return { ok: true, json: async () => ({ items: [raw('a')], hasMore: true, domains: [{ key: 'finance' }] }) };
  } });
  assert.equal(calls.length, 2); assert.equal(input.items.length, 1); assert.equal(input.truncated, true);
  assert.match(calls[1], /offset=20/); assert.equal(input.endpoint, PUBLIC_ENDPOINT);
});
test('failed public fetch is fatal and cannot replace an archive with an empty success', async () => {
  await assert.rejects(fetchPublicPages({ fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(fetchPublicPages({ maxPages: 51 }), /1–50/);
});
test('offline input must declare public-publication provenance', () => {
  assert.throws(() => validatePublicInput({ items: [raw()], source: 'private-db' }), /public FinHot/);
  assert.throws(() => validatePublicInput({ version: 1, source: 'finhot-public-api', endpoint: 'https://internal/api', fetchedAt: '2026-10-23', items: [] }), /public FinHot/);
  assert.equal(validatePublicInput({ version: 1, source: 'finhot-public-api', endpoint: PUBLIC_ENDPOINT, fetchedAt: '2026-10-23', items: [] }).items.length, 0);
});

const official = { id: 'nvidia', companyId: 'nvidia', name: 'NVIDIA Official', url: 'https://blogs.nvidia.com/feed/', allowedHosts: ['blogs.nvidia.com'] };
const { parseOfficialFeed, fetchOfficialFeed } = await import('../scripts/lib/official-news.mjs');
test('official RSS imports title/link/date only and never body or external entities', () => {
  const entries = parseOfficialFeed('<rss><channel><item><title><![CDATA[New robot platform]]></title><link>https://blogs.nvidia.com/blog/robot/</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate><description>BODY MUST NOT BE COPIED</description></item></channel></rss>', official);
  assert.equal(entries.length, 1); assert.equal(entries[0].summary, '');
  assert.equal(JSON.stringify(entries).includes('BODY MUST'), false);
  assert.throws(() => parseOfficialFeed('<!DOCTYPE rss [<!ENTITY file SYSTEM "file:///etc/passwd">]><rss/>', official), /entities/);
});
test('official Atom uses alternate link and refuses missing dates, external hosts and malformed XML', () => {
  const entries = parseOfficialFeed('<feed><entry><title>A platform update</title><link href="https://blogs.nvidia.com/blog/new/" rel="alternate"/><updated>2026-10-22T10:00:00Z</updated></entry><entry><title>No date</title><link href="https://blogs.nvidia.com/blog/no-date/"/></entry><entry><title>External</title><link href="https://example.com/"/><updated>2026-10-22T10:00:00Z</updated></entry></feed>', official);
  assert.equal(entries.length, 1);
  assert.throws(() => parseOfficialFeed('<rss><channel></rss>', official));
});
test('official source ownership adds an explicitly labelled association, not a confirmed event', () => {
  const [rawOfficial] = parseOfficialFeed('<rss><channel><item><title>A new robot platform</title><link>https://blogs.nvidia.com/blog/robot/</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>', official);
  const [item] = archiveNews([], [rawOfficial], companies, { now: '2026-10-23T00:00:00Z', officialSources: [official] });
  assert.deepEqual(item.associations, [{ companyId: 'nvidia', matchType: 'official', alias: 'NVIDIA Official' }]);
  assert.equal(item.status, 'reported'); assert.equal(item.finhotUrl, undefined);
  assert.equal(archiveNews([], [{ ...rawOfficial, url: 'https://evil.example/a' }], companies, { now: '2026-10-23T00:00:00Z', officialSources: [official] }).length, 0);
});
test('official failed and redirected feeds do not masquerade as empty success', async () => {
  await assert.rejects(fetchOfficialFeed(official, { fetchImpl: async () => ({ ok: false, status: 502 }) }), /502/);
  await assert.rejects(fetchOfficialFeed(official, { fetchImpl: async () => ({ ok: true, url: 'https://evil.example/feed', text: async () => '<rss/>' }) }), /outside/);
});
test('unmatched public metadata may be retained for future company additions', () => {
  const history = archiveNews([], [raw('a')], [], { now: '2026-10-23T00:00:00Z', matchedOnly: false });
  assert.equal(history.length, 1); assert.equal(history[0].associations.length, 0);
  assert.equal(archiveNews(history, [], companies, { now: '2026-10-23T00:00:00Z' }).length, 1);
});
test('editorial match overrides replace generic company names instead of appending them', () => {
  const exact = compileAliases([{ id: 'sunday', name: 'Sunday', en: 'Sunday', aliases: ['Sunday AI'], match: ['Sunday Robotics', 'Memo 机器人'] }]);
  assert.deepEqual(matchCompanies({ title: 'AI markets open on Sunday', summary: '' }, exact), []);
  assert.equal(matchCompanies({ title: 'Sunday Robotics launches a robot', summary: '' }, exact)[0].companyId, 'sunday');
});
test('discovery time cannot be invented as the publication date', () => {
  assert.equal(normalizePublicArticle(raw('a', { published_at: null, discovered_at: '2026-10-23T00:00:00Z' })), null);
});
test('technical common words and personal names do not become company news', () => {
  const fixtures = [
    [{ id: 'intuitive-surgical', name: '直觉外科', en: 'Intuitive Surgical', aliases: ['Intuitive'] }, 'An intuitive robot interface'],
    [{ id: 'modal', name: 'Modal', aliases: ['Modal Labs'] }, 'Modal logic helps model reasoning'],
    [{ id: 'stepfun', name: '阶跃星辰', aliases: ['阶跃'] }, '阶跃函数：神经网络模型的基础'],
    [{ id: 'anthropic', name: 'Anthropic', aliases: ['Claude'] }, 'Claude Monet paintings sell at auction'],
    [{ id: 'whoop', name: 'WHOOP', aliases: ['WHOOP Inc'] }, 'Fans whoop as the company unveils a robot'],
    [{ id: 'fourier', name: '傅利叶', en: 'Fourier', match: ['傅利叶', 'Fourier Intelligence'] }, '傅利叶变换：处理芯片信号的算法'],
    [{ id: 'lambda', name: 'Lambda' }, 'Lambda functions power a new AI tool'],
    [{ id: 'minimax', name: 'MiniMax', aliases: ['稀宇科技'] }, 'The minimax algorithm improves game AI'],
  ];
  for (const [company, title] of fixtures) assert.deepEqual(matchCompanies({ title, summary: '' }, compileAliases([company])), [], title);
  assert.equal(matchCompanies({ title: 'MiniMax完成融资', summary: '' }, compileAliases([{ id: 'minimax', name: 'MiniMax' }]))[0].companyId, 'minimax');
});
test('syndicated copy cannot erase official attribution during an official feed outage', () => {
  const [entry] = parseOfficialFeed('<rss><channel><item><title>A new robot platform</title><link>https://blogs.nvidia.com/blog/robot/</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>', official);
  const first = archiveNews([], [entry], companies, { now: '2026-10-23T00:00:00Z', officialSources: [official] });
  const syndicated = raw('mirror', { original_title: entry.original_title, url: entry.url, published_at: entry.published_at });
  const retained = archiveNews(first, [syndicated], companies, { now: '2026-10-23T00:00:00Z', officialSources: [official] });
  assert.equal(retained.length, 1); assert.equal(retained[0].origin, 'official'); assert.equal(retained[0].associations[0].matchType, 'official');
});
test('explicitly private records cannot be promoted even in an offline fixture', () => {
  assert.equal(normalizePublicArticle(raw('a', { public: false })), null);
  assert.equal(normalizePublicArticle(raw('a', { visibility: 'private' })), null);
});
const { updateArchiveCoverage } = await import('../scripts/lib/venture-news-core.mjs');
test('truncated windows record persistent archive gaps without advancing complete-fetch watermark', () => {
  const old = [normalizePublicArticle(raw('old', { published_at: '2026-10-20T00:00:00Z' }))];
  const input = { items: [raw('new')], truncated: true, fetchedAt: '2026-10-23T00:00:00Z' };
  const first = updateArchiveCoverage({}, old, input, '2026-10-23T00:00:00Z');
  assert.equal(first.bootstrapIncomplete, true); assert.equal(first.gaps.length, 1); assert.equal(first.lastCompleteFetchAt, null);
  const second = updateArchiveCoverage({ archiveCoverage: first }, old, { ...input, truncated: false });
  assert.equal(second.gaps.length, 1); assert.equal(second.bootstrapIncomplete, true); assert.equal(second.lastCompleteFetchAt, input.fetchedAt);
  const overlap = updateArchiveCoverage({}, old, { ...input, items: [raw('old')] });
  assert.equal(overlap.gaps.length, 0);
});
test('explicit compound aliases exclude ordinary ouster and Xanadu usage', () => {
  const rows = compileAliases([
    { id: 'ouster', name: 'Ouster', match: ['Ouster lidar', 'Ouster Inc', 'Ouster激光雷达'] },
    { id: 'xanadu', name: 'Xanadu', match: ['Xanadu Quantum', 'Xanadu量子'] },
  ]);
  assert.deepEqual(matchCompanies({ title: 'Ouster of CEO after financing dispute', summary: '' }, rows), []);
  assert.deepEqual(matchCompanies({ title: 'Xanadu art exhibition', summary: '' }, rows), []);
  assert.equal(matchCompanies({ title: 'Ouster lidar expands', summary: '' }, rows)[0].companyId, 'ouster');
  assert.equal(matchCompanies({ title: 'Xanadu Quantum introduces a processor', summary: '' }, rows)[0].companyId, 'xanadu');
});
test('unrelated finance metadata cannot evict older company news at the archive size cap', () => {
  const [entry] = parseOfficialFeed('<rss><channel><item><title>A new robot platform</title><link>https://blogs.nvidia.com/blog/robot/</link><pubDate>Mon, 01 Jun 2026 10:00:00 GMT</pubDate></item></channel></rss>', official);
  const unrelated = ['a', 'b', 'c'].map((id) => raw(id, { original_title: 'A macroeconomic report', title: 'A macroeconomic report' }));
  const all = archiveNews([], [entry, ...unrelated], companies, { now: '2026-10-23T00:00:00Z', officialSources: [official], matchedOnly: false, maxArticles: 3 });
  assert.equal(all.length, 3); assert.equal(all.filter((item) => item.origin === 'official').length, 1);
});
test('GenRobot news requires an identifying brand, not German articles or telecom controllers', () => {
  const company = getVentures().find((row) => row.id === 'genrobot');
  assert.ok(company);
  const rows = compileAliases([company]);
  for (const title of ['Das Controller-Modul wird aktualisiert', 'A distributed antenna system uses a DAS Controller', 'Wie das Ego unsere Entscheidungen beeinflusst', 'Warum das DEX Modell wächst']) {
    assert.deepEqual(matchCompanies({ title, summary: '' }, rows), [], title);
    assert.deepEqual(matchCompanies({ title: 'Research update', summary: title }, rows), [], title);
  }
  for (const title of ['GenRobot releases its DAS Controller', '简智新创发布 DAS Dex 手部采集设备', 'Gen DAS adds a new egocentric data device']) {
    assert.equal(matchCompanies({ title, summary: '' }, rows)[0]?.companyId, 'genrobot', title);
  }
});
test('Rysen product news cannot be inferred from generic Apex hand tools', () => {
  const company = getVentures().find((row) => row.id === 'rysen');
  assert.ok(company);
  const rows = compileAliases([company]);
  const unrelated = 'Apex hand tools launch a new torque wrench';
  assert.deepEqual(matchCompanies({ title: unrelated, summary: '' }, rows), []);
  assert.deepEqual(matchCompanies({ title: 'Industrial product news', summary: unrelated }, rows), []);
  for (const title of ['Rysen Robotics introduces Apex Hand', 'Rysen Apex Hand adds tactile sensing', '源升智能发布新版 Apex Hand']) {
    assert.equal(matchCompanies({ title, summary: '' }, rows)[0]?.companyId, 'rysen', title);
  }
});
