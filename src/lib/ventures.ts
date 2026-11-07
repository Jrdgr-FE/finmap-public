import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/**
 * 硬科技图谱（一级市场初创公司）的数据层。
 *
 * 和金融机构那套 Entity 完全分开：初创公司没有牌照、机构编码和股权链，
 * 核心信息是「按时间发生的事件」——融资、发布、量产、上市进程。
 * 硬塞进 Entity 会把两边的口径都搞乱，所以单独一套类型和校验，
 * 只共用页面外壳、样式和全站搜索。
 */

const VENTURES_DIR = path.join(process.cwd(), 'data', 'ventures');

export interface VSource {
  title: string;
  url: string;
  date?: string;
}

export interface Segment {
  id: string;
  name: string;
  desc?: string;
}

export interface Track {
  id: string;
  name: string;
  desc: string;
  segments: Segment[];
}

export type EventKind = 'funding' | 'product' | 'model' | 'deployment' | 'ipo' | 'people';

/**
 * confirmed：公司官宣或多家媒体确认；reported：传闻、洽谈中或单一来源。
 * 一级市场的估值和轮次大量来自「据报道」，不标出来读者会把传闻当事实。
 */
export type EventStatus = 'confirmed' | 'reported';

export interface Money {
  value: number;
  /** 保留原币种：亿元 | 十亿美元 | 百万美元。展示时不换算 */
  unit: string;
}

export interface VEvent {
  /** YYYY、YYYY-MM 或 YYYY-MM-DD。只知道月份就写月份，不编一个日子 */
  date: string;
  kind: EventKind;
  title: string;
  amount?: Money;
  investors?: string[];
  status: EventStatus;
  sources: VSource[];
}

export interface Valuation extends Money {
  asof: string;
  status: EventStatus;
  /** 口径补充：超过、约、投后…… */
  note?: string;
}

export interface Venture {
  id: string;
  name: string;
  en?: string;
  region: 'cn' | 'global';
  track: string;
  segment: string;
  tags?: string[];
  aliases?: string[];
  /** Editorial override: replaces automatic name/en/aliases when matching public news. */
  match?: string[];
  intro: string;
  founders?: string[];
  founded?: number;
  valuation?: Valuation;
  events: VEvent[];
  /** Profile facts and news are separate from reviewed corporate events. */
  website?: string;
  country?: string;
  sources?: VSource[];
  verifiedAt?: string;
  coverage?: 'profile' | 'event-reviewed';
  memberships?: Array<{ track: string; segment: string }>;
}

export type RelationshipKind = 'supplier' | 'customer' | 'partner' | 'investor' | 'subsidiary';
export interface VentureRelationship {
  id: string;
  from: string;
  to: string;
  type: RelationshipKind;
  title: string;
  date: string;
  sources: VSource[];
}


export type VentureEnrichment = { id: string } & Pick<Venture, 'website' | 'country' | 'verifiedAt' | 'sources' | 'memberships'>;

/** Add independently reviewed profile evidence without rewriting legacy narrative or events. */
export function applyVentureEnrichments(ventures: Venture[], enrichments: VentureEnrichment[]): Venture[] {
  const allowed = new Set(['id', 'website', 'country', 'verifiedAt', 'sources', 'memberships']);
  const byId = new Map(ventures.map((v) => [v.id, { ...v }]));
  for (const enrichment of enrichments) {
    if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)) throw new Error('Profile enrichment must be an object');
    for (const key of Object.keys(enrichment)) if (!allowed.has(key)) throw new Error(`Enrichment ${enrichment.id}: forbidden field ${key}`);
    const venture = byId.get(enrichment.id);
    if (!venture) throw new Error(`Enrichment ${enrichment.id}: unknown company ID`);
    for (const field of ['website', 'country', 'verifiedAt'] as const) {
      const value = enrichment[field];
      if (value !== undefined) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`Enrichment ${enrichment.id}: invalid ${field}`);
        venture[field] = value;
      }
    }
    if (enrichment.sources !== undefined) {
      if (!Array.isArray(enrichment.sources)) throw new Error(`Enrichment ${enrichment.id}: sources must be an array`);
      const sources = [...(venture.sources ?? []), ...enrichment.sources];
      venture.sources = sources.filter((source, i) => sources.findIndex((other) => other.url === source.url) === i);
    }
    if (enrichment.memberships !== undefined) {
      if (!Array.isArray(enrichment.memberships)) throw new Error(`Enrichment ${enrichment.id}: memberships must be an array`);
      const memberships = [...(venture.memberships ?? []), ...enrichment.memberships];
      venture.memberships = memberships.filter((m, i) => memberships.findIndex((other) => other.track === m.track && other.segment === m.segment) === i);
    }
  }
  return ventures.map((v) => byId.get(v.id)!);
}

