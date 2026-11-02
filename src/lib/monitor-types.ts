export interface MonitorSource {
  id: string;
  kind: string;
  name: string;
  url: string;
  intervalHours: number;
  status: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  count?: number;
  newCount?: number;
  error?: string | null;
  scope?: string;
}
export interface MonitorCompany {
  id: string;
  name: string;
  en: string;
  region: string;
  priority: boolean;
  memberships: { track: string; segment: string }[];
  sources: MonitorSource[];
  channels: { kind: string; name: string; url: string; mode: string }[];
  gaps: string[];
}
export interface MonitorEvent {
  id: string;
  companyId: string;
  title: string;
  kind: string;
  stage: string;
  role: string;
  evidence: string;
  publishedAt: string | null;
  dateLabel?: string;
  occurredAt: string | null;
  discoveredAt: string;
  updatedAt: string;
  revision: number;
  baseline: boolean;
  summary: string;
  summaryType: string;
  round: string | null;
  amount: string | null;
  financingType?: string | null;
  status?: string;
  sources: {
    id?: string;
    name: string;
    url: string;
    publishedAt: string | null;
    material: string;
    checkedAt?: string;
  }[];
}
export interface MonitorSnapshot {
  version: number;
  bootstrapPartial?: boolean;
  generatedAt: string | null;
  lastRun: {
    finishedAt: string;
    processed: number;
    failed: number;
    pending: number;
    modelRequests: number;
    paidSearchRequests: number;
  } | null;
  backfillComplete: boolean;
  backfillDays: number;
  companies: MonitorCompany[];
  events: MonitorEvent[];
  tracks: {
    id: string;
    name: string;
    segments: { id: string; name: string }[];
  }[];
}
export const MONITOR_KINDS: Record<string, string> = {
  funding: "融资并购",
  product: "产品发布",
  ranking: "榜单评测",
  partnership: "商业进展",
  people: "团队经营",
  research: "研究进展",
  other: "相关动态",
};
export const MONITOR_EVIDENCE: Record<string, string> = {
  official: "官方渠道",
  discovery: "检索线索",
  reviewed: "历史整理",
};
export const MONITOR_STAGE: Record<string, string> = {
  planned: "计划 / 洽谈",
  conditional: "附条件",
  announced: "发布 / 完成表述",
  investor: "参与投资",
  reported: "报道线索",
  preorder: "预售",
  demo: "演示 / 预览",
  available: "正式可用",
  "software-release": "软件版本",
  shortlisted: "入围",
  awarded: "获奖",
  listed: "入选 / 榜单",
  delivery: "交付 / 订单",
  pilot: "试点",
  cooperation: "合作",
  historical: "历史记录",
  "page-change": "页面变化待核对",
};
export const MONITOR_FINANCING: Record<string, string> = {
  funding: "融资",
  acquisition: "并购",
  ipo: "上市",
  loan: "贷款相关",
  grant: "资助",
};
export function isCompanyEvent(event: Pick<MonitorEvent, "role">): boolean {
  return ["subject", "investor", "partner"].includes(event.role);
}
export function fundingRoundLabel(round: string | null): string {
  if (!round) return "未披露";
  return round
    .replace(
      /^series([a-f]\d?)$/i,
      (_, letter: string) => `Series ${letter.toUpperCase()}`,
    )
    .replace(
      /^((?:pre[- ]?)?[a-f]\d?\+?)轮$/i,
      (_, letter: string) => `${letter.toUpperCase()}轮`,
    )
    .replace(/^seedround$/i, "种子轮");
}
export function eventKindLabel(
  event: Pick<MonitorEvent, "role" | "stage" | "kind">,
): string {
  return event.role === "investor" || event.stage === "investor"
    ? "对外投资"
    : (MONITOR_KINDS[event.kind] ?? "相关动态");
}
