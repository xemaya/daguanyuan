import * as THREE from 'three';

/**
 * Collision registry.
 *
 * The town is small and almost entirely axis-aligned, so a broadphase-free
 * list of analytic shapes beats a mesh BVH here: it is exact, allocation-free
 * per frame, and lets each builder declare its own blockers without any shared
 * bake step.
 *
 * All shapes are 2D in the XZ plane with a vertical span, because the player
 * walks on a heightfield and never needs to resolve against sloped ceilings.
 */

export interface ColliderBase {
  /** Vertical span; the player only collides when their capsule overlaps it. */
  minY: number;
  maxY: number;
  /** Debug label, shown by the collider visualiser. */
  tag?: string;
}

export interface BoxCollider extends ColliderBase {
  kind: 'box';
  /** Centre in world XZ. */
  cx: number;
  cz: number;
  /** Half-extents along the box's local axes. */
  hx: number;
  hz: number;
  /** Rotation about Y, radians. */
  rot: number;
}

export interface CircleCollider extends ColliderBase {
  kind: 'circle';
  cx: number;
  cz: number;
  r: number;
}

export type Collider = BoxCollider | CircleCollider;

/**
 * 平台:一块带高度的旋转矩形(桥面、台基、亭子地面)。站在上面时地面高度
 * 取平台高与地形高的较大者;从旁边走上去靠玩家的踏步容差。
 */
export interface Platform {
  cx: number;
  cz: number;
  hx: number;
  hz: number;
  rot: number;
  y: number;
  tag?: string;
  /** Optional world-space footprint. Box fields then only provide a broad bound. */
  polygon?: readonly (readonly [number,number])[];
}

export interface GroundSampler {
  /** World-space ground height at (x, z). */
  (x: number, z: number): number;
}

const _v = new THREE.Vector2();

export class CollisionWorld {
  readonly colliders: Collider[] = [];

  /** 地形高度采样,由 Terrain 挂上;不含平台。 */
  terrainHeight: GroundSampler = () => 0;

  readonly platforms: Platform[] = [];

  /** 水面线:地形低于此高度且不在平台上即禁行。 */
  waterline = 0.06;

  /** 地面高度 = max(地形, 覆盖此点的平台)。 */
  groundHeight: GroundSampler = (x: number, z: number): number => {
    let h = this.terrainHeight(x, z);
    for (const p of this.platforms) {
      if (p.y > h && this.onPlatform(p, x, z)) h = p.y;
    }
    return h;
  };

  addPlatform(cx: number, cz: number, hx: number, hz: number, y: number, rot = 0, tag?: string): Platform {
    const p: Platform = { cx, cz, hx, hz, rot, y, tag };
    this.platforms.push(p);
    return p;
  }

  private onPlatform(p: Platform, x: number, z: number): boolean {
    if(p.polygon) {
      if(Math.abs(x-p.cx)>p.hx+1e-8||Math.abs(z-p.cz)>p.hz+1e-8)return false;
      let inside=false;
      for(let i=0;i<p.polygon.length;i++) {
        const a=p.polygon[i],b=p.polygon[(i+1)%p.polygon.length],dx=b[0]-a[0],dz=b[1]-a[1];
        const cross=dx*(z-a[1])-dz*(x-a[0]);
        if(Math.abs(cross)<1e-8&&x>=Math.min(a[0],b[0])-1e-8&&x<=Math.max(a[0],b[0])+1e-8&&z>=Math.min(a[1],b[1])-1e-8&&z<=Math.max(a[1],b[1])+1e-8)return true;
        if((a[1]>z)!==(b[1]>z)&&x<a[0]+dx*(z-a[1])/dz)inside=!inside;
      }
      return inside;
    }
    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    const rx = x - p.cx;
    const rz = z - p.cz;
    const lx = rx * cos - rz * sin;
    const lz = rx * sin + rz * cos;
    return Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz;
  }

  /** 此点是否禁行(落水)。 */
  blockedAt(x: number, z: number): boolean {
    if (this.terrainHeight(x, z) >= this.waterline) return false;
    for (const p of this.platforms) if (this.onPlatform(p, x, z)) return false;
    return true;
  }

  /** Surface material id at a point, used to pick footstep sounds. */
  surfaceAt: (x: number, z: number) => string = () => 'grass';

  addBox(
    cx: number,
    cz: number,
    hx: number,
    hz: number,
    minY: number,
    maxY: number,
    rot = 0,
    tag?: string,
  ): BoxCollider {
    const c: BoxCollider = { kind: 'box', cx, cz, hx, hz, minY, maxY, rot, tag };
    this.colliders.push(c);
    return c;
  }

  addCircle(
    cx: number,
    cz: number,
    r: number,
    minY: number,
    maxY: number,
    tag?: string,
  ): CircleCollider {
    const c: CircleCollider = { kind: 'circle', cx, cz, r, minY, maxY, tag };
    this.colliders.push(c);
    return c;
  }

