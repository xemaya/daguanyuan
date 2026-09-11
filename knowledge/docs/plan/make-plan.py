# -*- coding: utf-8 -*-
"""projects/daguanyuan/plan.json -> plan.svg (hand-written SVG, no external resources)"""
import json, math, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'projects', 'daguanyuan', 'plan.json')
OUT = os.path.join(HERE, 'plan.svg')
d = json.load(open(SRC, encoding='utf-8'))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
# The exact same compiler validates P2 and drives the SVG. No Python copy of
# bay/roof formulae, and no implicit claim that a planned frame is already built.
construction = json.loads(subprocess.run(
    ['node', os.path.join(ROOT, 'tools', 'export-plan-construction.mjs')],
    cwd=ROOT, check=True, capture_output=True, text=True).stdout)
building_names = {b['id']:b['name'] for r in d['regions'] for b in r['buildings']}
narrative_report = json.loads(subprocess.run(
    ['node', os.path.join(ROOT, 'tools', 'export-narrative-route.mjs')],
    cwd=ROOT, check=True, capture_output=True, text=True).stdout)
narrative = next(r for r in narrative_report['routes'] if r['source']['id'] == 'ch17')
connection_report = json.loads(subprocess.run(
    ['node', os.path.join(ROOT, 'tools', 'export-plan-connections.mjs')],
    cwd=ROOT, check=True, capture_output=True, text=True).stdout)


# ---------- viewBox: world units == svg units, y down = south (svg y = z) ----------
VB_X, VB_Y, VB_W, VB_H = -300, -390, 940, 790
SCALE = 1.5
W_PX, H_PX = int(VB_W * SCALE), int(VB_H * SCALE)
RX0, RX1 = 320, 620          # right column band
SERIF = 'serif'

C = dict(
    paper='#f7f2e7', ink='#33291d', wall='#4a3a26', wallfill='#fdfbf5',
    water='#b9dde2', wateredge='#6fa3ac',
    hill='#dccaa4', hilledge='#a98f61',
    road='#b3a68c', route='#c2562f',
    A='#b8352c', B='#2f5d8c', Cc='#4e7a52',
    panel='#fffdf7', panelEdge='#c9bda2', muted='#7a6e5c',
)
TIER_COLOR = {'A': C['A'], 'B': C['B'], 'C': C['Cc']}
TIER_NAME = {'A': '一等·礼制主体', 'B': '二等·居住院落', 'C': '三等·园林点景'}
CONF_CN = {'high': '高', 'medium': '中', 'low': '低'}
# confidence -> stroke dash
CONF_DASH = {'high': 'none', 'medium': '7 5', 'low': '2 4'}

out = []
def e(s): out.append(s)
def esc(t):
    return (t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))
def pts(poly):
    return ' '.join('%.1f,%.1f' % (p[0], p[1]) for p in poly)
def centroid(poly):
    p = poly[:-1] if poly[0] == poly[-1] else poly[:]
    a = cx = cz = 0.0
    for i in range(len(p)):
        x0, z0 = p[i]; x1, z1 = p[(i + 1) % len(p)]
        cr = x0 * z1 - x1 * z0
        a += cr; cx += (x0 + x1) * cr; cz += (z0 + z1) * cr
    if abs(a) < 1e-9:
        return sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p)
    return cx / (3 * a), cz / (3 * a)
def short(name):
    return name.split('(')[0].split('（')[0]

# ================= header =================
e('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="%d %d %d %d" '
  'font-family="%s">' % (W_PX, H_PX, VB_X, VB_Y, VB_W, VB_H, SERIF))
e('<title>大观园复原平面图 · 500m × 500m</title>')
e('''<defs>
<marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
  <path d="M0,1 L9,5 L0,9 z" fill="%s"/></marker>
<marker id="ahw" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
  <path d="M0,1 L9,5 L0,9 z" fill="%s"/></marker>
<pattern id="hillhatch" width="9" height="9" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
  <line x1="0" y1="0" x2="0" y2="9" stroke="%s" stroke-width="1.1" opacity="0.5"/></pattern>
</defs>''' % (C['route'], C['wateredge'], C['hilledge']))
e('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' % (VB_X, VB_Y, VB_W, VB_H, C['paper']))

