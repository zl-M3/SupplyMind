# -*- coding: utf-8 -*-
"""解析 archify 生成的 ER 图 HTML，抽出实体 / 字段 / 关系。

用法： python erd_extract.py <erd.html> <输出txt>
"""
import re
import io
import sys

src = sys.argv[1] if len(sys.argv) > 1 else ""
dst = sys.argv[2] if len(sys.argv) > 2 else "_erd_dump.txt"
html = io.open(src, encoding="utf-8").read()

starts = [(m.start(), m.group(1)) for m in re.finditer(r'<g id="node-([A-Za-z0-9_]+)"', html)]
seen = set()
blocks = []
for i, (pos, nid) in enumerate(starts):
    if nid in seen:
        continue
    seen.add(nid)
    end = starts[i + 1][0] if i + 1 < len(starts) else pos + 80000
    blocks.append((nid, html[pos:end]))

TEXT = re.compile(r'<text[^>]*>([^<]+)</text>')
BADGE = re.compile(r'data-er-badge="(pk|uk|fk|ix)"')
BADGE_WORDS = {"PK", "FK", "UK", "IX"}
TYPE_RE = re.compile(
    r'^(varchar|char|text|int|bigint|smallint|numeric|decimal|float|double|boolean|bool|'
    r'timestamp|timestamptz|datetime|date|time|json|jsonb|uuid|enum)', re.I)

entities = {}
order = []
for nid, chunk in blocks:
    label = re.search(r'data-node-label="([^"]+)"', chunk)
    tag = re.search(r'data-node-tag="([^"]+)"', chunk)
    pos = [m.start() for m in re.finditer(r'data-er-row="\d+"', chunk)]
    cols = []
    for j, p in enumerate(pos):
        seg = chunk[p: pos[j + 1] if j + 1 < len(pos) else p + 3000]
        seg = seg.split('id="node-')[0]
        texts = [t.strip() for t in TEXT.findall(seg)]
        badge = BADGE.search(seg)
        body = [t for t in texts if t not in BADGE_WORDS and t]
        if not body:
            continue
        name = body[0]
        typ = body[-1] if len(body) > 1 and TYPE_RE.match(body[-1]) else ""
        cols.append((name, typ, badge.group(1).upper() if badge else ""))
    entities[nid] = {
        "label": label.group(1) if label else nid,
        "tag": tag.group(1) if tag else "",
        "cols": cols,
    }
    order.append(nid)

edges = []
seen_e = set()
for m in re.finditer(
    r'data-edge-from="([^"]+)"\s+data-edge-to="([^"]+)"\s+data-edge-label="([^"]*)"[^>]*data-edge-id="([^"]+)"',
    html,
):
    f, t, lb, eid = m.groups()
    if eid in seen_e:
        continue
    seen_e.add(eid)
    edges.append((f, t, lb))

out = ["实体数: %d   关系数: %d" % (len(entities), len(edges)), "=" * 72]
group = None
for nid in order:
    info = entities[nid]
    if info["tag"] != group:
        group = info["tag"]
        out.append("\n###### 分组: %s" % group)
    out.append("")
    out.append("【%s】%s  字段 %d" % (nid, info["label"], len(info["cols"])))
    for name, typ, badge in info["cols"]:
        out.append("   %-4s %-28s %s" % (badge, name, typ))
out.append("")
out.append("=" * 72)
out.append("关系：")
for f, t, lb in edges:
    out.append("  %-26s -> %-26s  %s" % (f, t, lb))

text = "\n".join(out)
io.open(dst, "w", encoding="utf-8").write(text)
print("实体 %d, 关系 %d, 输出 %d 行" % (len(entities), len(edges), len(out)))
