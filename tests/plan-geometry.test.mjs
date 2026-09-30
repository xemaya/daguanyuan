import test from 'node:test';
import assert from 'node:assert/strict';
import { isClosedRing, signedArea, locatePoint, segmentRelation, isSimpleRing,
  segmentLocations, containsRing, interiorsOverlap } from '@builder/plan/geometry.ts';

const square = [[0,0],[10,0],[10,10],[0,10],[0,0]];
const shifted = (poly, x, z) => poly.map(p => [p[0] + x, p[1] + z]);

test('plan boundaries include wall entrances regardless of ring winding', () => {
  for (const ring of [square, [...square].reverse()]) {
    assert.equal(locatePoint(ring, [0,5]), 'boundary');
    assert.equal(locatePoint(ring, [10,10]), 'boundary');
    assert.equal(locatePoint(ring, [5,5]), 'inside');
    assert.equal(locatePoint(ring, [-0.001,5]), 'outside');
  }
  assert.equal(signedArea(shifted(square, -10000, 10000)), 100);
});

test('segment contacts distinguish crossings, endpoints and collinear overlap', () => {
  assert.equal(segmentRelation([0,0],[4,0],[2,-1],[2,1]), 'cross');
  assert.equal(segmentRelation([0,0],[4,0],[4,0],[8,1]), 'touch');
  assert.equal(segmentRelation([0,0],[4,0],[2,0],[8,0]), 'overlap');
  assert.equal(segmentRelation([0,0],[4,0],[5,0],[8,0]), 'none');
  assert.equal(segmentRelation([2,0],[2,0],[0,0],[4,0]), 'touch');
});

test('invalid rings reject bow ties, self touches, zero edges and backtracking', () => {
  for (const ring of [
    [[0,0],[10,10],[0,10],[10,0],[0,0]],
    [[0,0],[10,0],[10,10],[5,0],[0,10],[0,0]],
    [[0,0],[10,0],[10,0],[10,10],[0,0]],
    [[0,0],[10,0],[5,0],[5,10],[0,10],[0,0]],
  ]) assert.equal(isSimpleRing(ring), false);
  assert.equal(isSimpleRing(square), true);
  assert.equal(isClosedRing([[0,0],[1,0],[NaN,1],[0,0]]), false);
});

test('shared region walls and corners have no area overlap; coincident interiors do', () => {
  for (const a of [square, [...square].reverse()]) {
    for (const flip of [false, true]) {
      const other = (x,z) => flip ? shifted(square,x,z).reverse() : shifted(square,x,z);
      assert.equal(interiorsOverlap(a, other(10,0)), false);
      assert.equal(interiorsOverlap(a, other(10,10)), false);
      assert.equal(interiorsOverlap(a, other(9,0)), true);
      assert.equal(interiorsOverlap(a, other(0,0)), true);
      assert.equal(interiorsOverlap(a, other(11,0)), false);
    }
  }
  assert.equal(interiorsOverlap(square, [[0,0],[5,0],[10,0],[10,10],[0,10],[0,0]]), true);
  assert.equal(interiorsOverlap(square, [[2,2],[3,2],[3,3],[2,3],[2,2]]), true);
});

test('containment checks whole edges across a concave enclosure, not only vertices', () => {
  const concave = [[0,0],[10,0],[10,10],[7,10],[7,4],[6,4],[6,10],[0,10],[0,0]];
  const inner = [[1,5],[9,5],[9,6],[1,6],[1,5]];
  assert.ok(inner.every(p => locatePoint(concave, p) === 'inside'));
  assert.equal(locatePoint(concave, [5,5]), 'inside'); // Even a midpoint-only check misses the notch.
  assert.equal(containsRing(concave, inner), false);
  assert.deepEqual(segmentLocations([1,5],[9,5],concave).map(s => s.location), ['inside','outside','inside']);
  assert.equal(containsRing(square, square), true);
});

test('a sightline grazing a rock boundary does not cross its solid interior', () => {
  assert.equal(segmentLocations([-2,0],[12,0],square).some(s => s.location === 'inside'), false);
  assert.equal(segmentLocations([-2,5],[12,5],square).some(s => s.location === 'inside'), true);
});
