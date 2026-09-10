import * as THREE from 'three';
import { applyWind } from './wind';
import { ClusterGrid } from './cluster';

/**
 * Creates an InstancedMesh with its own copy of the geometry so the
 * per-instance `aWind` buffer cannot be shared between two meshes that need
 * different phases.
 */
export function makeInstanced(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  count: number,
  rng: () => number,
  windMul = 1,
): THREE.InstancedMesh {
  const g = geo.clone();
  applyWind(g, count, rng, windMul);
  const mesh = new THREE.InstancedMesh(g, mat, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

interface PooledCluster {
  center: THREE.Vector3;
  radius: number;
  maxDist: number;
  meshes?: THREE.InstancedMesh[];
  build?: () => THREE.InstancedMesh[];
}

/** Keep camera culling in Three so each shadow camera gets its own frustum test. */
export class ClusteredInstancePool {
  private readonly root: THREE.Object3D;
  private readonly clusters: PooledCluster[] = [];
  private enabled = true;
  private frustumEnabled = true;
  private distanceEnabled = true;
  private readonly cameraPosition = new THREE.Vector3();
  readonly cellSize: number;

  constructor(root: THREE.Object3D, cellSize = 32) {
    this.root = root; this.cellSize = cellSize;
  }

  add(sources: THREE.InstancedMesh[], options: {maxDist?:number;skipShadow?:THREE.InstancedMesh[]} = {}): void {
    if (!sources.length || sources[0].count === 0) return;
    const grid = new ClusterGrid<number>(this.cellSize);
    const matrix = new THREE.Matrix4(), sphere = new THREE.Sphere(), union = new THREE.Box3();
    const point = new THREE.Vector3();
    for (let i=0;i<sources[0].count;i++) {
      union.makeEmpty();
      for (const source of sources) {
        if (source.count !== sources[0].count) throw new Error('Clustered instance layouts must match');
        if (!source.geometry.boundingSphere) source.geometry.computeBoundingSphere();
        source.updateMatrix();
        source.getMatrixAt(i,matrix);
        matrix.premultiply(source.matrix);
        sphere.copy(source.geometry.boundingSphere!).applyMatrix4(matrix);
        union.expandByPoint(point.copy(sphere.center).addScalar(sphere.radius));
        union.expandByPoint(point.copy(sphere.center).addScalar(-sphere.radius));
      }
      const combined=union.getBoundingSphere(new THREE.Sphere());
      combined.radius+=0.8; // Wind may move the rest-pose boundary into either camera.
      grid.add(combined.center.x,combined.center.z,i,combined.center.y,combined.radius);
    }
    for (const cluster of grid.cells()) {
      const members=cluster.items;
      const meshes=sources.map(source=>{
        const geometry=source.geometry.clone();
        for (const [key,attribute] of Object.entries(source.geometry.attributes)) {
          if (!(attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) continue;
          const attr=attribute as THREE.InstancedBufferAttribute;
          const ArrayType=attr.array.constructor as {new(length:number):typeof attr.array};
          const data=new ArrayType(members.length*attr.itemSize);
          members.forEach((id,j)=>{
            const start=Math.floor(id/attr.meshPerAttribute)*attr.itemSize;
            for(let c=0;c<attr.itemSize;c++)data[j*attr.itemSize+c]=attr.array[start+c];
          });
          geometry.setAttribute(key,new THREE.InstancedBufferAttribute(data,attr.itemSize,attr.normalized));
        }
        const mesh=new THREE.InstancedMesh(geometry,source.material,members.length);
        mesh.name=`${source.name}@${cluster.key}`;
        mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;
        mesh.customDepthMaterial=source.customDepthMaterial;
        mesh.customDistanceMaterial=source.customDistanceMaterial;
        const color=new THREE.Color();
        members.forEach((id,j)=>{
          source.getMatrixAt(id,matrix);matrix.premultiply(source.matrix);mesh.setMatrixAt(j,matrix);
          if(source.instanceColor){source.getColorAt(id,color);mesh.setColorAt(j,color);}
        });
        mesh.instanceMatrix.needsUpdate=true;
        if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
        // Use the whole plant's union, not a separate tighter trunk/fringe bound.
        mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(cluster.center.x,cluster.center.y,cluster.center.z),cluster.radius);
        if(options.skipShadow?.includes(source)){
          mesh.onBeforeShadow=()=>{mesh.count=0;};
          mesh.onAfterShadow=()=>{mesh.count=members.length;};
        }
        this.root.add(mesh);
        return mesh;
      });
      this.clusters.push({center:new THREE.Vector3(cluster.center.x,cluster.center.y,cluster.center.z),radius:cluster.radius,maxDist:options.maxDist??Infinity,meshes});
    }
    for(const source of sources){source.removeFromParent();source.geometry.dispose();}
  }

  addLazy(center: THREE.Vector3, radius:number, build:()=>THREE.InstancedMesh[], maxDist:number): void {
    this.clusters.push({center:center.clone(),radius,maxDist,build});
  }

  update(camera: THREE.Camera): void {
    camera.getWorldPosition(this.cameraPosition);
    for(const cluster of this.clusters){
      const distance=this.cameraPosition.distanceTo(cluster.center)-cluster.radius;
      const active=!this.enabled || !this.distanceEnabled || distance<cluster.maxDist;
      // Prepare one chunk early so normal walking does not meet an unbuilt border.
      if(!cluster.meshes && (active || distance<cluster.maxDist+13)) {
        cluster.meshes=cluster.build!();
        for(const mesh of cluster.meshes){
          if(!mesh.boundingSphere)mesh.computeBoundingSphere();
          this.root.add(mesh);
        }
        if(cluster.meshes.length){
          const actual=cluster.meshes[0].boundingSphere?.clone()??new THREE.Sphere();
          for(const mesh of cluster.meshes.slice(1))if(mesh.boundingSphere)actual.union(mesh.boundingSphere);
          cluster.center.copy(actual.center);cluster.radius=actual.radius;
        }
      }
      if(cluster.meshes)for(const mesh of cluster.meshes){
        mesh.visible=active;
        mesh.frustumCulled=this.enabled && this.frustumEnabled;
      }
    }
  }

  setEnabled(on:boolean): void {this.enabled=on;}
  setFrustumCulling(on:boolean): void {this.frustumEnabled=on;}
  setDistanceCulling(on:boolean): void {this.distanceEnabled=on;}
  stats(): {clusters:number;built:number;instances:number} {
    return {clusters:this.clusters.length,built:this.clusters.filter(c=>c.meshes).length,
      instances:this.clusters.reduce((n,c)=>n+(c.meshes?.reduce((sum,m)=>sum+m.instanceMatrix.count,0)??0),0)};
  }
}

/* ------------------------------------------------------------------ */
/* Per-instance culling                                                */
/* ------------------------------------------------------------------ */

/**
 * Frustum- and distance-culls the *instances* of an InstancedMesh, not just the
 * mesh.
 *
 * The problem this solves: `InstancedMesh.computeBoundingSphere()` spans every
 * instance, and that one sphere is what the renderer's frustum test uses. A
 * single mesh holding all 66 oak trees therefore has a bounding sphere the size
 * of the map — it intersects the frustum no matter where you stand, so all 66
 * trees are submitted every frame whether you are looking at the wood or at
 * your feet. The same was true of every bush, every clover and every flower in
 * the town. Measured, that was 1.65M triangles drawn in full in *every* frame
 * regardless of view direction, which is most of the overdraw in this scene.
 *
 * The fix keeps one draw call per mesh (chunking into many small meshes would
 * trade the triangles straight back for draw calls, and the draw-call budget is
 * tight too). Instead the instance matrices are permuted in place each frame so
 * the visible ones occupy a prefix, and `count` is set to the length of that
 * prefix.
 *
 * Shadows are the subtlety, and they apply to *everything* here, not just the
 * obvious casters. The sun is low and to the south-east, so a tree behind the
 * camera legitimately casts into frame; culling it against the camera frustum
 * would delete its shadow. Less obviously, this project uses VSM shadows, and
 * three.js renders a mesh into a VSM shadow map when it either casts *or*
 * receives:
 *
 *     object.castShadow || ( object.receiveShadow && type === VSMShadowMap )
 *
 * Every plant in this file sets `receiveShadow = true`, so the grass, clover,
 * flowers, weeds and leaf fringe are all in the shadow pass despite having
 * `castShadow = false`. An earlier version of this culler only restored the
 * count for meshes it thought were casters, and quietly dropped ~286k triangles
 * of receivers out of the shadow map.
 *
 * So every group keeps its full permutation in the buffer — hidden instances
 * are written after the visible prefix rather than dropped — and
 * `onBeforeShadow`/`onAfterShadow` raise `count` back to the full set for the
 * shadow pass and drop it again afterwards.
 */
/** One per-instance buffer that has to travel with the permutation. */
interface CullBuffer {
  attr: THREE.BufferAttribute;
  itemSize: number;
  base: Float32Array;
  live: Float32Array;
}

/**
 * A set of meshes that share one instance layout — a trunk, its canopy and its
 * leaf fringe — culled as a single unit.
 *
 * They must share the decision as well as the layout. Trunk, canopy and fringe
 * have different bounding radii, so culled independently they would disagree at
 * the frustum edge and you would watch a crown wink out above a trunk that
 * stayed. They also share one `aWind` buffer by design, so a permutation
 * applied to one and not the others would slide every crown off its trunk.
 */
interface CullGroup {
  meshes: THREE.InstancedMesh[];
  n: number;
  /** Union bounding sphere of the whole group, per instance, in world space. */
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  cr: Float32Array;
  buffers: CullBuffer[];
  maxDist2: number;
  /** The maxDist2 the world was authored with; QA can override maxDist2. */
  authoredMaxDist2: number;
  wasVisible: Uint8Array;
  visibleCount: number;
  primed: boolean;
}

export class InstanceCuller {
  private groups: CullGroup[] = [];
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private viewInverse = new THREE.Matrix4();
  private camPos = new THREE.Vector3();
  private sphere = new THREE.Sphere();

  /**
   * @param meshes Meshes sharing one instance layout. Instance `i` must be the
   *               same plant in every one of them.
   * @param extra  Per-instance attributes beyond matrix and colour that must be
   *               permuted alongside — deduplicated, so a buffer shared between
   *               several meshes is only permuted once.
   */
  add(
    meshes: THREE.InstancedMesh[],
    opts: {
      maxDist?: number;
      extra?: THREE.BufferAttribute[];
      /** Meshes a solid caster already covers; kept out of the shadow map. */
      skipShadow?: THREE.InstancedMesh[];
    },
  ): void {
    const live = meshes.filter((m) => m.count > 0);
    if (live.length === 0) return;
    const n = live[0].count;

    // Union of each mesh's geometry sphere, so the group's radius covers the
    // canopy even when we are iterating the trunk's matrices.
    let gcx = 0;
    let gcy = 0;
    let gcz = 0;
    let grad = 0;
    for (const m of live) {
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const s = m.geometry.boundingSphere!;
      gcx += s.center.x;
      gcy += s.center.y;
      gcz += s.center.z;
    }
    gcx /= live.length;
    gcy /= live.length;
    gcz /= live.length;
    const gc = new THREE.Vector3(gcx, gcy, gcz);
    for (const m of live) {
      const s = m.geometry.boundingSphere!;
      grad = Math.max(grad, gc.distanceTo(s.center) + s.radius);
    }

    const cx = new Float32Array(n);
    const cy = new Float32Array(n);
    const cz = new Float32Array(n);
    const cr = new Float32Array(n);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Vector3();
    const s3 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      live[0].getMatrixAt(i, m4);
      c.copy(gc).applyMatrix4(m4);
      // Largest axis scale: instances are scaled non-uniformly and a radius
      // that under-covers would pop the plant out at the edge of frame.
      s3.setFromMatrixScale(m4);
      cx[i] = c.x;
      cy[i] = c.y;
      cz[i] = c.z;
      // 4% of slack on the radius. The wind shader displaces vertices beyond
      // the geometry's authored bounds, and a plant that is culled one frame
      // before it leaves the screen is far more noticeable than one drawn a
      // frame longer than it needed to be.
      cr[i] = grad * Math.max(s3.x, s3.y, s3.z) * 1.04;
    }

    const buffers: CullBuffer[] = [];
    const seen = new Set<THREE.BufferAttribute>();
    const track = (attr: THREE.BufferAttribute | null | undefined): void => {
      if (!attr || seen.has(attr)) return;
      seen.add(attr);
      const arr = attr.array as Float32Array;
      buffers.push({ attr, itemSize: attr.itemSize, base: arr.slice(), live: arr });
    };
    for (const m of live) {
      track(m.instanceMatrix);
      track(m.instanceColor);
      // Every per-instance attribute has to travel with the permutation, not
      // just the matrix. `makeInstanced` gives each geometry an `aWind` buffer
      // holding that plant's phase and stiffness; permuting the matrices while
      // leaving it behind hands each plant a stranger's wind and visibly slides
      // it across the ground. Discovering these off the geometry rather than
      // listing them by hand is what stops that happening again. The Set also
      // handles the tree case, where trunk, canopy and fringe deliberately
      // share one `aWind` buffer and it must be permuted exactly once.
      for (const attr of Object.values(m.geometry.attributes)) {
        if ((attr as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) {
          track(attr as THREE.BufferAttribute);
        }
      }
    }
    for (const e of opts.extra ?? []) track(e);

    const group: CullGroup = {
      meshes: live,
      n,
      cx, cy, cz, cr,
      buffers,
      maxDist2: opts.maxDist === undefined ? Infinity : opts.maxDist * opts.maxDist,
      authoredMaxDist2: opts.maxDist === undefined ? Infinity : opts.maxDist * opts.maxDist,
      wasVisible: new Uint8Array(n),
      visibleCount: n,
      primed: false,
    };
    this.groups.push(group);

    const shadowSkip = new Set<THREE.InstancedMesh>(opts.skipShadow ?? []);
    for (const m of live) {
      // We own the decision now. The renderer's whole-mesh test could only ever
      // agree with us, and it would apply the camera frustum to the shadow pass
      // too, which needs the full set.
      m.frustumCulled = false;
      // Under VSM, three.js draws every *receiver* into the shadow map as well
      // as every caster, so `castShadow = false` does not keep a mesh out of
      // it. For the leaf fringe that is pure waste: the canopy blob and the
      // bush shell sit inside the same volume and already cast that crown's
      // shadow, so the forty thousand alpha-tested cards on top of them can
      // only add noise to the edge of a shadow that is already there — which is
      // exactly the reasoning behind their `castShadow = false` in the first
      // place. Zeroing the instance count skips the draw outright
      // (`renderInstances` early-outs at zero) while leaving `receiveShadow`
      // alone, so the cards are still lit and shadowed exactly as before.
      //
      // Ground scatter is deliberately NOT treated this way. Grass, clover,
      // flowers and weeds have no solid proxy underneath them, so taking them
      // out of the map removes real contact shadowing and visibly flattens the
      // turf. Measured at ~530k triangles a frame, and not worth it.
      const skipShadow = shadowSkip.has(m);
      m.onBeforeShadow = () => { m.count = skipShadow ? 0 : group.n; };
      m.onAfterShadow = () => { m.count = group.visibleCount; };
    }
  }

  /**
   * Restores every instance to its authored order and full count.
   *
   * This is the A/B hook for visual QA: it puts the scene back to "no instance
   * culling at all" so a frozen capture can prove that culling changed the
   * triangle count and nothing else. Without it there is no way to tell a
   * culling bug from a wind-phase difference in a screenshot diff.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      for (const g of this.groups) g.primed = false;
      return;
    }
    for (const g of this.groups) {
      for (const b of g.buffers) {
        b.live.set(b.base);
        b.attr.needsUpdate = true;
      }
      g.visibleCount = g.n;
      g.wasVisible.fill(1);
      g.primed = false;
      for (const m of g.meshes) m.count = g.n;
    }
  }

  private enabled = true;

  /** QA hook: drop only the distance cuts, keeping frustum culling. */
  setDistanceCulling(on: boolean): void {
    for (const g of this.groups) {
      if (on) {
        g.maxDist2 = g.authoredMaxDist2;
      } else {
        g.maxDist2 = Infinity;
      }
      g.primed = false;
    }
  }

  update(camera: THREE.Camera): void {
    if (!this.enabled) return;
    // The renderer refreshes these during `render()`, which has not happened
    // yet this frame — the tick runs first. Using them as they stand would test
    // against the *previous* frame's frustum and pop plants in at the edge of
    // frame whenever the camera turns quickly.
    camera.updateMatrixWorld();
    this.viewInverse.copy(camera.matrixWorld).invert();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, this.viewInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    camera.getWorldPosition(this.camPos);
    const px = this.camPos.x;
    const py = this.camPos.y;
    const pz = this.camPos.z;

    for (const g of this.groups) {
      const { n, cx, cy, cz, cr, wasVisible } = g;
      let changed = !g.primed;
      let k = 0;

      // Pass 1: decide, and notice whether anything actually flipped. Rewriting
      // and re-uploading thousands of matrices for a camera that has not moved
      // far enough to change the set is pure waste.
      for (let i = 0; i < n; i++) {
        const r = cr[i];
        let vis = 1;
        if (g.maxDist2 !== Infinity) {
          const dx = cx[i] - px;
          const dy = cy[i] - py;
          const dz = cz[i] - pz;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
          if (d > 0 && d * d > g.maxDist2) vis = 0;
        }
        if (vis) {
          this.sphere.center.set(cx[i], cy[i], cz[i]);
          this.sphere.radius = r;
          if (!this.frustum.intersectsSphere(this.sphere)) vis = 0;
        }
        if (wasVisible[i] !== vis) {
          wasVisible[i] = vis;
          changed = true;
        }
        if (vis) k++;
      }

      if (!changed) continue;
      g.primed = true;

      // Pass 2: compact the visible instances into a prefix, and write the
      // hidden ones after it. The tail is not optional: the shadow pass raises
      // `count` back to the full set, so every instance must be somewhere in
      // the buffer with a valid matrix.
      let head = 0;
      let tail = k;
      for (let i = 0; i < n; i++) {
        const slot = wasVisible[i] ? head++ : tail++;
        for (const b of g.buffers) {
          const w = b.itemSize;
          b.live.set(b.base.subarray(i * w, i * w + w), slot * w);
        }
      }

      g.visibleCount = k;
      for (const b of g.buffers) b.attr.needsUpdate = true;
      for (const m of g.meshes) m.count = k;
    }
  }
}
