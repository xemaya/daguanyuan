import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {assembleStatic} from '@builder/parts/static-batches.ts';
import {ScreenSizeCull,SMALL_PART_CULL_PIXELS,SMALL_PART_CULL_HYSTERESIS,SMALL_PART_MAX_RADIUS} from '@engine/scatter/instancing.ts';

/* 单子 AX3:远处小件按屏幕尺寸剔除。 */
const H=900;
globalThis.innerHeight=H;globalThis.devicePixelRatio=1;
const camera=()=>{const c=new THREE.PerspectiveCamera(62,16/9,.06,600);c.updateProjectionMatrix();return c;};
const k=c=>(H/2)*c.projectionMatrix.elements[5];

/** 一排 10 个小件(半径约 0.1 m)+ 10 个大件,都够实例化阈值。 */
function garden(){
 const root=new THREE.Group(),small=new THREE.BoxGeometry(.1,.1,.1),big=new THREE.BoxGeometry(2,2,2),mat=new THREE.MeshStandardMaterial();
 for(let i=0;i<10;i++){const a=new THREE.Mesh(small,mat);a.position.set(i*.3,0,0);root.add(a);const b=new THREE.Mesh(big,mat);b.position.set(i*3,0,10);root.add(b);}
 return {root};
}

test('只有包围半径 < 0.5 m 的实例原型进剔除器,大件与合并残余不动',()=>{
 const {root}=garden();
 const out=assembleStatic(root,8,64,{singleCluster:true});
 const cull=out.children.find(c=>c instanceof ScreenSizeCull);
 assert.ok(cull,'没有挂剔除器');
 assert.equal(cull.children.length,1);
 assert.ok(cull.children[0].userData.smallPart.radius<SMALL_PART_MAX_RADIUS);
 const bigs=out.children.filter(c=>c.isInstancedMesh);
 assert.equal(bigs.length,1,'大件应当照旧直接挂在输出组下');
});

test('投影 < N px 就藏,回到 N×(1+滞回) 才露;每簇一个距离,阴影(正交)相机沿用主相机的决定',()=>{
 const {root}=garden();
 const out=assembleStatic(root,8,64,{singleCluster:true});out.updateMatrixWorld(true);
 const cull=out.children.find(c=>c instanceof ScreenSizeCull),mesh=cull.children[0],r=mesh.userData.smallPart.radius;
 const cam=camera();
 mesh.computeBoundingBox();const box=mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
 const at=d=>{cam.position.set(box.max.x+d,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2);cam.updateMatrixWorld();cull.update(cam);return mesh.visible;};
 const dHide=r*k(cam)/SMALL_PART_CULL_PIXELS;           // 投影恰好 N px 的距离
 assert.equal(at(dHide*.99),true);
 assert.equal(at(dHide*1.01),false,'过了 N px 还没藏');
 const dShow=r*k(cam)/(SMALL_PART_CULL_PIXELS*(1+SMALL_PART_CULL_HYSTERESIS));
 assert.equal(at((dHide+dShow)/2),false,'在滞回带里就露出来了——会闪');
 assert.equal(at(dShow*.99),true);
 // 方向光的阴影相机是正交的:它来投影时不改主相机的决定。
 at(dHide*2);assert.equal(mesh.visible,false);
 const shadowCam=new THREE.OrthographicCamera(-10,10,10,-10,.1,100);shadowCam.position.set(box.max.x+.5,5,0);shadowCam.updateMatrixWorld();
 cull.update(shadowCam);
 assert.equal(mesh.visible,false,'阴影 pass 与主相机不同藏同现');
 // 渲染器按 isLOD 这条现成的路每次投影都会调 update(见类注释)。
 assert.equal(cull.isLOD,true);assert.equal(cull.autoUpdate,true);
});

test('廊桥墙先各自合批、再进园子合批:里面那一遍的小件在外面那一遍重新挂回剔除器,矩阵不变',()=>{
 const {root}=garden();
 const inner=assembleStatic(root,8,64,{singleCluster:true});
 const expected=[];
 inner.updateMatrixWorld(true);
 const innerSmall=inner.children.find(c=>c instanceof ScreenSizeCull).children[0];
 for(let i=0;i<innerSmall.count;i++){const m=new THREE.Matrix4();innerSmall.getMatrixAt(i,m);expected.push(m.premultiply(innerSmall.matrixWorld));}
 const garden2=new THREE.Group();garden2.add(inner);
 const outer=assembleStatic(garden2);
 const cull=outer.children.find(c=>c instanceof ScreenSizeCull);
 assert.ok(cull,'外面那一遍把小件丢了');
 assert.equal(cull.children.length,1);
 outer.updateMatrixWorld(true);
 const m=cull.children[0];
 for(let i=0;i<m.count;i++){const a=new THREE.Matrix4();m.getMatrixAt(i,a);a.premultiply(m.matrixWorld);assert.ok(a.elements.every((v,j)=>Math.abs(v-expected[i].elements[j])<1e-6));}
});
