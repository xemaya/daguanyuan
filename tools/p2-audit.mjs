import {auditPlan} from './plan-audit.mjs';
import {auditLinearLayouts} from './linear-layout-audit.mjs';
/** Original architecture §8: P2 supplies geometry/construction inputs. The
 * separate full-garden strict gate still rejects unfinished PE/P3/P4 evidence. */
export function auditP2(plan) {
 const all=auditPlan(plan),linear=auditLinearLayouts(plan),fails=[...all.fails];
 const need=(test,message)=>{if(!test)fails.push(message);};
 need(plan.regions.length===19,'P2要求19区建设轮廓');
 need(all.diagnostics.construction.valid===32,'P2要求32项建筑的可执行施工规格');
 need(all.diagnostics.route.narrativeNodes===29,'P2要求完整29节点规划路线');
 need(plan.distantScenes.length===5&&plan.distantScenes.every(s=>s.readiness==='distant-ready'),'P2要求五处可生成远景，不能只有观察点');
 need(linear.objects.length===linear.total&&linear.total>=32,'P2线性几何覆盖不完整');
 need(linear.caveTop.verified,'P2洞顶与船行净空契约未通过');
 const bridge=linear.objects.find(o=>o.id==='qinfang_ting_qiao.three-opening-bridge');
 need(bridge?.bridgeSections?.filter(s=>s.role==='water-opening').length===3,'三港桥须有三处实际断面净口，不能以旧曲桥或bays字段替代');
 return {phase:'P2',complete:fails.length===0,fails,regions:plan.regions.length,buildings:all.diagnostics.construction,
  narrativeNodes:all.diagnostics.route.narrativeNodes,routeLengthM:all.diagnostics.route.length,
  distantScenes:plan.distantScenes.length,linearObjects:linear.total,caveTop:linear.caveTop,
  fullGardenComplete:all.complete,fullGardenPending:all.pending};
}
