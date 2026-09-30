import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cached, recipeKey, TEXTURE_RECIPE_VERSION } from '@engine/core/TextureLab.ts';

/**
 * AQ-a1：`cached()` 只按字符串比较键,永远不知道 `build()` 背后的函数长什么样。
 * `recipeKey()` 是把所有会改变像素的输入(尺寸、bakeNormalMap 的强度……)叠进键的
 * 唯一入口——这里不跑真的烘焙(Node 没有 OffscreenCanvas),只验证 `cached`+
 * `recipeKey` 这套记忆化机制本身:同键复用、异键不撞、版本号在键里。
 * 用 `new THREE.Texture()` 当哑对象,携带一个 size 标记来断言"这真的是两张贴图"。
 */
function stubTexture(size) {
  const t = new THREE.Texture();
  t.image = { width: size, height: size };
  return t;
}

test('recipeKey：同名不同 size 是两把不同的键，各自烤出各自尺寸的贴图', () => {
  let builds = 0;
  const build = (size) => () => { builds++; return stubTexture(size); };
  const small = cached(recipeKey('unit.cachekey.albedo', 512), build(512));
  const large = cached(recipeKey('unit.cachekey.albedo', 1024), build(1024));
  assert.notEqual(small, large, '不同 size 命中了同一张贴图——键没有区分 size');
  assert.equal(small.image.width, 512);
  assert.equal(large.image.width, 1024);
  assert.equal(builds, 2, '两个不同 size 应该各烤一次');
});

test('recipeKey：同名同参（同 size）复用同一个对象，build 只跑一次', () => {
  let builds = 0;
  const build = () => { builds++; return stubTexture(256); };
  const a = cached(recipeKey('unit.cachekey.reuse', 256), build);
  const b = cached(recipeKey('unit.cachekey.reuse', 256), build);
  assert.equal(a, b, '同参数的两次调用应该拿到同一个纹理对象');
  assert.equal(builds, 1, 'build 应该只在第一次未命中时跑');
});

test('recipeKey：附带的像素参数（如 bakeNormalMap 的 strength）不同也要分键', () => {
  const strong = recipeKey('unit.cachekey.normal', 512, 2.2);
  const weak = recipeKey('unit.cachekey.normal', 512, 1.9);
  assert.notEqual(strong, weak, 'strength 不同却拿到同一把键——高度场变了贴图不会变');
});

test('recipeKey：键里带配方版本号，改版本号能让全部旧键失效', () => {
  const k = recipeKey('unit.cachekey.version', 512);
  assert.ok(k.includes(`v${TEXTURE_RECIPE_VERSION}`), `键 ${k} 里没有配方版本号`);
});

test('recipeKey：不同 name 不同 size 不同 extra 三者都参与去重，任一不同就不是同一把键', () => {
  const base = recipeKey('unit.cachekey.combo', 512, 'x');
  assert.notEqual(base, recipeKey('unit.cachekey.combo2', 512, 'x'));
  assert.notEqual(base, recipeKey('unit.cachekey.combo', 256, 'x'));
  assert.notEqual(base, recipeKey('unit.cachekey.combo', 512, 'y'));
  assert.equal(base, recipeKey('unit.cachekey.combo', 512, 'x'));
});
