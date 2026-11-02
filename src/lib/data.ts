import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const DATA_DIR = path.join(process.cwd(), 'data');
const GROUPS_DIR = path.join(DATA_DIR, 'groups');
const REGISTRY_DIR = path.join(DATA_DIR, 'registry');

export interface Source {
  title: string;
  url: string;
  date?: string;
}

export interface LicenseType {
  id: string;
  name: string;
  /** 该牌照类型的说明。持股类、易混淆类的界定写在这里。 */
  desc?: string;
  /**
   * 明确不收录的牌照类型及其理由。
   * 写清楚"为什么不收"，比从分类里悄悄删掉更有用——
   * 找典当行的人应该得到一个解释，而不是一个空的分类。
   */
  outOfScope?: string;
}

export interface Category {
  id: string;
  name: string;
  en?: string;
  desc: string;
  types: LicenseType[];
}

export interface Taxonomy {
  version: number;
  updated: string;
  note: string;
  categories: Category[];
}

/** 关系类型：control = 控股/实际控制；affiliate = 参股或品牌关联但不控股 */
export type Relation = 'control' | 'affiliate';

/**
 * 持股口径。这一栏是必须的：同一集团里，"直接持股方的比例"和
 * "集团各通道合计比例"会差出十几个百分点（例如招商银行直接 4.55%、合计 26.32%），
 * 不标口径就没法横向比较。
 */
export type StakeBasis = 'direct' | 'aggregate';

/**
 * 存续状态。
 * - active：正常经营
 * - distressed：被接管、破产重整或清算程序中，业务停摆但法人资格还在
 * - exited：已解散、被合并或注销，法人资格消灭
 * - merging：正在合并
 * 把 distressed 和 exited 分开，是因为这两件事对读者的含义完全不同：
 * 前者牌照还在、还能重整复活，后者已经不存在了。
 */
export type Status = 'active' | 'distressed' | 'exited' | 'merging';

/**
 * 收录深度。
 * - detailed（默认）：逐一核实过官网、经营情况、来源
 * - mass：从监管名单批量导入的名册级记录，只有名称、机构编码、牌照类型、监管单位。
 *   农商行、村镇银行这类一个序列就上千家，逐个上网核实不现实——
 *   与其不收，不如收进来但把"深度不够"这件事标在明面上。
 */
export type Tier = 'detailed' | 'mass';

export interface Entity {
  id: string;
  name: string;
  short: string;
  category: string;
  type: string;
  license_code?: string;
  regulator?: string;
  founded?: number;
  listed?: string[];
  website?: string;
  intro: string;
  business?: string[];
  parent?: string;
  stake?: number;
  stake_asof?: string;
  stake_basis?: StakeBasis;
  held_via?: string;
  note?: string;
  relation?: Relation;
  status?: Status;
  tier?: Tier;
  /** 监管责任单位对应的属地，名册级记录用来分组 */
  region?: string;
  sources: Source[];
}

export interface Collection {
  id: string;
  name: string;
  short: string;
  en?: string;
  nature?: string;
  founded?: number;
  hq?: string;
  website?: string;
  financial_platform?: string;
  intro: string;
  is_group: boolean;
  sources: Source[];
  entities: Entity[];
}

function readYaml<T>(file: string): T {
  return tidyDeep(YAML.parse(fs.readFileSync(file, 'utf8'))) as T;
}

/**
 * 中文正文的兜底清理。
 *
 * 起因：YAML 的 `>-` 折叠标量会把源码里的换行变成一个空格，于是硬折行的中文段落
 * 会变成「……接管， 目前处于风险处置阶段」这种带多余空格的文本。数据源是人写的，
 * 不可能要求每个人都把长句写成一行，所以在加载时统一收掉。
 *
 * 只动中文标点与中文之间的空白，不碰 ASCII——YAML 的键与数字格式都不受影响。
 */
