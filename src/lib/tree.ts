import type { Entity, StakeBasis, Status } from './data';
import { formatStake, stakeNeedsDate } from './data';

export interface TreeNode {
  id: string;
  short: string;
  name: string;
  category: string;
  type: string;
  stake?: number;
  stakeAsof?: string;
  stakeBasis?: StakeBasis;
  /** 已格式化的持股文本，含"合计"口径与未标注时点的星号 */
  stakeLabel?: string;
  stakeUndated: boolean;
  status?: Status;
  relation: 'control' | 'affiliate';
  website?: string;
  parentId: string | null;
  children: TreeNode[];
  depth: number;
  x: number;
  y: number;
  width: number;
  /** 从根到自身的 id 链，用于 hover 时高亮整条持股路径 */
  path: string[];
  isVirtualRoot: boolean;
  entityCount: number;
}

export interface TreeEdge {
  key: string;
  from: string;
  to: string;
  relation: 'control' | 'affiliate';
  stake?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  childPath: string[];
}

export interface TreeLayout {
  nodes: TreeNode[];
  edges: TreeEdge[];
  width: number;
  height: number;
  leafCount: number;
}

const NODE_H = 32;
const ROW_PITCH = 44;
const X_GAP = 52;
const PAD_X = 13;
const CHAR_W = 12.6;
const STAKE_W = 7.4;

/** 节点宽度按中文短名和持股标签估算，避免 SVG 里出现文字溢出 */
const textW = (s: string) =>
  [...s].reduce(
    (w, ch) => w + (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? CHAR_W : CHAR_W * 0.58),
    0,
  );

function measure(short: string, stakeLabel?: string): number {
  const stakePart = stakeLabel ? 11 + textW(stakeLabel) + 6 : 0;
  return Math.max(74, Math.round(PAD_X * 2 + textW(short) + stakePart));
}

/**
 * 把一个集团的主体按 parent 字段折成树，再做左右向的层次布局。
 * 叶子节点按顺序占一行，父节点纵向居中于其子树——这是最省地方也最好读的一种。
 */
export function layoutTree(entities: Entity[], rootLabel: string): TreeLayout {
  const byId = new Map<string, TreeNode>();

  for (const e of entities) {
    const stakeLabel = formatStake(e);
    const undated = stakeNeedsDate(e);
    byId.set(e.id, {
      id: e.id,
      short: e.short,
      name: e.name,
      category: e.category,
      type: e.type,
      stake: e.stake,
      stakeAsof: e.stake_asof,
      stakeBasis: e.stake_basis,
      stakeLabel: stakeLabel ? `${stakeLabel}${undated ? '*' : ''}` : undefined,
      stakeUndated: undated,
      status: e.status,
      relation: e.relation ?? 'control',
      website: e.website,
      parentId: null,
      children: [],
      depth: 0,
      x: 0,
      y: 0,
      width: measure(e.short, stakeLabel ? `${stakeLabel}${undated ? '*' : ''}` : undefined),
      path: [],
      isVirtualRoot: false,
      entityCount: 0,
    });
  }

  const root: TreeNode = {
    id: '__root__',
    short: rootLabel,
    name: rootLabel,
    category: 'holding',
    type: 'financial-holding',
    relation: 'control',
    parentId: null,
    children: [],
    depth: 0,
    x: 0,
    y: 0,
    width: measure(rootLabel),
    path: [],
    isVirtualRoot: true,
    stakeUndated: false,
    entityCount: entities.length,
  };

  for (const e of entities) {
    const node = byId.get(e.id)!;
    const parent = e.parent && e.parent !== 'ROOT' ? byId.get(e.parent) : undefined;
    const p = parent ?? root;
    node.parentId = parent ? parent.id : null;
    p.children.push(node);
  }

  // 层级越高树越宽，行距跟着收一收，免得平安那种"21 个主体平铺在集团下面"的图拖到两屏
  let leafTotal = 0;
  const countLeaves = (n: TreeNode) => {
    if (n.children.length === 0) {
      leafTotal += 1;
      return;
    }
    n.children.forEach(countLeaves);
  };
  countLeaves(root);
  const pitch = leafTotal > 24 ? 32 : leafTotal > 16 ? 38 : ROW_PITCH;

  // 深度优先：叶子按出现顺序占行，父节点取子树行的中点
  let cursor = 0;
  const ordered: TreeNode[] = [];
  const walk = (node: TreeNode, depth: number, path: string[]) => {
    node.depth = depth;
    node.path = node.isVirtualRoot ? [] : [...path, node.id];
    if (node.children.length === 0) {
      node.y = cursor;
      cursor += 1;
    } else {
      for (const c of node.children) walk(c, depth + 1, node.path);
      node.y = (node.children[0]!.y + node.children[node.children.length - 1]!.y) / 2;
    }
    ordered.push(node);
  };
  walk(root, 0, []);

  // 逐列对齐：每一列宽度取该列最宽节点，后面所有列统一下沉
  const colMax: number[] = [];
  for (const n of ordered) colMax[n.depth] = Math.max(colMax[n.depth] ?? 0, n.width);
  const colX: number[] = [];
  let acc = 0;
  for (let d = 0; d < colMax.length; d++) {
    colX[d] = acc;
    acc += (colMax[d] ?? 0) + X_GAP;
  }
  const width = acc - X_GAP;
  const leafCount = cursor;
  const height = Math.max(1, leafCount) * pitch - (pitch - NODE_H);

  for (const n of ordered) {
    n.x = colX[n.depth] ?? 0;
    n.y = n.y * pitch;
  }

  const edges: TreeEdge[] = [];
  for (const n of ordered) {
    if (n.isVirtualRoot) continue;
    const parent = n.parentId
      ? byId.get(n.parentId)!
      : root;
    const x1 = parent.x + parent.width;
    const y1 = parent.y + NODE_H / 2;
    const x2 = n.x;
    const y2 = n.y + NODE_H / 2;
    edges.push({
      key: `${parent.id}>${n.id}`,
      from: parent.id,
      to: n.id,
      relation: n.relation,
      stake: n.stake,
      x1,
      y1,
      x2,
      y2,
      childPath: n.path,
    });
  }

  return { nodes: ordered, edges, width: Math.max(width, 200), height: Math.max(height, NODE_H), leafCount };
}

/** 曲线边：横向三次贝塞尔，控制点放在两列中间 */
export function edgePath(e: TreeEdge): string {
  const midX = (e.x1 + e.x2) / 2;
  return `M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`;
}

export const GRAPH_METRICS = { NODE_H, ROW_PITCH };

/** 一个集合是否更适合按类型分组展示，而不是画成树 */
export function isFlatCollection(entities: Entity[]): boolean {
  if (entities.length === 0) return true;
  const orphans = entities.filter((e) => !e.parent || e.parent === 'ROOT').length;
  return orphans / entities.length > 0.6;
}
