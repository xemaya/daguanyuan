/** Metre-space geometry shared by plan validation and future region assembly.
 * Boundaries are explicit: an entrance may be on its wall, two regions may
 * share a wall, but neither permits their interiors to overlap.
 */
export type Point2 = readonly [number, number];
export type Ring2 = readonly Point2[];
export type PointLocation = 'inside' | 'boundary' | 'outside';
const EPS = 1e-7;
const cross = (a: Point2, b: Point2, p: Point2) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const distance = (a: Point2, b: Point2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mix = (a: Point2, b: Point2, t: number): Point2 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function isClosedRing(poly: Ring2): boolean {
  return poly.length >= 4 && poly.every(p => p.length === 2 && p.every(Number.isFinite)) &&
    distance(poly[0], poly[poly.length - 1]) <= EPS;
}

export function signedArea(poly: Ring2): number {
  let sum = 0;
  // Translate before multiplying to avoid cancellation in offset gardens.
  const origin = poly[0];
  for (let i = 1; i + 1 < poly.length; i++) sum += cross(origin, poly[i], poly[i + 1]);
  return sum / 2;
}

export function pointOnSegment(p: Point2, a: Point2, b: Point2): boolean {
  const length = distance(a, b);
  if (length <= EPS) return distance(p, a) <= EPS;
  return Math.abs(cross(a, b, p)) / length <= EPS &&
    (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= EPS * length;
}

export function locatePoint(poly: Ring2, p: Point2): PointLocation {
  let inside = false;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    if (pointOnSegment(p, a, b)) return 'boundary';
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
      p[0] < a[0] + (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1])) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

export function segmentRelation(a: Point2, b: Point2, c: Point2, d: Point2):
  'none' | 'touch' | 'cross' | 'overlap' {
  const ab = distance(a, b), cd = distance(c, d);
  if (ab <= EPS) return pointOnSegment(a, c, d) ? 'touch' : 'none';
  if (cd <= EPS) return pointOnSegment(c, a, b) ? 'touch' : 'none';
  const s = (n: number) => Math.abs(n) <= EPS ? 0 : Math.sign(n);
  const c1 = s(cross(a, b, c) / ab), c2 = s(cross(a, b, d) / ab);
  const c3 = s(cross(c, d, a) / cd), c4 = s(cross(c, d, b) / cd);
  if (c1 * c2 < 0 && c3 * c4 < 0) return 'cross';
  if (c1 === 0 && c2 === 0) {
    const project = (p: Point2) => ((p[0] - a[0]) * (b[0] - a[0]) +
      (p[1] - a[1]) * (b[1] - a[1])) / ab;
    const lo = Math.max(0, Math.min(project(c), project(d)));
    const hi = Math.min(ab, Math.max(project(c), project(d)));
    if (hi - lo > EPS) return 'overlap';
    return hi >= lo - EPS ? 'touch' : 'none';
  }
  return pointOnSegment(a, c, d) || pointOnSegment(b, c, d) ||
    pointOnSegment(c, a, b) || pointOnSegment(d, a, b) ? 'touch' : 'none';
}

export function isSimpleRing(poly: Ring2): boolean {
  if (!isClosedRing(poly) || Math.abs(signedArea(poly)) <= EPS * EPS) return false;
  const n = poly.length - 1;
  for (let i = 0; i < n; i++) {
    if (distance(poly[i], poly[i + 1]) <= EPS) return false;
    for (let j = i + 1; j < n; j++) {
      const relation = segmentRelation(poly[i], poly[i + 1], poly[j], poly[j + 1]);
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      // Adjacent segments may meet once, but may not double back over one another.
      if (adjacent ? relation !== 'touch' : relation !== 'none') return false;
    }
  }
  return true;
}

/** All open portions of a segment, split exactly at polygon boundaries.
 * A long edge can leave a concave enclosure even with both endpoints inside.
 * Endpoint-only and single-midpoint tests miss this.
 */
export function segmentLocations(a: Point2, b: Point2, poly: Ring2):
  { from: number; to: number; location: PointLocation }[] {
  const length = distance(a, b);
  if (length <= EPS) return [{ from: 0, to: 1, location: locatePoint(poly, a) }];
  const dx = b[0] - a[0], dz = b[1] - a[1], ts = [0, 1];
  const add = (t: number) => { if (t >= -EPS / length && t <= 1 + EPS / length) ts.push(Math.max(0, Math.min(1, t))); };
  for (let i = 0; i + 1 < poly.length; i++) {
    const c = poly[i], d = poly[i + 1], ex = d[0] - c[0], ez = d[1] - c[1];
    const det = dx * ez - dz * ex;
    if (segmentRelation(a, b, c, d) === 'none') continue;
    if (Math.abs(det) > EPS * Math.max(length, distance(c, d))) {
      add(((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / det);
    } else {
      for (const p of [c, d]) if (pointOnSegment(p, a, b))
        add(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (length * length));
    }
  }
  ts.sort((x, y) => x - y);
  const unique = ts.filter((t, i) => i === 0 || (t - ts[i - 1]) * length > EPS);
  return unique.slice(1).map((to, i) => ({ from: unique[i], to,
    location: locatePoint(poly, mix(a, b, (unique[i] + to) / 2)) }));
}

export function containsRing(outer: Ring2, inner: Ring2): boolean {
  return inner.every(p => locatePoint(outer, p) !== 'outside') &&
    inner.slice(1).every((b, i) => segmentLocations(inner[i], b, outer).every(s => s.location !== 'outside'));
}

/** Positive-area intersection. Shared walls/corners alone are allowed. */
export function interiorsOverlap(p: Ring2, q: Ring2): boolean {
  for (const [a, b] of [[p, q], [q, p]]) {
    for (let i = 0; i + 1 < a.length; i++) {
      if (segmentLocations(a[i], a[i + 1], b).some(s => s.location === 'inside')) return true;
    }
  }
  // Identical rings (including differently subdivided edges) have no edge
  // strictly inside. Coincident edges enclose area on the same side iff their
  // winding-adjusted directions agree; opposite sides are just a shared wall.
  const winding = Math.sign(signedArea(p) * signedArea(q));
  for (let i = 0; i + 1 < p.length; i++) for (let j = 0; j + 1 < q.length; j++) {
    if (segmentRelation(p[i], p[i + 1], q[j], q[j + 1]) !== 'overlap') continue;
    const dot = (p[i + 1][0] - p[i][0]) * (q[j + 1][0] - q[j][0]) +
      (p[i + 1][1] - p[i][1]) * (q[j + 1][1] - q[j][1]);
    if (winding * dot > 0) return true;
  }
  return false;
}
