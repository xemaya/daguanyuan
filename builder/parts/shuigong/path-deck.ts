import * as THREE from 'three';
import type {Point2} from '@builder/plan/geometry';
import {pathStations,stripPolygon} from '@builder/plan/polyline';
import {boxProjectedUV} from '../sculpt';

/** A single beveled extrusion avoids coplanar floor overlaps at every turn. */
export function deckGeometry(points:readonly Point2[],half:number,height:number):THREE.BufferGeometry {
  const bevel=.015;
  const trimmed=points.map(p=>[...p] as [number,number]);
  for(const [i,j,sign] of [[0,1,1],[points.length-1,points.length-2,1]]) {
    const dx=points[j][0]-points[i][0],dz=points[j][1]-points[i][1],length=Math.hypot(dx,dz);
    trimmed[i][0]+=sign*dx/length*bevel;trimmed[i][1]+=sign*dz/length*bevel;
  }
  const polygon=stripPolygon(pathStations(trimmed),half-bevel);
  const shape=new THREE.Shape(polygon.slice(0,-1).map(p=>new THREE.Vector2(p[0],-p[1])));
  const geo=new THREE.ExtrudeGeometry(shape,{depth:height-2*bevel,bevelEnabled:true,bevelSize:bevel,bevelThickness:bevel,bevelSegments:2,steps:1});
  geo.translate(0,0,bevel);geo.rotateX(-Math.PI/2);
  geo.setAttribute('uv',boxProjectedUV(geo,.65));return geo;
}

