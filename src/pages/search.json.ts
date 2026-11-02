import { getAllEntities, getTypeName } from '../lib/data';
import { getVentures, getTrack } from '../lib/ventures';
import { getDexterityForCompany } from '../lib/dexterity';

// 全站搜索的索引：构建期生成一个静态 JSON，页头搜索框首次聚焦时才下载。
// 逐一核实的排在前面、名册级在后，用数组而不是对象，5 千条压到最小。
// 字段顺序：[id, 简称, 全称（与简称相同时留空）, 分类, 牌照类型, 机构编码, 属地, 名册级?1:0, 状态, 上市代码, 链接（可选，默认 /org/<id>/）]
// 硬科技公司排在金融机构之后：简称放名称、全称放英文名、上市代码位放标签与产品型号。
export function GET() {
  const status = { active: 0, distressed: 1, exited: 2, merging: 2 } as const;
  const rows = getAllEntities()
    .sort((a, b) => Number(a.tier === 'mass') - Number(b.tier === 'mass'))
    .map((e) => [
      e.id,
      e.short,
      e.name === e.short ? '' : e.name,
      e.category,
      getTypeName(e.type),
      e.license_code ?? '',
      e.region ?? '',
      e.tier === 'mass' ? 1 : 0,
      status[e.status ?? 'active'] ?? 0,
      e.listed?.join(' ') ?? '',
    ]);
  for (const v of getVentures()) {
    const dex = getDexterityForCompany(v.id);
    const trackName = getTrack(v.track)?.name ?? '硬科技';
    const extraTerms = [
      ...(v.tags ?? []),
      ...(v.aliases ?? []),
      ...(v.match ?? []),
      ...dex.roles.map((r) => r.product),
      ...dex.products.map((p) => p.product),
    ].join(' ');
    rows.push([
      v.id,
      v.name,
      v.en ?? '',
      'venture',
      trackName,
      '',
      v.country || (v.region === 'cn' ? '国内' : '海外'),
      0,
      0,
      extraTerms,
      `/venture/${v.id}/`,
    ]);
  }
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
}