# ================= title =================
e('<g fill="%s">' % C['ink'])
e('<text x="-250" y="-352" font-size="26" letter-spacing="3">大观园复原平面图</text>')
e('<text x="-250" y="-330" font-size="10.5" fill="%s">画布 500 m × 500 m(25 ha)· 上 = 北,下 = 南(svg y = z)· 1 svg 单位 = 1 m</text>' % C['muted'])
e('<text x="-250" y="-315" font-size="10.5" fill="%s">数据源 projects/daguanyuan/plan.json · 裁决源 04-conflicts.md · 取证 01 / 02 / 03 篇</text>' % C['muted'])
e('<text x="-250" y="-300" font-size="10" fill="%s">尺度双路会合:三里半周长义 × 营造尺 → 504 m;童力群 372 亩 → 498 m(差 1.2%%),可调 437–564 m</text>' % C['muted'])
e('</g>')

# ================= compass =================
e('<g transform="translate(-268,-215)">')
e('<line x1="0" y1="26" x2="0" y2="-20" stroke="%s" stroke-width="2" marker-end="url(#ah)"/>' % C['route'])
e('<circle cx="0" cy="0" r="27" fill="none" stroke="%s" stroke-width="0.8"/>' % C['panelEdge'])
e('<text x="0" y="-24" font-size="12" text-anchor="middle" fill="%s">北</text>' % C['ink'])
e('<text x="0" y="37" font-size="10" text-anchor="middle" fill="%s">南</text>' % C['muted'])
e('</g>')

# ================= wall =================
e('<!-- 外墙 -->')
e('<polygon points="%s" fill="%s" stroke="%s" stroke-width="5" stroke-linejoin="round"/>'
  % (pts(d['wall']), C['wallfill'], C['wall']))
# bounding box of the 500x500 canvas (dotted reference)
e('<rect x="-250" y="-250" width="500" height="500" fill="none" stroke="%s" stroke-width="0.8" '
  'stroke-dasharray="3 5"/>' % C['panelEdge'])

# ================= hills =================
e('<!-- 山 -->')
for h in d['hills']:
    p = h['polygon']
    e('<g><title>%s(高 %s m)</title>' % (esc(h['name']), h.get('height_m')))
    e('<polygon points="%s" fill="%s" fill-opacity="0.85" stroke="%s" stroke-width="1.4"/>'
      % (pts(p), C['hill'], C['hilledge']))
    e('<polygon points="%s" fill="url(#hillhatch)" stroke="none"/>' % pts(p))
    e('</g>')

# ================= water =================
e('<!-- 水 -->')
for w in d['water']:
    p = w['polygon']
    e('<g><title>%s(深 %s m)</title>' % (esc(w['name']), w.get('depth_m')))
    e('<polygon points="%s" fill="%s" stroke="%s" stroke-width="1.2" stroke-linejoin="round"/>'
      % (pts(p), C['water'], C['wateredge']))
    e('</g>')

# hill / water name labels
hl = [('翠嶂 11m', 33, 218), ('大主山 26m', -148, -198), ('青山 14m', -142, 42),
      ('凸碧山 18m', 208, 118), ('花溆盘道山 12m', -46, -154), ('篱外土坡 7m', -170, -4)]
e('<g font-size="9" fill="#7a5f33" font-style="italic">')
for t, x, z in hl:
    e('<text x="%d" y="%d" text-anchor="middle">%s</text>' % (x, z, t))
e('</g>')
wl = [('主池', -10, -56), ('南池', 16, 158), ('东池', 150, 14),
      ('沁芳溪·北段', 98, -136), ('沁芳溪·西段', -198, 88), ('沁芳溪·南段', -95, 214)]
e('<g font-size="9" fill="#2f6b74" font-style="italic">')
for t, x, z in wl:
    e('<text x="%d" y="%d" text-anchor="middle">%s</text>' % (x, z, t))
e('</g>')

# ================= paths (non-route) =================
e('<!-- 路 -->')
for p in d['paths'][1:]:
    e('<g><title>%s</title><polyline points="%s" fill="none" stroke="%s" stroke-width="2.6" '
      'stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="10 6" opacity="0.9"/></g>'
      % (esc(p['name']), pts(p['points']), C['road']))

