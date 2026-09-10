# -*- coding: utf-8 -*-
"""projects/daguanyuan/plan.json -> plan.svg (hand-written SVG, no external resources)"""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '..', 'projects', 'daguanyuan', 'plan.json')
OUT = os.path.join(HERE, 'plan.svg')
d = json.load(open(SRC, encoding='utf-8'))

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
route_line = d['paths'][0]['points']
e('<!-- 十七回游线 -->')
e('<g><title>%s</title>' % esc(d['paths'][0]['name']))
e('<polyline points="%s" fill="none" stroke="%s" stroke-width="3.4" stroke-linecap="round" '
  'stroke-linejoin="round" opacity="0.95"/>' % (pts(route_line), C['route']))
# direction arrows every k segments
for i in range(2, len(route_line) - 1, 5):
    x0, z0 = route_line[i]; x1, z1 = route_line[i + 1]
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    dx, dz = x1 - x0, z1 - z0
    L = math.hypot(dx, dz) or 1
    e('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2" '
      'marker-end="url(#ah)"/>' % (mx - dx / L * 4, mz - dz / L * 4, mx + dx / L * 4, mz + dz / L * 4, C['route']))
e('</g>')

# station dots: 每站落在该区自己的 entrances 上(第 n 次到访取第 n 个门),缺则取形心
route = d['route_ch17']
visits, stations = {}, []
for k, rid in enumerate(route):
    r = regions[rid]
    v = visits.get(rid, 0); visits[rid] = v + 1
    ents = r.get('entrances') or []
    sx, sz = ents[min(v, len(ents) - 1)] if ents else centroid(r['polygon'])
    if rid == 'zhengmen':
        sz -= 14                                            # 让开正门门标
    merged = False
    for t, st in enumerate(stations):                       # 同区同点(环线首尾)合并成一颗
        if st[1] == rid and abs(st[2] - sx) < 6 and abs(st[3] - sz) < 6:
            stations[t] = (st[0] + '·' + str(k + 1), rid, st[2], st[3]); merged = True; break
    if merged:
        continue
    while any(abs(sx - px) < 13 and abs(sz - pz) < 13 for _, _, px, pz in stations):
        sx += 16; sz += 7
    stations.append((str(k + 1), rid, sx, sz))

DOTS = []
for n, rid, x, z in stations:
    w = 17 if len(n) <= 2 else 30
    DOTS.append('<g><title>%s. %s</title>'
                '<rect x="%.1f" y="%.1f" width="%.1f" height="17" rx="8.5" fill="%s" stroke="%s" stroke-width="1.6"/>'
                '<text x="%.1f" y="%.1f" font-size="9.5" text-anchor="middle" fill="#fff" font-weight="bold">%s</text></g>'
                % (n, esc(regions[rid]['name']), x - w / 2, z - 8.5, w, C['route'], C['paper'], x, z + 3.4, n))

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
    e('<text x="%.1f" y="%.1f" font-size="11" fill="%s" stroke="%s" stroke-width="2.6" '
      'paint-order="stroke" stroke-linejoin="round">%s</text>' % (x, z, C['ink'], C['paper'], esc(nm)))
    e('<text x="%.1f" y="%.1f" font-size="7.5" fill="%s" stroke="%s" stroke-width="2.2" '
      'paint-order="stroke">%s级·信度%s</text>'
      % (x, z + 10, col, C['paper'], r.get('tier'), CONF_CN.get(r.get('confidence'), '?')))
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

# route station index
IDX_Y = -340
n_rows = len(d['regions'])
panel(RX0, IDX_Y, RX1 - RX0, 30 + n_rows * 14.5 + 20, '景区索引(19 区)')
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">序号 = 十七回游线站次;'
  '× = 不在游线上</text>' % (RX0 + 12, IDX_Y + 36, C['muted']))
order = {}
for n, rid, _, _ in stations:
    order.setdefault(rid, []).append(n)
y = IDX_Y + 52
for r in d['regions']:
    col = TIER_COLOR.get(r.get('tier'), C['Cc'])
    num = '·'.join(str(n) for n in order.get(r['id'], [])) or '×'
    e('<rect x="%.1f" y="%.1f" width="7" height="7" fill="%s" fill-opacity="0.25" stroke="%s" '
      'stroke-width="1" stroke-dasharray="%s"/>' % (RX0 + 12, y - 6, col, col,
                                                    CONF_DASH.get(r.get('confidence'), 'none')))
    e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s" text-anchor="end">%s</text>'
      % (RX0 + 40, y, C['route'] if num != '×' else C['muted'], num))
    e('<text x="%.1f" y="%.1f" font-size="9.5" fill="%s">%s</text>'
      % (RX0 + 46, y, C['ink'], esc(r['name'] if len(r['name']) <= 26 else r['name'][:25] + '…')))
    y += 14.5

# measured facts (computed from the very geometry drawn above)
def _plen(pl):
    return sum(math.hypot(pl[i+1][0]-pl[i][0], pl[i+1][1]-pl[i][1]) for i in range(len(pl)-1))
def _area(pl):
    q = pl if pl[0] == pl[-1] else pl + [pl[0]]
    return abs(sum(q[i][0]*q[i+1][1] - q[i+1][0]*q[i][1] for i in range(len(q)-1))) / 2
PERIM = _plen(d['wall'])
AREA = _area(d['wall']) / 1e4
WAREA = sum(_area(w['polygon']) for w in d['water']) / 1e4
RLEN = _plen(route_line)
_c = [0.0]
for i in range(1, len(route_line)):
    _c.append(_c[-1] + math.hypot(route_line[i][0]-route_line[i-1][0], route_line[i][1]-route_line[i-1][1]))
_hall = regions['shengqin_biesu']['entrances'][0]
_j = min(range(len(route_line)), key=lambda i: (route_line[i][0]-_hall[0])**2 + (route_line[i][1]-_hall[1])**2)
RATIO = _c[_j] / RLEN

# ================= legend =================
LG_Y = y + 18
LG_H = 270
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
                 % (RX0 + 26, t, C['route'], C['paper']))), '14个区域站次;29叙事节点及通行待验')
row(lambda t: e('<rect x="%.1f" y="%.1f" width="34" height="10" fill="#927441" fill-opacity="0.3" stroke="#927441" stroke-dasharray="2 1"/>' % (RX0+12,t-5)), '显式落脚面:土色陆地 / 蓝色跨水 / 青色水洞')
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
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">图上实测:墙内 %.1f ha · 水面 %.2f ha(%.1f%%)· 游线全长 %.0f m</text>'
  % (RX0 + 12, SB_Y + 47, C['muted'], AREA, WAREA, WAREA / AREA * 100, RLEN))
e('<text x="%.1f" y="%.1f" font-size="8.5" fill="%s">入口最近控制点占比 %.1f%%(仅折线诊断,非29节点验收)</text>'
  % (RX0 + 12, SB_Y + 60, C['muted'], RATIO * 100))
e('</g>')

e('</svg>')
svg = '\n'.join(out)
open(OUT, 'w', encoding='utf-8').write(svg)
print('wrote', OUT, len(svg), 'bytes')
print('viewBox %d %d %d %d  px %dx%d' % (VB_X, VB_Y, VB_W, VB_H, W_PX, H_PX))
print('stations:', [(n, rid, round(x), round(z)) for n, rid, x, z in stations])
print('right column bottom y =', SB_Y + 34, '(vb bottom', VB_Y + VB_H, ')')
