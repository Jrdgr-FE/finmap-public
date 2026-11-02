import test from 'node:test';
import assert from 'node:assert/strict';
import { getMemberships, validateRelationshipData } from '../src/lib/ventures.ts';
test('primary membership survives additional cross-sector membership and duplicates', () => {
  assert.deepEqual(getMemberships({ track: 'robot', segment: 'body', memberships: [{ track: 'robot', segment: 'body' }, { track: 'compute', segment: 'chip' }] }), [{ track: 'robot', segment: 'body' }, { track: 'compute', segment: 'chip' }]);
});
const relation = { id: 'a-b', from: 'a', to: 'b', type: 'supplier', title: 'A supplies B', date: '2026-10-22', sources: [{ title: 'Company disclosure', url: 'https://example.com/disclosure', date: '2026-10-22' }] };
test('relationship requires named endpoints and dated public evidence', () => {
  assert.doesNotThrow(() => validateRelationshipData([relation], ['a', 'b']));
  assert.throws(() => validateRelationshipData([{ ...relation, sources: [] }], ['a', 'b']), /sources/);
  assert.throws(() => validateRelationshipData([{ ...relation, to: 'unknown' }], ['a', 'b']), /endpoints/);
  assert.throws(() => validateRelationshipData([{ ...relation, date: '2026-02-30' }], ['a', 'b']), /dated evidence/);
  assert.throws(() => validateRelationshipData([{ ...relation, sources: [{ title: 'Source', url: 'javascript:alert(1)' }] }], ['a', 'b']), /sources/);
});

const { applyVentureEnrichments } = await import('../src/lib/ventures.ts');
const base = { id: 'a', name: 'Original Name', intro: 'Original narrative', events: [{ title: 'Historical event' }], valuation: { value: 3 }, track: 'robot', segment: 'body', sources: [{ title: 'Prior source', url: 'https://example.com/a' }], memberships: [{ track: 'compute', segment: 'chip' }] };
test('profile enrichment merges evidence and memberships while preserving legacy facts', () => {
  const [v] = applyVentureEnrichments([base], [{ id: 'a', website: 'https://example.com/', country: '中国', verifiedAt: '2026-10-23', sources: [{ title: 'Duplicate source', url: 'https://example.com/a' }, { title: 'New source', url: 'https://example.com/b' }], memberships: [{ track: 'compute', segment: 'chip' }, { track: 'robot', segment: 'software' }] }]);
  assert.equal(v.name, base.name); assert.equal(v.intro, base.intro); assert.deepEqual(v.events, base.events); assert.deepEqual(v.valuation, base.valuation);
  assert.equal(v.sources.length, 2); assert.equal(v.memberships.length, 2); assert.equal(v.website, 'https://example.com/');
  assert.equal(base.website, undefined); assert.equal(base.sources.length, 1);
});
test('profile enrichment rejects unknown IDs and fact overrides', () => {
  assert.throws(() => applyVentureEnrichments([base], [{ id: 'b', country: '中国' }]), /unknown company/);
  for (const field of ['name', 'intro', 'events', 'valuation', 'track', 'segment', 'aliases', 'match']) {
    assert.throws(() => applyVentureEnrichments([base], [{ id: 'a', [field]: [] }]), /forbidden field/);
  }
});
