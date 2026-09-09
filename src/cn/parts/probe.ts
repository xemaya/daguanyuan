import * as THREE from 'three';
import { registerPart } from '../registry';

/* 占位构件:验证棚拍链路用,第一个真构件进来后删掉。 */
registerPart('probe', () => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xb85c3a, roughness: 0.7 }),
  );
  m.position.y = 0.5;
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return { root: g };
});
