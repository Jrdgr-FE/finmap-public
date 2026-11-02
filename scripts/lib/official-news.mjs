import sax from 'sax';
import { createHash } from 'node:crypto';
import { canonicalUrl } from './venture-news-core.mjs';

/** RSS/Atom metadata only. Feed bodies, HTML, enclosures and remote entities are never imported. */
export function parseOfficialFeed(xml, source) {
  if (Buffer.byteLength(xml) > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Oversized feed or XML entities');
  const parser = sax.parser(true, { trim: true, xmlns: false });
  const stack = [], entries = [];
  let entry = null, entryDepth = 0, field = '', feedRoot = '';
  parser.onopentag = (node) => {
    const tag = node.name.toLowerCase().replace(/^.*:/, ''); stack.push(tag);
    if (stack.length === 1) feedRoot = tag;
    if ((tag === 'item' || tag === 'entry') && !entry) { entry = { title: '', link: '', pubdate: '', published: '', updated: '' }; entryDepth = stack.length; }
    else if (entry && stack.length === entryDepth + 1) {
      field = ['title', 'link', 'pubdate', 'published', 'updated'].includes(tag) ? tag : '';
      if (tag === 'link' && node.attributes.href && (!node.attributes.rel || node.attributes.rel === 'alternate')) entry.link = String(node.attributes.href);
    }
  };
  const append = (value) => { if (entry && field && stack.length === entryDepth + 1) entry[field] += value; };
  parser.ontext = append; parser.oncdata = append;
  parser.onclosetag = () => {
    if (entry && stack.length === entryDepth) { entries.push(entry); entry = null; field = ''; }
    else if (entry && stack.length === entryDepth + 1) field = '';
    stack.pop();
  };
  parser.write(xml).close();
  if (!['rss', 'feed', 'rdf'].includes(feedRoot)) throw new Error('Response is not an RSS/Atom feed');
  const result = [];
  for (const row of entries) {
    const url = canonicalUrl(row.link.trim()), title = row.title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const date = row.published || row.pubdate || row.updated;
    if (!url || !source.allowedHosts.includes(new URL(url).hostname) || !title || !date || !Number.isFinite(Date.parse(date))) continue;
    result.push({
      id: `official-${source.id}-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`,
      original_title: title, url, published_at: new Date(date).toISOString(), source_name: source.name,
      summary: '', origin: 'official', officialFeedId: source.id,
    });
  }
  return result;
}
export async function fetchOfficialFeed(source, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(source.url, { headers: { accept: 'application/rss+xml, application/atom+xml, text/xml', 'user-agent': 'FinMap-public-news-index/1.0 (+https://map.finhot.fun/)' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!source.allowedHosts.includes(new URL(response.url || source.url).hostname)) throw new Error('Feed redirected outside verified official hosts');
  if (Number(response.headers?.get?.('content-length') || 0) > 2_000_000) throw new Error('Feed too large');
  const xml = await response.text();
  const items = parseOfficialFeed(xml, source);
  if (!items.length) throw new Error('Feed has no valid dated official entries');
  return items;
}