# ================= regions =================
e('<!-- 区域 -->')
regions = {r['id']: r for r in d['regions']}
for r in d['regions']:
    col = TIER_COLOR.get(r.get('tier'), C['Cc'])
    dash = CONF_DASH.get(r.get('confidence'), 'none')
    e('<g><title>%s · tier %s · confidence %s · 标高 %s m</title>'
      % (esc(r['name']), r.get('tier'), r.get('confidence'), r.get('elevation_m')))
    e('<polygon points="%s" fill="%s" fill-opacity="0.20" stroke="%s" stroke-width="2" '
      'stroke-dasharray="%s" stroke-linejoin="round"/>' % (pts(r['polygon']), col, col, dash))
    for en in r.get('entrances', []):
        e('<circle cx="%.1f" cy="%.1f" r="2.6" fill="%s" stroke="%s" stroke-width="0.8"/>'
          % (en[0], en[1], C['paper'], col))
    e('</g>')

# Explicit ground, deck and boat-opening footprints are different surfaces.
for r in d['regions']:
    for pad in r.get('pads', []):
        colour = {'grade':'#927441','deck':'#386c88','water-opening':'#338884'}[pad['kind']]
        e('<g><title>%s · %s · %.2fm</title><polygon points="%s" fill="%s" fill-opacity="0.3" stroke="%s" stroke-width="0.8" stroke-dasharray="2 1"/></g>' % (esc(pad['id']),pad['kind'],pad['elevation_m'],pts(pad['polygon']),colour,colour))

# Actual wall centerlines and registered openings from P2 linear construction.
for r in d['regions']:
    for wall in r.get('linears', []):
        e('<g><title>%s</title><polyline points="%s" fill="none" stroke="#5a5245" stroke-width="1.1"/>' % (esc(wall['id']),pts(wall['points'])))
        for insert in wall.get('inserts', []):
            x,z=insert['at']
            e('<circle cx="%.2f" cy="%.2f" r="1.8" fill="%s" stroke="#5a5245" stroke-width="0.7"><title>%s</title></circle>' % (x,z,C['paper'],esc(insert.get('object',insert['variant']))))
        e('</g>')

# ================= gates =================
for connection in connection_report['connections']:
    spec=connection['spec']
    colour='#944b40' if spec.get('railingMaterial')=='vermilion' else '#8a5a3e' if spec.get('deckMaterial')=='wood' else '#687b7d'
    e('<g><title>%s · 可生成桥构件，整园装配待验</title><polygon points="%s" fill="%s" fill-opacity="0.5" stroke="%s" stroke-width="0.55"/></g>' % (esc(spec['id']),pts(connection['polygon']),colour,colour))

# ================= gates =================
e('<!-- 32项施工骨架：柱网实线、屋面保守包络虚线；不表示已建实景 -->')
for building in construction['objects']:
    for footprint in building['footprints']:
        e('<g><title>%s · %s · %s</title>' % (
            esc(building_names[building['id']]), esc(footprint['id']),
            '有单体模型，非实景装配证明' if building['meshFactoryAvailable'] else '仅施工骨架，细部几何待P3'))
        e('<polygon points="%s" fill="none" stroke="#625046" stroke-width="0.45" stroke-dasharray="1.3 1"/>' % pts(footprint['roof']))
        if footprint['body']:
            e('<polygon points="%s" fill="%s" fill-opacity="0.22" stroke="#625046" stroke-width="0.7"/>' % (pts(footprint['body']), 'none' if building['boat'] else '#8b6c51'))
        for x,z in footprint['columns']:
            e('<circle cx="%.3f" cy="%.3f" r="%.3f" fill="#554336"/>' % (x,z,footprint['columnRadius']))
        e('</g>')

