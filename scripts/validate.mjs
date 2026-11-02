#!/usr/bin/env node
/**
 * 数据校验。构建时也会自动跑（validateData 在加载数据时调用），
 * 这里提供单独运行的入口，方便只改数据不改代码时快速自检。
 *   node scripts/validate.mjs
 */
import { validateData, getWarnings, getStats, getRegistryDropped } from '../src/lib/data.ts';
import { validateVentures } from '../src/lib/ventures.ts';
import { getAllEntities } from '../src/lib/data.ts';

try {
  validateData();
} catch (err) {
  console.error('✗ 数据校验未通过\n');
  console.error(err.message);
  process.exit(1);
}

let vStats;
try {
  vStats = validateVentures(getAllEntities().map((e) => e.id));
} catch (err) {
  console.error('✗ 硬科技图谱数据校验未通过\n');
  console.error(err.message);
  process.exit(1);
}

const stats = getStats();
console.log('✓ 数据校验通过');
console.log(
  `  ${stats.entities} 个持牌法人主体` +
    `（正常经营 ${stats.active} / 风险处置 ${stats.distressed} / 已退出 ${stats.exited}）`,
);
console.log(`  其中名册级 ${stats.mass} 家、逐一核实 ${stats.detailed} 家`);
console.log(`  ${stats.sources} 个去重来源`);
console.log(`  名录制去重合并 ${getRegistryDropped().length} 条`);
console.log(`  硬科技图谱 ${vStats.ventures} 家公司、${vStats.events} 条动态、${vStats.sources} 个来源`);

const warns = getWarnings();
if (warns.length) {
  console.log(`\n⚠ ${warns.length} 条警告（不阻断构建）`);
  for (const w of warns.slice(0, 10)) console.log(`  ${w}`);
  if (warns.length > 10) console.log(`  … 另有 ${warns.length - 10} 条`);
}