interface VenturesFile {
  version?: number;
  updated?: string;
  tracks?: Track[];
  companies?: Venture[];
}

export const KIND_LABEL: Record<EventKind, string> = {
  funding: '融资',
  product: '产品',
  model: '模型',
  deployment: '落地',
  ipo: '上市',
  people: '团队',
};

export const REGION_LABEL = { cn: '国内', global: '海外' } as const;

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const KINDS = new Set(Object.keys(KIND_LABEL));

function validHttpUrl(raw: string | undefined): boolean {
  try { const url = new URL(raw ?? ''); return /^https?:$/.test(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function validDate(value: string | undefined): boolean {
  if (!value || !DATE_RE.test(value)) return false;
  const complete = value.length === 4 ? `${value}-01-01` : value.length === 7 ? `${value}-01` : value;
  const parsed = new Date(complete);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === complete;
}


let _cache: { updated: string; tracks: Track[]; ventures: Venture[] } | null = null;

function load() {
  if (_cache) return _cache;
  const tracks: Track[] = [];
  const ventures: Venture[] = [];
  let updated = '';
  if (fs.existsSync(VENTURES_DIR)) {
    // candidates.json 是待审线索，不进网站
    const files = fs
      .readdirSync(VENTURES_DIR)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .sort();
    for (const f of files) {
      const doc = YAML.parse(fs.readFileSync(path.join(VENTURES_DIR, f), 'utf8')) as VenturesFile;
      if (doc?.updated && doc.updated > updated) updated = String(doc.updated);
      tracks.push(...(doc?.tracks ?? []));
      ventures.push(...(doc?.companies ?? []));
    }
  }
  if (fs.existsSync(VENTURES_DIR)) {
    for (const filename of fs.readdirSync(VENTURES_DIR).filter((name) => name.endsWith('-enrichment.json')).sort()) {
      const enrichments = JSON.parse(fs.readFileSync(path.join(VENTURES_DIR, filename), 'utf8'));
      if (!Array.isArray(enrichments)) throw new Error(`${filename}: enrichment file must be an array`);
      const enriched = applyVentureEnrichments(ventures, enrichments);
      ventures.splice(0, ventures.length, ...enriched);
      for (const entry of enrichments) if (entry.verifiedAt && entry.verifiedAt > updated) updated = entry.verifiedAt;
    }
  }
  for (const v of ventures) {
    v.events = [...(v.events ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  }
  _cache = { updated, tracks, ventures };
  return _cache;
}

export function getTracks(): Track[] {
  return load().tracks;
}

export function getVentures(): Venture[] {
  return load().ventures;
}

/** Primary membership is retained for old URLs; additional memberships allow real cross-sector mapping. */
export function getMemberships(v: Venture): Array<{ track: string; segment: string }> {
  const entries = [{ track: v.track, segment: v.segment }, ...(v.memberships ?? [])];
  return entries.filter((entry, index) => entries.findIndex((other) => other.track === entry.track && other.segment === entry.segment) === index);
}

export function venturesForSegment(track: string, segment?: string): Venture[] {
  return getVentures().filter((v) => getMemberships(v).some((m) => m.track === track && (!segment || m.segment === segment)));
}

/** Only sourced relationship files are accepted. Co-membership never implies a supply contract. */
export function getRelations(companyId?: string): VentureRelationship[] {
  const relations: VentureRelationship[] = [];
  if (fs.existsSync(VENTURES_DIR)) {
    for (const filename of fs.readdirSync(VENTURES_DIR).filter((name) => /(?:^|-)relations\.json$/.test(name)).sort()) {
      const doc = JSON.parse(fs.readFileSync(path.join(VENTURES_DIR, filename), 'utf8'));
      relations.push(...(Array.isArray(doc) ? doc : doc.relations ?? []));
    }
  }
  validateRelationshipData(relations, getVentures().map((v) => v.id));
  return companyId ? relations.filter((r) => r.from === companyId || r.to === companyId) : relations;
}

export function validateRelationshipData(relations: VentureRelationship[], companyIds: Iterable<string>): void {
  const ids = new Set(companyIds), seen = new Set<string>();
  const kinds = new Set(['supplier', 'customer', 'partner', 'investor', 'subsidiary']);
  const errors: string[] = [];
  for (const r of relations) {
    if (!r.id || seen.has(r.id)) errors.push(`relationship ${r.id}: missing or duplicate id`);
    seen.add(r.id);
    if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to) errors.push(`relationship ${r.id}: invalid endpoints`);
    if (!kinds.has(r.type)) errors.push(`relationship ${r.id}: invalid type`);
    if (!r.title?.trim() || !validDate(r.date)) errors.push(`relationship ${r.id}: title and dated evidence required`);
    if (!r.sources?.length || r.sources.some((s) => !s.title?.trim() || !validHttpUrl(s.url) || !validDate(s.date))) errors.push(`relationship ${r.id}: dated public sources required`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

export function getVenturesUpdated(): string {
  return load().updated;
}

export function getTrack(id: string): Track | undefined {
  return getTracks().find((t) => t.id === id);
}

export function getSegment(trackId: string, segId: string): Segment | undefined {
  return getTrack(trackId)?.segments.find((s) => s.id === segId);
}

export function getVentureUrl(v: { id: string }): string {
  return `/venture/${v.id}/`;
}

export function latestEvent(v: Venture): VEvent | undefined {
  return v.events[0];
}

/**
 * 产业链环节的配色槽位（1–8），按环节在本赛道里的顺序分配：每条赛道的第一个
 * 环节都是 1 号色，以此类推。赛道之间颜色会重复，但同一个环节在任何页面上
 * 都是同一种颜色。超过 8 个环节的返回 0（中性灰）。颜色本身在 ventures.css 里定义。
 */
export function segmentSlot(trackId: string, segId: string): number {
  const i = getTrack(trackId)?.segments.findIndex((s) => s.id === segId) ?? -1;
  return i >= 0 && i < 8 ? i + 1 : 0;
}

/** 「上游·部件与数据」→ { stage: '上游', name: '部件与数据' }；没有分隔符的整段当名称 */
export function splitSegmentName(name: string): { stage?: string; name: string } {
  const i = name.indexOf('·');
  return i > 0 ? { stage: name.slice(0, i), name: name.slice(i + 1) } : { name };
}

const INITIAL_STOP = new Set(['ai', 'labs', 'technologies', 'robotics', 'humanoids', 'inc']);

/** 头像上的字：中文名取首字，英文名取首字母（两个实词取两个首字母，1X、AMI 这类缩写原样） */
export function ventureInitials(v: Venture): string {
  const name = v.name.replace(/（.*?）|\(.*?\)/g, '').trim();
  if (!/^[\x00-\x7f]/.test(name)) return name.slice(0, 1);
  const words = name.split(/\s+/);
  if (/^[A-Z0-9]{2,3}$/.test(words[0])) return words[0];
  const second = words[1] && !INITIAL_STOP.has(words[1].toLowerCase()) ? words[1][0] : '';
  return (words[0][0] + second).toUpperCase();
}

/** 估值折算后是否在百亿元以上（排序口径，见 SORT_FX_NOTE） */
export function isDecacorn(v: Venture): boolean {
  return valuationSortKey(v) >= 100;
}

/** 全部事件按日期倒序，带上所属公司 */
export function getTimeline(filter?: (v: Venture) => boolean): Array<VEvent & { venture: Venture }> {
  return getVentures()
    .filter((v) => (filter ? filter(v) : true))
    .flatMap((v) => v.events.map((e) => ({ ...e, venture: v })))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 排序用的近似人民币亿元值。页面上展示原币种，这个数只用来排序 */
const USD_CNY = 7.1;
export function valuationSortKey(v: Venture): number {
  const val = v.valuation;
  if (!val) return -1;
  switch (val.unit) {
    case '亿元':
      return val.value;
    case '亿港元':
      return val.value * 0.92;
    case '十亿美元':
      return val.value * 10 * USD_CNY;
    case '百万美元':
      return (val.value / 100) * USD_CNY;
    default:
      return -1;
  }
}
export const SORT_FX_NOTE = `排序时按 1 美元 ≈ ${USD_CNY} 元粗略折算，页面展示保留原币种。`;

export function formatMoney(m: Money): string {
  if (m.unit === '亿元') return `${m.value} 亿元`;
  if (m.unit === '十亿美元') return `$${m.value}B`;
  if (m.unit === '百万美元') return m.value >= 1000 ? `$${(m.value / 1000).toFixed(2).replace(/\.?0+$/, '')}B` : `$${m.value}M`;
  return `${m.value} ${m.unit}`;
}

export function formatValuation(v?: Valuation): string | null {
  if (!v) return null;
  const note = v.note ? `${v.note} ` : '';
  return `${note}${formatMoney(v)}`;
}

export interface CapitalInfo {
  label: string;
  fullText: string;
  cardText: string;
  shortText: string;
  isListed: boolean;
}

const CORPORATE_CAPITAL_MAP: Record<string, { fullText: string; cardText: string; shortText: string }> = {
  'deepseek': {
    fullText: '幻方量化全资孵化（未对外独立股权融资）',
    cardText: '幻方量化全资孵化',
    shortText: '幻方量化孵化',
  },
  'google-deepmind': {
    fullText: 'Alphabet (NASDAQ: GOOGL) 核心 AI 事业部',
    cardText: 'Alphabet (GOOGL) 事业部',
    shortText: 'Alphabet 旗下',
  },
  'universal-robots': {
    fullText: 'Teradyne (NASDAQ: TER) 全资子公司',
    cardText: 'Teradyne (TER) 全资子公司',
    shortText: 'Teradyne 旗下',
  },
  'robbyant': {
    fullText: '蚂蚁集团旗下全资具身智能子公司',
    cardText: '蚂蚁集团全资子公司',
    shortText: '蚂蚁集团旗下',
  },
  'tianji-gento': {
    fullText: '长盈精密（300115.SZ）控股子公司',
    cardText: '长盈精密控股子公司',
    shortText: '长盈精密控股',
  },
  'wonik-robotics': {
    fullText: '韩国 Wonik 集团旗下机器人子公司',
    cardText: 'Wonik 集团子公司',
    shortText: 'Wonik 旗下',
  },
  'schunk': {
    fullText: '德国雄克家族全资工业集团（非上市）',
    cardText: '非上市跨国工业集团',
    shortText: '非上市集团',
  },
};

export function getCapitalInfo(v: Venture): CapitalInfo {
  if (v.valuation) {
    const valStr = formatValuation(v.valuation)!;
    const moneyStr = formatMoney(v.valuation);
    const note = v.valuation.note || '';
    const isListed = /上市|\b\d{4,6}\.(?:SH|SZ|HK|TW|T)\b|\b(?:NASDAQ|NYSE|SIX|Euronext|东证|港股|科创板|创业板|上交所|深交所|MINIMAX-W)/i.test(note);
    if (isListed) {
      const tickerMatch = note.match(/\b(\d{4,6}\.(?:SH|SZ|HK|TW|T)|[A-Z]{2,5}(?=\s*·|$)|MINIMAX-W)\b/);
      const boardMatch = note.match(/^(科创板|创业板|港股|上交所|深交所|NASDAQ|NYSE)/);
      const prefix = tickerMatch ? tickerMatch[1] : boardMatch ? boardMatch[1] : '已上市';
      return {
        label: '上市与市值',
        fullText: `${valStr}（${v.valuation.asof}）`,
        cardText: valStr,
        shortText: `${prefix} · ${moneyStr}`,
        isListed: true,
      };
    }
    const shortNote = note && note.length <= 4 ? `${note} ` : '';
    return {
      label: '公开估值',
      fullText: `${valStr}（${v.valuation.asof}${v.valuation.status === 'reported' ? ' · 报道' : ''}）`,
      cardText: valStr,
      shortText: `${shortNote}${moneyStr}`,
      isListed: false,
    };
  }
  const corp = CORPORATE_CAPITAL_MAP[v.id];
  if (corp) {
    return { label: '资本属性', ...corp, isListed: false };
  }
  const fundEv = v.events.find((e) => e.kind === 'funding' || e.kind === 'ipo');
  if (fundEv) {
    const roundMatch = fundEv.title.match(/(Pre-[A-B]\+*\s*轮|[A-F]\+*\s*轮|天使轮|种子轮|战略(?:融资|投资)|Pre-seed|IPO)/i);
    const round = roundMatch ? roundMatch[1].replace(/\s+/g, '') : '股权融资';
    return {
      label: '融资与资本阶段',
      fullText: `已完成${round}（${fundEv.date}，具体估值未公开）`,
      cardText: `已完成${round}`,
      shortText: round,
      isListed: false,
    };
  }
  return {
    label: '融资与资本阶段',
    fullText: '非上市商业化企业（未公开具体估值）',
    cardText: '非上市 · 已商业化',
    shortText: '',
    isListed: false,
  };
}

/** 2026-10-13 → 2026.10.13；2026-06 → 2026.06；2026 → 2026 */
export function formatDate(d: string): string {
  return d.replaceAll('-', '.');
}

/** 距今天数（只精确到月或年的日期按该月或该年第一天算） */
export function daysAgo(d: string, now = new Date()): number {
  const [y, m = '01', day = '01'] = d.split('-');
  const t = Date.UTC(Number(y), Number(m) - 1, Number(day));
  return Math.floor((now.getTime() - t) / 86400000);
}

/**
 * 构建期校验。不过就构建失败——和机构数据同一个原则：
 * 宁可部署失败，也不要上线一条没有来源、没有时点的融资信息。
 */
export function validateVentures(existingIds: Iterable<string> = []): { ventures: number; events: number; sources: number } {
  const { tracks, ventures } = load();
  const errors: string[] = [];
  const trackIndex = new Map(tracks.map((t) => [t.id, t]));
  const taken = new Set(existingIds);
  const seen = new Set<string>();
  const urls = new Set<string>();
  let events = 0;

  const checkSources = (where: string, sources: VSource[] | undefined) => {
    if (!sources || sources.length === 0) {
      errors.push(`${where}: 至少需要一条来源`);
      return;
    }
    for (const s of sources) {
      try {
        const u = new URL(s.url);
        if (!validHttpUrl(u.href)) throw new Error();
        urls.add(s.url);
      } catch {
        errors.push(`${where}: 来源 URL 不合法 → ${s.url}`);
      }
      if (!s.title) errors.push(`${where}: 来源缺标题 → ${s.url}`);
    }
  };

  for (const t of tracks) {
    if (tracks.filter((other) => other.id === t.id).length > 1) errors.push(`track ${t.id}: 赛道 id 重复`);
    if (!t.segments?.length) errors.push(`track ${t.id}: 至少需要一个产业链环节`);
    if (new Set(t.segments?.map((segment) => segment.id)).size !== t.segments?.length) errors.push(`track ${t.id}: 环节 id 重复`);
  }

  for (const v of ventures) {
    const where = `venture ${v.id ?? '(无 id)'}`;
    if (!v.id || !/^[a-z0-9][a-z0-9-]*$/.test(v.id)) errors.push(`${where}: id 只能用小写字母、数字和连字符`);
    if (seen.has(v.id)) errors.push(`${where}: id 重复`);
    if (taken.has(v.id)) errors.push(`${where}: id 与金融机构重名`);
    seen.add(v.id);
    if (!v.name) errors.push(`${where}: 缺 name`);
    if (!v.intro) errors.push(`${where}: 缺 intro`);
    for (const field of ['aliases', 'match'] as const) {
      if (v[field] !== undefined && (!Array.isArray(v[field]) || v[field]!.some((value) => typeof value !== 'string' || !value.trim()))) errors.push(`${where}: ${field} 必须是非空字符串数组`);
    }
    if (v.region !== 'cn' && v.region !== 'global') errors.push(`${where}: region 必须是 cn 或 global`);
    const t = trackIndex.get(v.track);
    if (!t) errors.push(`${where}: track "${v.track}" 不存在`);
    else if (!t.segments.some((s) => s.id === v.segment)) errors.push(`${where}: segment "${v.segment}" 不在赛道 ${v.track} 里`);
    if (v.valuation) {
      if (!v.valuation.asof || !DATE_RE.test(String(v.valuation.asof))) errors.push(`${where}: 估值必须标时点 asof`);
      if (!['confirmed', 'reported'].includes(v.valuation.status)) errors.push(`${where}: 估值 status 必须是 confirmed 或 reported`);
    }
    if (v.website && !validHttpUrl(v.website)) errors.push(`${where}: website 必须是公开 HTTP(S) URL`);
    if (v.coverage && !['profile', 'event-reviewed'].includes(v.coverage)) errors.push(`${where}: coverage 不合法`);
    if (v.sources?.length) checkSources(`${where} 公司档案`, v.sources);
    if (v.verifiedAt && !validDate(v.verifiedAt)) errors.push(`${where}: verifiedAt 日期不合法`);
    if (!v.events?.length && (!v.sources?.length || !v.verifiedAt || v.coverage !== 'profile')) errors.push(`${where}: 无已审事件时必须有 profile 档案来源与核验日期`);
    if (v.coverage === 'event-reviewed' && !v.events?.length) errors.push(`${where}: event-reviewed 必须有已审事件`);
    for (const membership of getMemberships(v)) {
      if (!trackIndex.get(membership.track)?.segments.some((s) => s.id === membership.segment)) errors.push(`${where}: 额外赛道/环节 ${membership.track}/${membership.segment} 不存在`);
    }
    for (const [i, e] of (v.events ?? []).entries()) {
      events++;
      const ew = `${where} 事件#${i + 1}`;
      if (!DATE_RE.test(String(e.date))) errors.push(`${ew}: date 必须是 YYYY / YYYY-MM / YYYY-MM-DD → ${e.date}`);
      if (!KINDS.has(e.kind)) errors.push(`${ew}: kind "${e.kind}" 不合法`);
      if (!['confirmed', 'reported'].includes(e.status)) errors.push(`${ew}: status 必须是 confirmed 或 reported`);
      if (!e.title) errors.push(`${ew}: 缺 title`);
      checkSources(ew, e.sources);
    }
  }

  getRelations();
  if (errors.length) throw new Error(`硬科技图谱数据校验未通过（${errors.length} 条）：\n  ${errors.join('\n  ')}`);
  return { ventures: ventures.length, events, sources: urls.size };
}