# ================= gates =================
e('<!-- 门 -->')
GATE_LBL = {  # name-key -> (anchor, dx, dz)
    '正门': ('middle', 0, 34), '后门': ('middle', 6, -14), '东便门': ('start', 14, 3),
    '西角门(通王夫人正房方向)': ('end', -14, 3), '西角门(通贾母房方向)': ('end', -14, 3),
    '聚锦门': ('middle', -30, 22),
}
for g in d['gates']:
    key = g['name'] if g['name'] in GATE_LBL else short(g['name'])
    anchor, dx, dz = GATE_LBL.get(key, ('middle', 0, 14))
    main = g['name'].startswith('正门')
    col = C['A'] if main else C['wall']
    rr = 6.5 if main else 4.5
    e('<g><title>%s · facing %s</title>' % (esc(g['name']), g['facing']))
    e('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="%s" stroke-width="1.2" '
      'transform="rotate(45 %.1f %.1f)"/>' % (g['x'] - rr, g['z'] - rr, rr * 2, rr * 2,
                                              C['paper'], col, g['x'], g['z']))
    e('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s"/>' % (g['x'], g['z'], rr * 0.45, col))
    e('<text x="%.1f" y="%.1f" font-size="%s" text-anchor="%s" fill="%s" stroke="%s" '
      'stroke-width="2.4" paint-order="stroke" font-weight="%s">%s</text>'
      % (g['x'] + dx, g['z'] + dz, '11.5' if main else '9', anchor, col, C['paper'],
         'bold' if main else 'normal', esc(short(g['name']))))
    e('</g>')
# 正门 callout
e('<text x="55" y="292" font-size="9" text-anchor="middle" fill="%s">五间 · 桶瓦泥鳅脊 · 白石台矶 · '
  '南墙偏东 · 门内遮挡为目标(三维待验)</text>' % C['muted'])

# water in / out annotations
e('<g font-size="9" fill="#2f6b74">')
e('<line x1="252" y1="-244" x2="216" y2="-228" stroke="%s" stroke-width="2" marker-end="url(#ahw)"/>' % C['wateredge'])
e('<text x="316" y="-250" font-size="9.5" text-anchor="end">外河引水(东北进水)</text>')
e('<line x1="184" y1="236" x2="206" y2="252" stroke="%s" stroke-width="2" marker-end="url(#ahw)"/>' % C['wateredge'])
e('<text x="210" y="258" font-size="9.5">墙下涵洞出水(L4 推测)</text>')
e('</g>')

# ================= 不可违约束 strip (bottom band under the garden) =================
CN = ["1 缀锦阁在大观楼东、含芳阁在西(十八回,唯一东西向硬标尺)",
      "2 藕香榭在中轴以东池中,与缀锦阁隔水可闻乐(十八 / 四十回)",
      "3 凸碧(脊)—凹晶(山下近水)—池沿竹栏—藕香榭 四点连通;嘉荫堂上山 ≤ 百余步缓坡宽路",
      "4 水系线状五段:外河 → 沁芳闸(东北)→ 洞口 → 东北山坳 → 稻香村 →〔岔口 → 西南〕→ 怡红院后合流 → 墙下出园",
      "5 翠嶂全遮门内视线,正门内不得望见任何院落或正殿(十七回贾政语)",
      "6 十七回游线须连续走通且成环(小径入 / 另一边出),至正殿累计路程 ≈ 全程 55%",
      "7 暖香坞正门朝南,院落在东西向夹道之北,西门额「穿云 / 度月」,东门外接山坡(五十回)"]
e('<rect x="-252" y="296" width="506" height="84" rx="5" fill="%s" stroke="%s" stroke-width="1.2"/>'
  % (C['panel'], C['panelEdge']))
e('<text x="-242" y="311" font-size="10" fill="%s" letter-spacing="1">七条不可违约束(任何布局调整后须复检 · 出自 04-conflicts.md §四)</text>' % C['ink'])
for i, t in enumerate(CN):
    e('<text x="%.1f" y="%.1f" font-size="7.6" fill="%s">%s</text>'
      % (-242, 322 + i * 8.8, C['muted'], esc(t)))

# ================= route (17th chapter tour) =================
route_data = narrative['source']
route_line = [route_data['legs'][0]['points'][0]]
for leg in route_data['legs']:
    route_line.extend(leg['points'][1:])