const CJK = '\\u4e00-\\u9fff';
const TIDY_RULES: Array<[RegExp, string]> = [
  [new RegExp(`([，。、；：）】》])[ \\t]+(?=[${CJK}])`, 'g'), '$1'],
  [new RegExp(`([，。、；：）】》])\\n[ \\t]+(?=[${CJK}])`, 'g'), '$1'],
  [new RegExp(`([${CJK}])[ \\t]+([，。、；：）】》])`, 'g'), '$1$2'],
];

function tidyText(s: string): string {
  let out = s;
  for (const [re, rep] of TIDY_RULES) out = out.replace(re, rep);
  return out;
}

function tidyDeep<T>(v: T): T {
  if (typeof v === 'string') return tidyText(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => tidyDeep(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = tidyDeep(val);
    return out as T;
  }
  return v;
}

function listYaml(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();
}

let _taxonomy: Taxonomy | null = null;
export function getTaxonomy(): Taxonomy {
  if (!_taxonomy) _taxonomy = readYaml<Taxonomy>(path.join(DATA_DIR, 'taxonomy.yaml'));
  return _taxonomy;
}

let _collections: Collection[] | null = null;
let _registryDropped: string[] = [];
export function getRegistryDropped(): string[] {
  getCollections();
  return _registryDropped;
}

/**
 * 机构名归一化，只用来判断"这两条是不是同一家"。
 * 刻意保守：只剥掉通用的公司后缀和括号里的地名/中国字样，不做模糊匹配——
 * 宁可漏判让人工复核，也不要误把两家不同机构合并掉。
 */
function normalizeName(s: string): string {
  // 刻意不剥括号内容。早期版本会把「中信证券（山东）有限责任公司」剥成「中信证券」，
  // 于是它被当成「中信证券股份有限公司」的重复项静默合并掉——一家真实存在的
  // 证券公司就这么从图谱里消失了。括号里装的常常正是区分两家机构的关键信息
  // （山东、中国、香港），所以一律不剥。宁可漏判让人工复核，也不要误合并。
  return s
    .replace(/股份有限公司|有限责任公司|有限公司|集团|公司/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function getCollections(): Collection[] {
  if (_collections) return _collections;
  const out: Collection[] = [];

  // 监管与基础设施：没有 group 头，只有 entities
  const supFile = path.join(DATA_DIR, 'supervision.yaml');
  if (fs.existsSync(supFile)) {
    const raw = readYaml<{ note?: string; sources?: Source[]; entities: Entity[] }>(supFile);
    out.push({
      id: 'supervision',
      name: '监管与基础设施',
      short: '监管与基础设施',
      en: 'Supervision & Market Infrastructure',
      nature: '公共部门与市场基础设施',
      intro:
        raw.note ??
        '定规则、发牌照、办登记清算的机构。它们不直接做业务，但决定了谁能做、能做什么。',
      is_group: false,
      sources: raw.sources ?? [],
      entities: raw.entities ?? [],
    });
  }

  for (const f of listYaml(GROUPS_DIR)) {
    const raw = readYaml<{ group: Omit<Collection, 'is_group' | 'entities'>; entities: Entity[] }>(
      path.join(GROUPS_DIR, f),
    );
    out.push({ ...raw.group, is_group: true, entities: raw.entities ?? [] });
  }

  // 全牌照名录制：registry/ 下的所有文件合成一个集合。
  // 集团文件里的机构是"带股权关系的完整记录"，名录制里如果再出现一次就是重复，
  // 所以按机构名去重，保留集团版本（信息更全）。
  const regEntities: Entity[] = [];
  const regSources: Source[] = [];
  const regNotes: string[] = [];
  for (const f of listYaml(REGISTRY_DIR)) {
    const raw = readYaml<{ note?: string; sources?: Source[]; entities: Entity[] }>(
      path.join(REGISTRY_DIR, f),
    );
    if (raw.note) regNotes.push(raw.note.replace(/\s+/g, ' ').trim());
    regSources.push(...(raw.sources ?? []));
    regEntities.push(...(raw.entities ?? []));
  }

  if (regEntities.length > 0) {
    const takenExact = new Set<string>();
    const takenNorm = new Map<string, string>();
    for (const col of out) {
      for (const e of col.entities) {
        takenExact.add(e.name);
        takenExact.add(e.short);
        takenNorm.set(normalizeName(e.name), `${col.id}/${e.id}｜${e.name}`);
        takenNorm.set(normalizeName(e.short), `${col.id}/${e.id}｜${e.short}`);
      }
    }

    const kept: Entity[] = [];
    _registryDropped = [];
    for (const e of regEntities) {
      // 四个判定按可信度排序：完全同名 → 简称相同 → 归一化后同名。
      // 每条都记录"被谁顶掉了"，方便人工复核去重是不是判错了。
      const hit =
        (takenExact.has(e.name) && ['同名', takenExact] as const) ||
        (takenExact.has(e.short) && ['简称相同', takenExact] as const) ||
        (takenNorm.has(normalizeName(e.name)) && ['归一化同名', takenNorm] as const) ||
        (takenNorm.has(normalizeName(e.short)) && ['归一化简称相同', takenNorm] as const) ||
        null;
      if (hit) {
        const [kind, pool] = hit;
        const winner =
          (pool as Set<string>).has(e.name) || (pool as Map<string, string>).has(e.name)
            ? e.name
            : e.short;
        const matched =
          pool instanceof Map ? (pool.get(normalizeName(winner)) ?? '?') : (winner as string);
        _registryDropped.push(`${kind}｜${e.name}（${e.id}） ← 保留 ${matched}`);
        continue;
      }
      kept.push(e);
    }

    out.push({
      id: 'registry',
      name: '全牌照名录',
      short: '全牌照名录',
      en: 'License Registry',
      nature: `${kept.length} 家持牌法人`,
      intro: regNotes.join(' ') || '按牌照序列收全的机构名册。这些机构大多不属于某个金融集团，因此没有股权谱系。',
      is_group: false,
      sources: regSources,
      entities: kept,
    });
  }

  _collections = out;
  return out;
}

// ── 构建期数据校验：宁可构建失败，也不要上线错数据 ──────────────────
const _warnings: string[] = [];
export function getWarnings(): string[] {
  validateData();
  return _warnings;
}

let _validated = false;
export function validateData(): void {
  if (_validated) return;
  const tax = getTaxonomy();
  const collections = getCollections();
  const errors: string[] = [];

  const typeIndex = new Map<string, { cat: string; name: string }>();
  for (const cat of tax.categories) {
    for (const t of cat.types) {
      if (typeIndex.has(t.id)) errors.push(`taxonomy: type id 重复 → ${t.id}`);
      typeIndex.set(t.id, { cat: cat.id, name: t.name });
    }
  }

  const seenIds = new Map<string, string>();

  for (const col of collections) {
    const localIds = new Set(col.entities.map((e) => e.id));

    for (const e of col.entities) {
      const where = `${col.id}/${e.id}`;

      if (!e.id || !e.name || !e.short) errors.push(`${where}: id/name/short 不能为空`);
      if (!e.intro || e.intro.trim().length < 8) errors.push(`${where}: intro 缺失或过短`);

      const prev = seenIds.get(e.id);
      if (prev) errors.push(`${where}: 机构 id 全局重复，已出现在 ${prev}`);
      seenIds.set(e.id, where);

      const t = typeIndex.get(e.type);
      if (!t) {
        errors.push(`${where}: type "${e.type}" 不在 taxonomy 里`);
      } else if (t.cat !== e.category) {
        errors.push(`${where}: category "${e.category}" 与 type "${e.type}" 所属的 "${t.cat}" 不一致`);
      }

      if (!e.sources || e.sources.length === 0) {
        errors.push(`${where}: 缺 sources——每条数据都必须能点回来源`);
      } else {
        for (const s of e.sources) {
          if (!s.url || !/^https?:\/\//.test(s.url)) errors.push(`${where}: source url 非法 → ${s.url}`);
          if (!s.title) errors.push(`${where}: source 缺 title`);
        }
      }

      if (e.website && !/^https?:\/\//.test(e.website)) {
        errors.push(`${where}: website 必须以 http(s):// 开头 → ${e.website}`);
      }

      // 机构编码必须写成字符串。写成裸数字会被 YAML 当整数解析，
      // 000017 直接变成 17、前导零全丢——这个坑真的踩过一次。
      if (e.license_code !== undefined) {
        if (typeof e.license_code !== 'string') {
          errors.push(`${where}: license_code 必须是字符串（加引号），当前是 ${typeof e.license_code} → ${e.license_code}`);
        } else if (!/^[A-Za-z0-9]{4,24}$/.test(e.license_code)) {
          errors.push(`${where}: license_code 格式可疑 → "${e.license_code}"`);
        }
      }

      if (e.parent && e.parent !== 'ROOT' && !localIds.has(e.parent)) {
        errors.push(`${where}: parent "${e.parent}" 悬空，本集合内不存在该 id`);
      }

      if (e.stake !== undefined && (typeof e.stake !== 'number' || e.stake <= 0 || e.stake > 100)) {
        errors.push(`${where}: stake 必须是 0–100 的数字 → ${e.stake}`);
      }

      // 100% 是结构性事实，不必标注时点。非全资的比例会随增资/减持变化：
      // 有确切日期的照实写；查不到日期的进警告清单，界面会打上"未标注时点"记号——
      // 宁可让读者看见这个缺口，也不编一个日期出来。
      if (e.stake !== undefined && e.stake < 100 && !e.stake_asof) {
        _warnings.push(`${where}: stake=${e.stake}% 未标注 stake_asof，界面将标记为"未标注时点"`);
      }

      // 合计口径必须写清是哪几条通道加出来的，否则读者无法复核。
      if (e.stake_basis === 'aggregate' && !e.held_via) {
        errors.push(`${where}: stake_basis=aggregate 必须在 held_via 写清合计的持股通道`);
      }

      if (e.status && !['active', 'distressed', 'exited', 'merging'].includes(e.status)) {
        errors.push(`${where}: status "${e.status}" 非法，只能是 active / distressed / exited / merging`);
      }

      if (e.tier && !['detailed', 'mass'].includes(e.tier)) {
        errors.push(`${where}: tier "${e.tier}" 非法，只能是 detailed / mass`);
      }

      // 名册级记录靠 region 分组展示，缺了就没法归位。
      if (e.tier === 'mass' && !e.region) {
        errors.push(`${where}: tier=mass 必须给 region`);
      }

      // 已退出的主体必须解释为什么还留在图谱里。
      // 情形比想象的多：解散、注销、被合并、更名、接管、破产重整、清算、停业。
      if (
        e.status &&
        e.status !== 'active' &&
        !e.note &&
        !/解散|注销|合并|退出|更名|接管|重整|破产|清算|撤销|停业|风险处置|停止/.test(e.intro)
      ) {
        errors.push(`${where}: status=${e.status} 必须在 note 或 intro 里说明退出情形`);
      }
    }

    // 环检测
    const byId = new Map(col.entities.map((e) => [e.id, e]));
    for (const e of col.entities) {
      const walked = new Set<string>([e.id]);
      let cursor = e.parent;
      while (cursor && cursor !== 'ROOT') {
        if (walked.has(cursor)) {
          errors.push(`${col.id}/${e.id}: parent 链存在环`);
          break;
        }
        walked.add(cursor);
        cursor = byId.get(cursor)?.parent;
      }
    }
  }

  if (errors.length) {
    throw new Error(
      `数据校验未通过（${errors.length} 项）：\n` +
        errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'),
    );
  }
  _validated = true;
}

// ── 派生视图 ──────────────────────────────────────────────────────
export function getAllEntities(): Array<Entity & { collectionId: string; collectionName: string }> {
  validateData();
  return getCollections().flatMap((c) =>
    c.entities.map((e) => ({ ...e, collectionId: c.id, collectionName: c.short })),
  );
}

export function getTypeName(typeId: string): string {
  for (const c of getTaxonomy().categories) {
    const t = c.types.find((x) => x.id === typeId);
    if (t) return t.name;
  }
  return typeId;
}

/**
 * 名册级（tier: mass）和逐一核实（detailed）分开取。
 * 前者一个序列就上千家，塞进同一个列表页会让页面膨胀到几 MB、
 * DOM 到几万个节点，所以各自走各自的页面。
 */
export function getDetailedEntities(): Array<Entity & { collectionId: string; collectionName: string }> {
  return getAllEntities().filter((e) => e.tier !== 'mass');
}

export function getMassEntities(): Array<Entity & { collectionId: string; collectionName: string }> {
  return getAllEntities().filter((e) => e.tier === 'mass');
}

export function getCategory(catId: string): Category | undefined {
  return getTaxonomy().categories.find((c) => c.id === catId);
}

// 分类图标用一个字。「金融控股公司」取「控」，避免和其它「金」字头混淆。
export function getCategoryGlyph(catId: string): string {
  if (catId === 'holding') return '控';
  return getCategory(catId)?.name[0] ?? '·';
}

export interface Stats {
  entities: number;
  active: number;
  exited: number;
  distressed: number;
  detailed: number;
  mass: number;
  groups: number;
  sources: number;
  licensed: number;
  withWebsite: number;
  byCategory: Array<{ category: Category; count: number; types: Array<{ type: LicenseType; count: number }> }>;
}

export function getStats(): Stats {
  const all = getAllEntities();
  const tax = getTaxonomy();
  const byCategory = tax.categories.map((category) => {
    const inCat = all.filter((e) => e.category === category.id);
    return {
      category,
      count: inCat.length,
      types: category.types
        .map((type) => ({ type, count: inCat.filter((e) => e.type === type.id).length }))
        .filter((x) => x.count > 0),
    };
  });
  const sourceUrls = new Set(all.flatMap((e) => e.sources.map((s) => s.url)));
  // 已退出（法人资格消灭）和风险处置中（法人还在、业务停摆）是两件事，分开计数。
  const exited = all.filter((e) => e.status === 'exited' || e.status === 'merging').length;
  const distressed = all.filter((e) => e.status === 'distressed').length;
  const mass = all.filter((e) => e.tier === 'mass').length;
  return {
    entities: all.length,
    active: all.length - exited - distressed,
    exited,
    distressed,
    detailed: all.length - mass,
    mass,
    groups: getCollections().filter((c) => c.is_group).length,
    sources: sourceUrls.size,
    licensed: all.filter((e) => e.license_code).length,
    withWebsite: all.filter((e) => e.website).length,
    byCategory,
  };
}

export function getEntityUrl(e: { id: string }): string {
  return `/org/${e.id}/`;
}

// ── 持股比例展示 ──────────────────────────────────────────────────
export interface Highlight {
  id: string;
  title: string;
  body: string;
  year?: number;
  link?: string;
  source: Source;
}

export function getHighlights(): Highlight[] {
  const f = path.join(DATA_DIR, 'highlights.yaml');
  if (!fs.existsSync(f)) return [];
  return readYaml<Highlight[]>(f);
}

/**
 * 统一持股比例的显示口径。三件事必须让读者看见：
 * 是不是"合计"口径、有没有标注时点、以及比例本身。
 */
export function formatStake(e: Pick<Entity, 'stake' | 'stake_asof' | 'stake_basis'>): string | null {
  if (e.stake === undefined) return null;
  const n = Number.isInteger(e.stake)
    ? String(e.stake)
    : e.stake.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${e.stake_basis === 'aggregate' ? '合计' : ''}${n}%`;
}

/** 100% 属结构性事实，无需时点；非全资又没写 asof 的，界面要打星号提示 */
export function stakeNeedsDate(e: Pick<Entity, 'stake' | 'stake_asof'>): boolean {
  return e.stake !== undefined && e.stake < 100 && !e.stake_asof;
}
