import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDexterity,
  getDexterityStages,
  getDexterityProducts,
  getDexterityForCompany,
} from "../src/lib/dexterity.ts";
const source = {
  title: "Official specification",
  url: "https://example.com/product",
};
const entry = {
  companyId: "hand",
  role: "手本体",
  product: "Model A",
  evidence: source,
  verifiedAt: "2026-10-23",
};
const stage = {
  id: "hands",
  name: "手本体",
  description: "按具体产品比较",
  questions: ["主动自由度？"],
  entries: [entry],
};
const product = {
  companyId: "hand",
  product: "Model A",
  form: "五指手",
  actuation: "未披露",
  dof: "未披露",
  weight: "未披露",
  sensing: "未披露",
  software: "未披露",
  evidence: [source],
  verifiedAt: "2026-10-23",
};
test("topic rejects untraceable roles and unregistered company identities", () => {
  assert.doesNotThrow(() =>
    validateDexterity({ stages: [stage], products: [product] }, ["hand"]),
  );
  assert.throws(
    () => validateDexterity({ stages: [stage], products: [] }, []),
    /unknown/,
  );
  for (const bad of [
    undefined,
    { title: "local note", url: "file:///private/interview.docx" },
    { title: "embedded script", url: "javascript:alert(1)" },
    { title: "credentials", url: "https://user:pass@example.com" },
    { title: "local preview", url: "http://127.0.0.1:8830/" },
  ]) {
    assert.throws(
      () =>
        validateDexterity(
          {
            stages: [{ ...stage, entries: [{ ...entry, evidence: bad }] }],
            products: [],
          },
          ["hand"],
        ),
      /evidence/,
    );
  }
  assert.throws(
    () =>
      validateDexterity(
        {
          stages: [
            { ...stage, entries: [{ ...entry, verifiedAt: "2026-02-30" }] },
          ],
          products: [],
        },
        ["hand"],
      ),
    /evidence/,
  );
  assert.throws(
    () =>
      validateDexterity({ stages: [{ ...stage, id: {} }], products: [] }, [
        "hand",
      ]),
    /invalid stage/,
  );
});
test("product comparison requires explicit unknowns, evidence and unique company-model identity", () => {
  for (const field of [
    "dof",
    "weight",
    "actuation",
    "form",
    "sensing",
    "software",
  ]) {
    assert.throws(
      () =>
        validateDexterity(
          { stages: [], products: [{ ...product, [field]: "" }] },
          ["hand"],
        ),
      /explicit values/,
    );
  }
  assert.throws(
    () =>
      validateDexterity(
        { stages: [], products: [{ ...product, evidence: [] }] },
        ["hand"],
      ),
    /evidence/,
  );
  assert.throws(
    () =>
      validateDexterity({ stages: [], products: [product, product] }, ["hand"]),
    /duplicate product/,
  );
});
test("published topic resolves all profiles and keeps product versions with citations", () => {
  const stages = getDexterityStages(),
    products = getDexterityProducts();
  assert.equal(stages.length, 6);
  assert.ok(products.length > 0);
  assert.ok(
    stages.every((stage) =>
      stage.entries.every((entry) => entry.company.id === entry.companyId),
    ),
  );
  assert.ok(
    products.every((product) => product.companyName && product.evidence.length),
  );
  const wuji = getDexterityForCompany("wuji");
  assert.ok(wuji.roles.length >= 2);
  assert.ok(wuji.products.some((p) => p.product.includes("Wuji Hand 2.2")));
  const nonDex = getDexterityForCompany("unknown-company-id");
  assert.equal(nonDex.roles.length, 0);
  assert.equal(nonDex.products.length, 0);
});
