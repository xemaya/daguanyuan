import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { diffAgainstBaseline, medianShots, PERF_SHOTS } from '../tools/manifest-diff.mjs';

/**
 * 单子 AK4：door 逻辑测试。诊断函数（`diffAgainstBaseline` / `medianShots`）不碰 IO，
 * 好让这份测试直接喂假基线/manifest，同 tests/world-roster.test.mjs 测 `coverage()` 的路子——
 * 真实的三次连拍与 CLI 手测结果见回报，这里只焊门本身的判据。
 */

/** 最小基线：一镜，容差 3%（D-25 定的数，这里写死只是为了让测试自解释，不依赖磁盘上的真基线）。 */
const baseline = {
  tolerance: 0.03,
  fpsTarget: 45,
  shots: { gate_approach: { drawCalls: 269, triangles: 4200000, fps: 40 } },
};

const manifestWith = (triangles, drawCalls = 269, fps = 40) => ({
  shots: [{ id: 'gate_approach', stats: { drawCalls, triangles, fps } }],
});

test('超 3.5% 必须红，超 2.5% 必须绿', () => {
  const over = diffAgainstBaseline(baseline, manifestWith(4200000 * 1.035));
  assert.equal(over.ok, false);
  assert.equal(over.rows[0].status, 'DIFF');

  const under = diffAgainstBaseline(baseline, manifestWith(4200000 * 1.025));
  assert.equal(under.ok, true);
  assert.equal(under.rows[0].status, 'ok');
});

test('基线有而 manifest 没有的镜报 MISSING，置红', () => {
  const result = diffAgainstBaseline(baseline, { shots: [] });
  assert.equal(result.ok, false);
  assert.equal(result.rows[0].status, 'MISSING');
  assert.equal(result.rows[0].id, 'gate_approach');
});

test('manifest 有而基线没有的镜被忽略，不进比对结果', () => {
  const extra = {
    shots: [
      { id: 'gate_approach', stats: { drawCalls: 269, triangles: 4200000, fps: 40 } },
      { id: 'treeline', stats: { drawCalls: 999999, triangles: 999999, fps: 1 } },
    ],
  };
  const result = diffAgainstBaseline(baseline, extra);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1); // 只有基线登记过的那一镜进结果
});

test('DIFF 行带百分比与方向', () => {
  const up = diffAgainstBaseline(baseline, manifestWith(4200000 * 1.04));
  const upDiff = up.rows[0].diffs.find((d) => d.field === 'triangles');
  assert.ok(upDiff.pct > 0.039 && upDiff.pct < 0.041, `+4% 应读出 ~0.04，实际 ${upDiff.pct}`);

  const down = diffAgainstBaseline(baseline, manifestWith(4200000 * 0.96));
  const downDiff = down.rows[0].diffs.find((d) => d.field === 'triangles');
  assert.ok(downDiff.pct < -0.039 && downDiff.pct > -0.041, `-4% 应读出 ~-0.04，实际 ${downDiff.pct}`);
});

test('fps 低于目标只警告，不改变 ok/DIFF 判定——D-25 明确 fps 不进门', () => {
  const result = diffAgainstBaseline(baseline, manifestWith(4200000, 269, 10));
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].status, 'ok');
  assert.equal(result.rows[0].fpsWarn, true);
});

test('--write-baseline 取中位数，不是平均——1/100/2 能把两者分开', () => {
  const shotsList = [
    [{ id: 's', stats: { drawCalls: 1, triangles: 1, fps: 1 } }],
    [{ id: 's', stats: { drawCalls: 100, triangles: 100, fps: 100 } }],
    [{ id: 's', stats: { drawCalls: 2, triangles: 2, fps: 2 } }],
  ];
  const out = medianShots(shotsList, ['s']);
  // 中位数是 2；三者平均是 34.3——断言精确等于 2 就排除了"其实算的是平均"这种退化实现。
  assert.equal(out.s.drawCalls, 2);
  assert.equal(out.s.triangles, 2);
  assert.equal(out.s.fps, 2);
});

test('三份里有一份缺了某一镜，那一镜不写入基线（不拿两份当三份的中位数）', () => {
  const shotsList = [
    [{ id: 'a', stats: { drawCalls: 1, triangles: 1, fps: 1 } }],
    [{ id: 'a', stats: { drawCalls: 2, triangles: 2, fps: 2 } }],
    [], // 第三份没拍到 a
  ];
  assert.equal(medianShots(shotsList, ['a']).a, undefined);
});

test('突变复验：把容差改成 0.10 再跑同一条，红的必须变绿——证明门读的是基线文件里的容差，不是写死的常数', () => {
  const overManifest = manifestWith(4200000 * 1.035);
  const strict = diffAgainstBaseline(baseline, overManifest);
  assert.equal(strict.ok, false, '容差 0.03 下 +3.5% 应该红');

  const loose = diffAgainstBaseline({ ...baseline, tolerance: 0.10 }, overManifest);
  assert.equal(loose.ok, true, '同一份 +3.5% 的 manifest，容差放宽到 0.10 后应该变绿');
});

test('PERF_SHOTS 是 D-25/单子 AJ 用的四镜，改这个集合要回 DECISIONS', () => {
  assert.deepEqual(PERF_SHOTS, ['gate_approach', 'mound_block', 'grass_close', 'xiaoxiang']);
});

test('CLI：--write-baseline 给的目录数不是三个就拒绝（退出码 2），不读盘也能验证', () => {
  const two = spawnSync(process.execPath, ['tools/manifest-diff.mjs', '--write-baseline', 'a', 'b']);
  assert.equal(two.status, 2);
  const four = spawnSync(process.execPath, ['tools/manifest-diff.mjs', '--write-baseline', 'a', 'b', 'c', 'd']);
  assert.equal(four.status, 2);
});