e('<g id="narrative-route"><title>第17回29节点规划路线：未完成全线实景通行验收</title>')
e('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' % (pts(route_line),C['route']))
for leg in route_data['legs']:
    candidates = [(a,b) for a,b in zip(leg['points'],leg['points'][1:]) if math.dist(a,b)>12]
    if candidates:
        a,b=candidates[len(candidates)//2]
        mx,mz=(a[0]+b[0])/2,(a[1]+b[1])/2
        dx,dz=b[0]-a[0],b[1]-a[1];L=math.hypot(dx,dz)
        e('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="0.8" marker-end="url(#ah)"/>' % (mx-dx/L*2,mz-dz/L*2,mx+dx/L*2,mz+dz/L*2,C['route']))
e('</g>')

# Five unentered scenic groups share node25; the observer is on the return leg.
e('<g id="distant-scenes">')
for i,scene in enumerate(d.get('distantScenes',[])):
    observation=next(o for o in route_data['observations'] if o['scene']==scene['id'])
    ox,oz=observation['at'];tx,tz=scene['at']
    e('<g><title>D%d %s：仅规划范围，远景模型与视线待验</title>' % (i+1,esc(scene['name'])))
    e('<polygon points="%s" fill="#668b76" fill-opacity="0.13" stroke="#476e59" stroke-width="0.8" stroke-dasharray="2 1"/>' % pts(scene['polygon']))
    e('<line x1="%s" y1="%s" x2="%s" y2="%s" stroke="#476e59" stroke-width="0.5" stroke-dasharray="1 2"/>' % (ox,oz,tx,tz))
    e('<text x="%s" y="%s" font-size="5" fill="#305a43">D%d</text></g>' % (tx,tz,i+1))
e('</g>')

# Dots stay at their true route coordinates; only labels may use a leader.
DOTS=[]
for node in route_data['nodes']:
    if node['order']==29:continue
    x,z=node['at'];n=str(node['order']);kind=node['kind']
    label='1/29' if node['order']==1 else n
    r=3.2 if kind=='station' else 2.2
    fill=C['route'] if kind=='station' else C['paper']
    ink=C['paper'] if kind=='station' else C['route']
    if kind=='scene':shape='<rect x="%.2f" y="%.2f" width="4.4" height="4.4" rx="0.6" fill="%s" stroke="%s" stroke-width="0.6"/>' % (x-r,z-r,fill,C['route'])
    else:shape='<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s" stroke="%s" stroke-width="0.6"/>' % (x,z,r,fill,C['route'])
    if node['order']==1:
        text='<text x="%.2f" y="%.2f" font-size="5" fill="%s" stroke="%s" stroke-width="1.4" paint-order="stroke">%s</text>' % (x+5,z-2,C['route'],C['paper'],label)
    else:text='<text x="%.2f" y="%.2f" font-size="3.2" text-anchor="middle" fill="%s">%s</text>' % (x,z+1.1,ink,label)
    DOTS.append('<g data-route-node="%s"><title>%s %s · %s</title>%s%s</g>' % (node['id'],label,esc(node['name']),kind,shape,text))

# ================= region labels (drawn above route so text stays readable) =================
LBL = {  # id -> (dx, dz) nudge to dodge route dots / neighbours
    'zhengmen': (-46, -6), 'cuizhang': (30, -14), 'qinfang_ting_qiao': (-34, 4),
    'xiaoxiangguan': (-6, -4), 'daoxiangcun': (14, 0), 'hengwuyuan': (-4, 4),
    'shengqin_biesu': (-4, 4), 'yihongyuan': (-8, -6), 'ouxiangxie': (-4, 4),
    'zilingzhou': (-16, -6), 'qiushuangzhai': (-8, 6), 'longcuian': (-6, 0),
    'tubi_aojing': (-6, -14), 'nuanxiangwu': (0, 6), 'qinfangzha': (-24, 0),
    'liaoting_huaxu': (-4, 40), 'luxueguang': (-14, 0), 'jiayintang': (-8, 4),
    'huajia_huapu': (6, 0),
}
e('<g text-anchor="middle">')
for r in d['regions']:
    cx, cz = centroid(r['polygon'])
    dx, dz = LBL.get(r['id'], (0, 0))
    x, z = cx + dx, cz + dz
    col = TIER_COLOR.get(r.get('tier'), C['Cc'])
    nm = short(r['name'])
    e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s" stroke="%s" stroke-width="1.8" '
      'paint-order="stroke" stroke-linejoin="round">%s</text>' % (x, z, C['ink'], C['paper'], esc(nm)))
    e('<text x="%.1f" y="%.1f" font-size="5.5" fill="%s" stroke="%s" stroke-width="1.6" '
      'paint-order="stroke">%s级·信度%s</text>'
      % (x, z + 7, col, C['paper'], r.get('tier'), CONF_CN.get(r.get('confidence'), '?')))
e('</g>')

