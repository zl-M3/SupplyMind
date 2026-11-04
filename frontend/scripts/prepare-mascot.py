# -*- coding: utf-8 -*-
"""把 AI 小助手建模图处理成透明背景的网页素材。

1) 从四角做洪水填充，把纯白背景变透明（机器人本体的白色区域不会被影响，因为不与边缘连通）
2) 去掉右下角"即梦AI"水印
3) 按内容裁剪并缩放，输出 public/ai-mascot.png
"""
import os

import numpy as np
from PIL import Image, ImageDraw

SRC = r"assets/mascot-source.png"  # TODO: 改成你自己机器上的源图(带透明背景的建模图)路径（原值指向上一任作者的本地路径）
DST_DIR = r"..\public"  # 相对本脚本(frontend/scripts/)输出到 frontend/public
DST = os.path.join(DST_DIR, "ai-mascot.png")

os.makedirs(DST_DIR, exist_ok=True)

im = Image.open(SRC).convert("RGB")
w, h = im.size
print("原图尺寸:", im.size)

# 1) 四角洪水填充（用洋红做标记色，原图里不可能出现）
MAGIC = (255, 0, 255)
for xy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
    ImageDraw.floodfill(im, xy, MAGIC, thresh=38)

arr = np.array(im)
is_bg = (arr[:, :, 0] == MAGIC[0]) & (arr[:, :, 1] == MAGIC[1]) & (arr[:, :, 2] == MAGIC[2])
print("背景像素占比: %.1f%%" % (is_bg.mean() * 100))

rgba = np.dstack([arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], np.where(is_bg, 0, 255).astype(np.uint8)])
out = Image.fromarray(rgba, "RGBA")

# 2) 去掉右下角水印：把该角落区域清成透明
wm_w, wm_h = int(w * 0.30), int(h * 0.16)
clear = np.zeros((h, w), dtype=bool)
clear[h - wm_h:, w - wm_w:] = True
a = np.array(out)
a[:, :, 3] = np.where(clear, 0, a[:, :, 3])
out = Image.fromarray(a, "RGBA")

# 3) 按不透明内容裁剪
alpha = np.array(out)[:, :, 3]
ys, xs = np.where(alpha > 8)
if len(xs) == 0:
    raise SystemExit("没找到内容")
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
pad_x = int((x1 - x0) * 0.04)
pad_y = int((y1 - y0) * 0.04)
box = (max(0, x0 - pad_x), max(0, y0 - pad_y), min(w, x1 + pad_x), min(h, y1 + pad_y))
print("裁剪框:", box, "内容尺寸:", (x1 - x0, y1 - y0))
out = out.crop(box)

# 4) 缩放到合适大小
max_side = 560
if max(out.size) > max_side:
    ratio = max_side / max(out.size)
    out = out.resize((int(out.width * ratio), int(out.height * ratio)), Image.LANCZOS)

out.save(DST, "PNG", optimize=True)
print("已输出:", DST, out.size, "%.1f KB" % (os.path.getsize(DST) / 1024))
