import * as THREE from 'three';

/** A fixed-size light-space window follows the viewer on whole shadow texels. */
export class RollingShadow {
  private readonly light: THREE.DirectionalLight;
  private readonly toSun: THREE.Vector3;
  private readonly right: THREE.Vector3;
  private readonly up: THREE.Vector3;
  private readonly distance: number;
  private readonly anchor = new THREE.Vector3();

  constructor(light: THREE.DirectionalLight, toSun: THREE.Vector3, halfExtent = 32, distance = 95) {
    this.light = light;
    this.toSun = toSun.clone().normalize();
    this.distance = distance;
    const eye = this.toSun.clone().multiplyScalar(distance);
    const basis = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), new THREE.Vector3(0,1,0));
    this.right = new THREE.Vector3().setFromMatrixColumn(basis,0);
    this.up = new THREE.Vector3().setFromMatrixColumn(basis,1);
    const view = basis.clone().setPosition(eye).invert();
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for(let i=0;i<8;i++) {
      point.set(i&1?halfExtent:-halfExtent,i&2?32:-24,i&4?halfExtent:-halfExtent).applyMatrix4(view);
      box.expandByPoint(point);
    }
    const camera=light.shadow.camera;
    camera.left=box.min.x-2;camera.right=box.max.x+2;
    camera.bottom=box.min.y-2;camera.top=box.max.y+2;
    camera.near=Math.max(.5,-box.max.z-18);camera.far=-box.min.z+2;
    camera.updateProjectionMatrix();
  }

  update(position: THREE.Vector3, mapSize = this.light.shadow.mapSize.x): void {
    const shadow=this.light.shadow,camera=shadow.camera;
    if(shadow.mapSize.x!==mapSize || shadow.mapSize.y!==mapSize) {
      shadow.map?.dispose();shadow.map=null;
      shadow.mapPass?.dispose();shadow.mapPass=null;
      shadow.mapSize.set(mapSize,mapSize);
    }
    const dx=(camera.right-camera.left)/mapSize,dy=(camera.top-camera.bottom)/mapSize;
    const x=position.dot(this.right),y=position.dot(this.up);
    this.anchor.copy(position)
      .addScaledVector(this.right,Math.round(x/dx)*dx-x)
      .addScaledVector(this.up,Math.round(y/dy)*dy-y);
    this.light.target.position.copy(this.anchor);
    this.light.position.copy(this.anchor).addScaledVector(this.toSun,this.distance);
    this.light.target.updateMatrixWorld();this.light.updateMatrixWorld();
    shadow.updateMatrices(this.light);
  }
}