e('<!-- 游线站次 -->')
e('<g>')
for _d in DOTS:
    e(_d)
e('</g>')

# ================= right column: region index =================
def panel(x, y, w, h, title):
    e('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="5" fill="%s" stroke="%s" '
      'stroke-width="1.2"/>' % (x, y, w, h, C['panel'], C['panelEdge']))
    e('<text x="%.1f" y="%.1f" font-size="13" fill="%s" letter-spacing="1">%s</text>'
      % (x + 12, y + 22, C['ink'], title))

# route event index; the 19 areas remain labelled on the map.
IDX_Y = -340
panel(RX0, IDX_Y, RX1-RX0, 338, '第十七回路线 · 29节点')
e('<text x="%.1f" y="%.1f" font-size="8" fill="%s">站=停驻 / 点=转折或通路 / 景=沿途观赏；实景通行待验</text>' % (RX0+12,IDX_Y+36,C['muted']))
y=IDX_Y+50
for node in route_data['nodes']:
    kind={'station':'站','waypoint':'点','scene':'景'}[node['kind']]
    e('<text x="%.1f" y="%.1f" font-size="8" fill="%s">%02d · %s</text>' % (RX0+12,y,C['route'],node['order'],kind))
    e('<text x="%.1f" y="%.1f" font-size="8.4" fill="%s">%s</text>' % (RX0+54,y,C['ink'],esc(node['name'])))
    y+=9.6

# measured facts (computed from the very geometry drawn above)
def _plen(pl):
    return sum(math.hypot(pl[i+1][0]-pl[i][0], pl[i+1][1]-pl[i][1]) for i in range(len(pl)-1))
def _area(pl):
    q = pl if pl[0] == pl[-1] else pl + [pl[0]]
    return abs(sum(q[i][0]*q[i+1][1] - q[i+1][0]*q[i][1] for i in range(len(q)-1))) / 2
PERIM = _plen(d['wall'])
AREA = _area(d['wall']) / 1e4
RLEN = narrative['compiled']['length']
RATIO = narrative['compiled']['milestone']['ratio']

# ================= legend =================
LG_Y = y + 18
LG_H = 290
panel(RX0, LG_Y, RX1 - RX0, LG_H, '图例')
gy = LG_Y + 40
def row(draw, text, gap=16.5):
    global gy
    draw(gy)
    e('<text x="%.1f" y="%.1f" font-size="9.5" fill="%s">%s</text>' % (RX0 + 54, gy + 3.5, C['ink'], text))
    gy += gap

row(lambda t: e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="5"/>'
                % (RX0 + 12, t, RX0 + 46, t, C['wall'])), '园墙(折线包络;实测周长 %.0f m,目标 2016 m)' % PERIM)
row(lambda t: e('<rect x="%.1f" y="%.1f" width="34" height="10" fill="%s" stroke="%s" stroke-width="1.2"/>'
                % (RX0 + 12, t - 5, C['water'], C['wateredge'])), '水面 / 溪渠(三级:池 40–80 m,溪 8–15 m,沟 0.3–2.5 m)')
row(lambda t: (e('<rect x="%.1f" y="%.1f" width="34" height="10" fill="%s" stroke="%s" stroke-width="1.2"/>'
                 % (RX0 + 12, t - 5, C['hill'], C['hilledge'])),
               e('<rect x="%.1f" y="%.1f" width="34" height="10" fill="url(#hillhatch)"/>' % (RX0 + 12, t - 5))),
    '堆山(注高程 m)')
row(lambda t: e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2.6" '
                'stroke-dasharray="10 6"/>' % (RX0 + 12, t, RX0 + 46, t, C['road'])), '园路 / 盘道 / 甬路')
row(lambda t: (e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="3.4" '
                 'marker-end="url(#ah)"/>' % (RX0 + 12, t, RX0 + 42, t, C['route'])),
               e('<circle cx="%.1f" cy="%.1f" r="6" fill="%s" stroke="%s" stroke-width="1.4"/>'
                 % (RX0 + 26, t, C['route'], C['paper']))), '29叙事节点与五组未入远景;通行与视线待验')
