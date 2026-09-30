import type {WallPathSpec} from './wall-path';
import type {CorridorPathSpec} from './corridor-path';
import type {BridgePathSpec} from './bridge-path';
export type LinearSpec=WallPathSpec|CorridorPathSpec|BridgePathSpec;
export interface LinearPlan {regions:readonly {linears?:readonly LinearSpec[]}[];connections?:readonly LinearSpec[]}
/** Connections may span public ground between regions; no courtyard is enlarged
 * merely to own a bridge. All consumers still read the same geometry records. */
export function allPlanLinears(plan:LinearPlan):LinearSpec[] {
  return [...plan.regions.flatMap(r=>r.linears??[]),...(plan.connections??[])];
}