  addPolygonPlatform(input:readonly (readonly [number,number])[],y:number,tag?:string):Platform {
    const points=input.map(p=>[p[0],p[1]] as [number,number]);
    if(points.length>1&&points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1])points.pop();
    if(points.length<3||!Number.isFinite(y)||points.some(p=>p.some(n=>!Number.isFinite(n))))throw new Error('Polygon platform requires finite coordinates and height');
    let area=0;
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length];
      if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8)throw new Error('Polygon platform has a zero edge');
      area+=a[0]*b[1]-b[0]*a[1];
    }
    if(Math.abs(area)<1e-8)throw new Error('Polygon platform has no area');
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),loX=Math.min(...xs),hiX=Math.max(...xs),loZ=Math.min(...zs),hiZ=Math.max(...zs);
    const p:Platform={cx:(loX+hiX)/2,cz:(loZ+hiZ)/2,hx:(hiX-loX)/2,hz:(hiZ-loZ)/2,rot:0,y,tag,polygon:points};
    this.platforms.push(p);return p;
  }

  /** Wraps an Object3D's world AABB as a box collider. */
  addFromObject(obj: THREE.Object3D, shrink = 0, tag?: string): BoxCollider {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    return this.addBox(
      center.x,
      center.z,
      Math.max(0.02, size.x / 2 - shrink),
      Math.max(0.02, size.z / 2 - shrink),
      box.min.y,
      box.max.y,
      0,
      tag ?? obj.name,
    );
  }

  clear(): void {
    this.colliders.length = 0;
    this.platforms.length = 0;
  }

  /**
   * Resolves a moving circle (the player's capsule footprint) against every
   * collider, returning the corrected position.
   *
   * Two passes: the first resolves the deepest penetrations, the second
   * catches the corner case where pushing out of one collider pushes into
   * another. More passes buy nothing at this scene's density.
   */
  resolve(
    x: number,
    z: number,
    feetY: number,
    headY: number,
    radius: number,
    out: THREE.Vector2,
  ): THREE.Vector2 {
    let px = x;
    let pz = z;

    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const c of this.colliders) {
        // Vertical overlap test — lets the player walk over low kerbs and
        // under raised eaves without extra geometry.
        if (headY <= c.minY || feetY >= c.maxY) continue;

        if (c.kind === 'circle') {
          const dx = px - c.cx;
          const dz = pz - c.cz;
          const d2 = dx * dx + dz * dz;
          const rr = c.r + radius;
          if (d2 < rr * rr && d2 > 1e-9) {
            const d = Math.sqrt(d2);
            const push = rr - d;
            px += (dx / d) * push;
            pz += (dz / d) * push;
            moved = true;
          } else if (d2 <= 1e-9) {
            px += rr;
            moved = true;
          }
        } else {
          // Transform into the box's local frame, resolve, transform back.
          // 约定与 three 的 rotation.y 一致:world = (lx·cos + lz·sin, −lx·sin + lz·cos)。
          const cos = Math.cos(c.rot);
          const sin = Math.sin(c.rot);
          const rx = px - c.cx;
          const rz = pz - c.cz;
          const lx = rx * cos - rz * sin;
          const lz = rx * sin + rz * cos;

          const nx = Math.max(-c.hx, Math.min(c.hx, lx));
          const nz = Math.max(-c.hz, Math.min(c.hz, lz));
          const dx = lx - nx;
          const dz = lz - nz;
          const d2 = dx * dx + dz * dz;

          if (d2 > radius * radius) continue;

          let outLx: number;
          let outLz: number;
          if (d2 > 1e-9) {
            // Outside the box, inside the radius: push along the surface normal.
            const d = Math.sqrt(d2);
            outLx = nx + (dx / d) * radius;
            outLz = nz + (dz / d) * radius;
          } else {
            // Centre is inside the box: eject along the shallowest axis.
            const px1 = c.hx - Math.abs(lx);
            const pz1 = c.hz - Math.abs(lz);
            if (px1 < pz1) {
              outLx = Math.sign(lx || 1) * (c.hx + radius);
              outLz = lz;
            } else {
              outLx = lx;
              outLz = Math.sign(lz || 1) * (c.hz + radius);
            }
          }

          px = c.cx + (outLx * cos + outLz * sin);
          pz = c.cz + (-outLx * sin + outLz * cos);
          moved = true;
        }
      }
      if (!moved) break;
    }

    return out.set(px, pz);
  }

  /** True if a circle at (x,z) spanning [feetY, headY] overlaps anything. */
  overlaps(x: number, z: number, feetY: number, headY: number, radius: number): boolean {
    this.resolve(x, z, feetY, headY, radius, _v);
    return Math.abs(_v.x - x) > 1e-4 || Math.abs(_v.y - z) > 1e-4;
  }

  /** Builds a wireframe visualisation of every collider, for debugging. */
  buildDebugMesh(): THREE.Object3D {
    const group = new THREE.Group();
    group.name = 'ColliderDebug';
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3366, wireframe: true, transparent: true, opacity: 0.6 });
    for (const c of this.colliders) {
      const h = Math.max(0.05, c.maxY - c.minY);
      let mesh: THREE.Mesh;
      if (c.kind === 'box') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(c.hx * 2, h, c.hz * 2), mat);
        mesh.rotation.y = c.rot;
      } else {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, h, 12), mat);
      }
      mesh.position.set(c.cx, c.minY + h / 2, c.cz);
      group.add(mesh);
    }
    return group;
  }
}