row(lambda t: e('<rect x="%.1f" y="%.1f" width="34" height="10" fill="#927441" fill-opacity="0.3" stroke="#927441" stroke-dasharray="2 1"/>' % (RX0+12,t-5)), '显式落脚面:土色陆地 / 蓝色跨水 / 青色水洞')
row(lambda t: e('<rect x="%.1f" y="%.1f" width="28" height="9" fill="#8b6c51" fill-opacity="0.22" stroke="#625046"/>' % (RX0+15,t-4)), '建筑/桥面施工轮廓;虚线为屋面包络,装配另验')
for tier in ('A', 'B', 'C'):
    row(lambda t, tier=tier: e('<rect x="%.1f" y="%.1f" width="34" height="11" fill="%s" fill-opacity="0.2" '
                               'stroke="%s" stroke-width="2"/>' % (RX0 + 12, t - 5.5, TIER_COLOR[tier], TIER_COLOR[tier])),
        '%s 级 — %s' % (tier, TIER_NAME[tier]))
for cf, lb in (('high', '关系证据高(L1;轮廓尺寸另作设计)'), ('medium', '关系证据中(L2 共识)'), ('low', '关系证据低(L4 推测,可改)')):
    row(lambda t, cf=cf: e('<rect x="%.1f" y="%.1f" width="34" height="11" fill="none" stroke="%s" '
                           'stroke-width="2" stroke-dasharray="%s"/>' % (RX0 + 12, t - 5.5, C['muted'], CONF_DASH[cf])),
        lb)
row(lambda t: (e('<rect x="%.1f" y="%.1f" width="9" height="9" fill="%s" stroke="%s" stroke-width="1.2" '
                 'transform="rotate(45 %.1f %.1f)"/>' % (RX0 + 24, t - 4.5, C['paper'], C['wall'], RX0 + 28.5, t)),
               e('<circle cx="%.1f" cy="%.1f" r="2" fill="%s"/>' % (RX0 + 28.5, t, C['wall']))), '园门(6 处;正门朱标)')
row(lambda t: e('<circle cx="%.1f" cy="%.1f" r="2.6" fill="%s" stroke="%s" stroke-width="0.9"/>'
                % (RX0 + 28.5, t, C['paper'], C['muted'])), '景区出入口(entrances)')

# ================= scale bar =================
SB_Y = LG_Y + LG_H + 30
e('<g>')
e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2"/>'
  % (RX0 + 12, SB_Y, RX0 + 212, SB_Y, C['ink']))
for i in range(5):
    x = RX0 + 12 + i * 50
    e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2"/>' % (x, SB_Y - 6, x, SB_Y + 6, C['ink']))
for i in range(0, 4, 2):
    e('<rect x="%.1f" y="%.1f" width="50" height="6" fill="%s"/>' % (RX0 + 12 + i * 50, SB_Y - 6, C['ink']))
    e('<rect x="%.1f" y="%.1f" width="50" height="6" fill="none" stroke="%s" stroke-width="0.8"/>'
      % (RX0 + 12 + (i + 1) * 50, SB_Y - 6, C['ink']))
for i, lab in enumerate(('0', '50', '100', '150', '200 m')):
    e('<text x="%.1f" y="%.1f" font-size="9" text-anchor="middle" fill="%s">%s</text>'
      % (RX0 + 12 + i * 50, SB_Y + 18, C['ink'], lab))
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">1 svg 单位 = 1 m(世界坐标直出:svg x = x,svg y = z)</text>'
  % (RX0 + 12, SB_Y + 34, C['muted']))
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">图上实测:墙内 %.1f ha · 选定步行折线 %.0f m</text>'
  % (RX0 + 12, SB_Y + 47, C['muted'], AREA, RLEN))
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">第23节点牌坊累计 %.1f%%(平面里程,非实景通行验收)</text>'
  % (RX0 + 12, SB_Y + 60, C['muted'], RATIO * 100))
e('</g>')

e('</svg>')
svg = '\n'.join(out)
open(OUT, 'w', encoding='utf-8').write(svg)
print('wrote', OUT, len(svg), 'bytes')
print('viewBox %d %d %d %d  px %dx%d' % (VB_X, VB_Y, VB_W, VB_H, W_PX, H_PX))
print('narrative nodes:', len(route_data['nodes']), 'planned length:', round(RLEN,1), 'milestone:', round(RATIO,4))
print('right column bottom y =', SB_Y + 34, '(vb bottom', VB_Y + VB_H, ')')
