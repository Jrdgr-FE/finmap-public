import fs from "node:fs";
import path from "node:path";
import { getVentures } from "./ventures.ts";
import type { Venture, VSource } from "./ventures.ts";

export interface DexterityEntry {
  companyId: string;
  role: string;
  product: string;
  evidence: VSource;
  verifiedAt: string;
}
export interface DexterityStage {
  id: string;
  name: string;
  description: string;
  questions: string[];
  entries: DexterityEntry[];
}
export interface DexterityProduct {
  companyId: string;
  product: string;
  form: string;
  actuation: string;
  dof: string;
  weight: string;
  sensing: string;
  software: string;
  evidence: VSource[];
  verifiedAt: string;
}
export interface DexterityData {
  stages: DexterityStage[];
  products: DexterityProduct[];
}

function publicSource(source: VSource) {
  if (
    !source ||
    typeof source.title !== "string" ||
    !source.title.trim() ||
    typeof source.url !== "string"
  )
    return false;
  try {
    const url = new URL(source.url);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const local =
      /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        host,
      ) ||
      /\.(localhost|local|internal)$/.test(host) ||
      host === "::1" ||
      host === "::" ||
      /^(fc|fd|fe80):/i.test(host);
    return (
      /^https?:$/.test(url.protocol) && !url.username && !url.password && !local
    );
  } catch {
    return false;
  }
}
function verifiedDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function validateDexterity(data: DexterityData, companyIds: string[]) {
  const ids = new Set(companyIds);
  if (!data || !Array.isArray(data.stages) || !Array.isArray(data.products))
    throw new Error("Dexterity: invalid data");
  const stageIds = new Set<string>();
  for (const stage of data.stages) {
    if (
      !stage ||
      typeof stage.id !== "string" ||
      !/^[a-z0-9-]+$/.test(stage.id) ||
      stageIds.has(stage.id)
    )
      throw new Error("Dexterity: duplicate or invalid stage");
    stageIds.add(stage.id);
    if (
      ![stage.name, stage.description].every(
        (s) => typeof s === "string" && s.trim(),
      ) ||
      !Array.isArray(stage.questions) ||
      !stage.questions.every((s) => typeof s === "string" && s.trim()) ||
      !Array.isArray(stage.entries)
    )
      throw new Error("Dexterity: invalid stage");
    const members = new Set<string>();
    for (const entry of stage.entries) {
      if (!entry || !ids.has(entry.companyId) || members.has(entry.companyId))
        throw new Error("Dexterity: unknown or duplicate company");
      members.add(entry.companyId);
      if (
        ![entry.role, entry.product].every(
          (s) => typeof s === "string" && s.trim(),
        ) ||
        !publicSource(entry.evidence) ||
        !verifiedDate(entry.verifiedAt)
      )
        throw new Error("Dexterity: role requires dated public evidence");
    }
  }
  const products = new Set<string>();
  for (const product of data.products) {
    if (!product || !ids.has(product.companyId))
      throw new Error("Dexterity: unknown product company");
    const key = product.companyId + "/" + product.product;
    if (products.has(key)) throw new Error("Dexterity: duplicate product");
    products.add(key);
    if (
      ![
        product.product,
        product.form,
        product.actuation,
        product.dof,
        product.weight,
        product.sensing,
        product.software,
      ].every((s) => typeof s === "string" && s.trim()) ||
      !Array.isArray(product.evidence) ||
      !product.evidence.length ||
      !product.evidence.every(publicSource) ||
      !verifiedDate(product.verifiedAt)
    )
      throw new Error(
        "Dexterity: product fields require explicit values and public evidence",
      );
  }
}
let _cache: DexterityData | null = null;

function readData(): DexterityData {
  if (_cache) return _cache;
  const data = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "data/topics/dexterity.json"),
      "utf8",
    ),
  );
  validateDexterity(
    data,
    getVentures().map((c) => c.id),
  );
  _cache = data;
  return data;
}
export function getDexterityStages(): Array<
  Omit<DexterityStage, "entries"> & {
    entries: Array<DexterityEntry & { company: Venture }>;
  }
> {
  const companies = new Map(getVentures().map((c) => [c.id, c]));
  return readData().stages.map((stage) => ({
    ...stage,
    entries: stage.entries.map((entry) => ({
      ...entry,
      company: companies.get(entry.companyId)!,
    })),
  }));
}
export function getDexterityProducts(): Array<
  DexterityProduct & { companyName: string }
> {
  const companies = new Map(getVentures().map((c) => [c.id, c]));
  return readData().products.map((product) => ({
    ...product,
    companyName: companies.get(product.companyId)!.name,
  }));
}
export interface CompanyDexteritySummary {
  roles: Array<
    DexterityEntry & {
      stageId: string;
      stageName: string;
    }
  >;
  products: DexterityProduct[];
}
export function getDexterityForCompany(
  companyId: string,
): CompanyDexteritySummary {
  const data = readData();
  const roles = data.stages.flatMap((stage) =>
    stage.entries
      .filter((entry) => entry.companyId === companyId)
      .map((entry) => ({
        ...entry,
        stageId: stage.id,
        stageName: stage.name,
      })),
  );
  const products = data.products.filter(
    (product) => product.companyId === companyId,
  );
  return { roles, products };
}
