#!/usr/bin/env python3
"""从参考图逐件抠出卡片上的六件文具。

参考图不随仓库分发；产物已提交入库，只有需要重新抠图时才用得上这个脚本。

    python3 scripts/assets/make-stationery.py <参考图.png> [输出目录]

原理：背景（纸面/墙面）近乎纯白且平滑，观测到的像素是
    obs = a * F + (1 - a) * B
先逐行估计出背景场 B，再解出 a 与 F。半透明的胶带与不透明的金属件用同一套
公式，不需要分别处理。

裁切框与要抹掉的干扰（相邻卡片的边、压在文具下面的墨迹）写死在文件末尾，
它们是针对这一张参考图量出来的坐标。

依赖：numpy、Pillow
"""

import os
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "paper.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/assets/paper/stationery"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGB")
RGB = np.asarray(img, dtype=np.float32)


def dilate(mask, r):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
    return out


def label(mask):
    """4 邻接连通域标记（这些裁切都很小，BFS 足够快）"""
    h, w = mask.shape
    lab = np.zeros((h, w), dtype=np.int32)
    cur = 0
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or lab[sy, sx]:
                continue
            cur += 1
            stack = [(sy, sx)]
            lab[sy, sx] = cur
            while stack:
                y, x = stack.pop()
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        stack.append((ny, nx))
    return lab, cur


def drop_paper_edge(mask):
    """剔除横穿整幅的细长条——那是卡片的撕边线，不是文具。

    这些文具都压在纸的上缘，裁切框里必然带进一段纸边。它的特征很稳定：
    宽度接近整幅、高度只有几像素。按这个形状特征剔除，比手工画遮罩稳。
    """
    lab, n = label(mask)
    h, w = mask.shape
    out = mask.copy()
    for i in range(1, n + 1):
        sel = lab == i
        ys, xs = np.nonzero(sel)
        bh, bw = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
        if bw > 0.75 * w and bh <= max(6, h * 0.10):
            out[sel] = False
    return out


def keep_main(mask, min_frac=0.06):
    """只保留主体连通域（及与它相连的投影），丢掉零散残迹"""
    lab, n = label(mask)
    if n == 0:
        return mask
    areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
    areas.sort(reverse=True)
    biggest = areas[0][0]
    out = np.zeros_like(mask)
    for a, i in areas:
        if a >= max(biggest * 0.25, mask.size * min_frac * 0.1):
            out |= lab == i
    return out


def propagate_color(fg, seed_mask, rounds=14):
    """把 seed 区域的颜色向外扩散，填掉柔边上的颜色。

    柔边像素解混出来的颜色接近纸的颜色（浅），只在浅底上成立，换到深一点的底色
    就成了物件外面一圈发光的白边。让柔边继承物件本体的颜色，浅底上依然是自然的
    软边，深底上则因为颜色本身就深而隐去——这才是真实物体该有的样子。
    """
    out = fg.copy()
    known = seed_mask.copy()
    for _ in range(rounds):
        if known.all():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(out.shape[:2], dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(np.roll(known, dy, axis=0), dx, axis=1)
            v = np.roll(np.roll(out, dy, axis=0), dx, axis=1)
            acc += v * k[..., None]
            cnt += k
        grow = (cnt > 0) & ~known
        out[grow] = (acc[grow] / cnt[grow][..., None])
        known |= grow
    return out


def row_background(crop, mask):
    """逐行估计背景。

    这里的背景不是一个常数：每件文具都压在卡片的上缘，裁切框里同时有墙
    （灰度 ~241）和纸（~247），中间是一道**水平**的亮度台阶。按列取中位数会把
    台阶两侧混在一起，纸边于是被当成物件抠了出来——那正是第一版的失败原因。
    台阶是水平的，所以逐行取中位数天然贴合它；整行都被物件盖住时（横贴的胶带）
    再纵向插值补齐，误差最多 6 个灰阶，落到半透明胶带上不到 3 阶。
    """
    h, w, _ = crop.shape
    bg = np.full((h, 3), np.nan, dtype=np.float32)
    for y in range(h):
        free = ~mask[y]
        if free.sum() >= 5:
            bg[y] = np.median(crop[y, free], axis=0)
    for ch in range(3):
        col = bg[:, ch]
        ok = ~np.isnan(col)
        if ok.sum() == 0:
            col[:] = 247.0
        else:
            col[:] = np.interp(np.arange(h), np.flatnonzero(ok), col[ok])
    return np.repeat(bg[:, None, :], w, axis=1)


def extract(name, box, *, thresh=6.0, kill=(), keep=None, grow=2, feather=True, scale=2,
            core_frac=0.45, halo=3, trim=True):
    """box=(x0,y0,x1,y1) 取自 paper.png；kill 是要抹掉的墨迹矩形（crop 内坐标）"""
    x0, y0, x1, y1 = box
    crop = RGB[y0:y1, x0:x1].copy()
    h, w, _ = crop.shape

    # 抹掉不属于该物件的墨迹：用邻近背景填充，免得它们被当成物件的一部分
    for kx0, ky0, kx1, ky1 in kill:
        patch = crop[max(0, ky0 - 3):ky1 + 3, max(0, kx0 - 3):kx1 + 3]
        fill = np.percentile(patch.reshape(-1, 3), 88, axis=0)
        crop[ky0:ky1, kx0:kx1] = fill

    # 初始背景：四周边框环的高分位（取亮侧，避开渗进环里的物件阴影）
    ring = np.concatenate([crop[:3].reshape(-1, 3), crop[-3:].reshape(-1, 3),
                           crop[:, :3].reshape(-1, 3), crop[:, -3:].reshape(-1, 3)])
    bg = np.tile(np.percentile(ring, 70, axis=0), (h, w, 1)).astype(np.float32)

    for _ in range(3):
        dev = np.abs(crop - bg).max(axis=2)
        mask = dilate(dev > thresh, grow)
        if keep is not None:
            mask &= keep
        bg = row_background(crop, mask)

    dev = np.abs(crop - bg).max(axis=2)
    mask = dilate(dev > thresh, grow)
    if keep is not None:
        mask &= keep

    # alpha：偏离背景越远越不透明。以该物件偏离量的 88 分位为满不透明的基准，
    # 半透明的胶带因此落在 0.5 左右，金属件落在 1.0
    ref = np.percentile(dev[mask], 88) if mask.any() else 1.0

    # 界定物件所在区域：先只取强响应的核心（纸边那条淡线远达不到这个强度），
    # 取主连通域，再膨胀出投影与柔边的余量。膨胀之前先剔除横穿整幅的细条，
    # 免得纸边恰好蹭到物件时被一起带进核心。
    core = keep_main(drop_paper_edge(dev > core_frac * ref))
    region = dilate(core, halo)

    alpha = np.clip(dev / max(ref, 1e-6), 0, 1)
    alpha[~(mask & region)] = 0

    # 把物件**投在纸上的影子**从 alpha 里剔掉。
    #
    # 影子在浅纸上是一圈淡淡的灰，抠图时会变成「颜色很浅、alpha 很低」的像素。
    # 这种像素只在浅色背景上成立：底色一深，半透明的浅灰就成了一圈发光的雾。
    # 物理上影子是 multiply 而不是 normal 合成，一张 RGBA 图不可能同时服务
    # 深浅两种底色。
    #
    # 所以这里只保留物件本身，影子交给 CSS 的 drop-shadow——它用半透明黑去压暗，
    # 在任何底色上都成立。
    SHADOW_CUT = 0.22
    alpha = np.clip((alpha - SHADOW_CUT) / (1 - SHADOW_CUT), 0, 1)
    if feather:
        # 轻微羽化，消掉阈值造成的硬边
        a = alpha
        k = np.array([1, 2, 1], dtype=np.float32) / 4
        for _ in range(1):
            a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 0, a)
            a = np.apply_along_axis(lambda m: np.convolve(m, k, mode="same"), 1, a)
        alpha = a

    # 解混：F = B + (obs - B) / a
    #
    # 放大倍数必须封顶。alpha 很小的那圈柔边里，(obs - B) 只有一两个灰阶，除以
    # 0.05 会被放到几十上百个灰阶、再截到纯白——白色叠在白纸上看不出问题，
    # 底色一深，每件文具外面就套了一圈刺眼的白色光晕。
    # 封在 3.5 倍以内：alpha ≥ 0.29 的部分（物件本体）解混仍然精确，
    # 低于这个值的柔边只做温和还原。
    MAX_GAIN = 3.5
    gain = np.minimum(1.0 / np.maximum(alpha, 1e-3), MAX_GAIN)[..., None]
    fg = np.clip(bg + (crop - bg) * gain, 0, 255)

    # 柔边继承本体颜色，但**投影不动**：投影比背景暗，本来就该保留自己的深色，
    # 换成物件的颜色会让黄铜图钉在纸上投出一片金色。
    #
    # 不要顺手给「核心补洞再置为不透明」：回形针的圈里、长尾夹的把手下面都是
    # 真的镂空，补上以后底色一深就是两块白斑。
    darker = crop.mean(axis=2) < bg.mean(axis=2) - 1.5
    seed = (alpha > 0.62) | (darker & (alpha > 0.06))
    if seed.any():
        fg = np.where(seed[..., None], fg, propagate_color(fg, seed))

    rgba = np.dstack([fg, alpha * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")

    live = alpha > 0.035
    ys, xs = np.nonzero(live)
    bb = None
    if trim and live.any():
        # 裁到实际内容，边缘留 2px 余量。素材尺寸即物件尺寸，CSS 定位才好算
        bb = (max(0, int(xs.min()) - 2), max(0, int(ys.min()) - 2),
              min(w, int(xs.max()) + 3), min(h, int(ys.max()) + 3))
        im = im.crop(bb)
    if scale != 1:
        im = im.resize((im.width * scale, im.height * scale), Image.LANCZOS)
    im.save(f"{OUT}/{name}.png", optimize=True)

    print(f"{name:22s} 源 {w}x{h} 裁 {bb} -> 输出 {im.width}x{im.height} "
          f"(@1x {im.width // scale}x{im.height // scale})  可见 {live.mean():5.1%}")
    return alpha, bg, crop


# 各文具在 paper.png 中的位置，以及要在抠图前抹平的干扰。
#
# kill 里绝大多数不是墨迹而是**卡片的撕边线**：每件文具都压在纸的边缘，
# 裁切框里必然带进一段邻近卡片的边。那条线与文具同样是"偏离背景"的，
# 不先抹掉就会被当成物件的一部分抠出来——这正是素材包 extracted/ 的通病。

extract("pushpin-brass", (52, 34, 118, 112), thresh=5.0,
        kill=[(56, 24, 66, 50)])                       # 右侧蓝色下划线一角

extract("paperclip-silver", (584, 2, 664, 106), thresh=5.0,
        kill=[(0, 20, 26, 38),                         # 左侧：邻卡上缘
              (60, 48, 80, 104)])                      # 右侧黑色 "Z" 与紫色下划线

extract("tape-kraft", (1274, 2, 1416, 60), thresh=4.0,
        kill=[(0, 42, 8, 56)])                         # 胶带左侧露出的卡片上缘

extract("washi-blue", (16, 470, 132, 570), thresh=4.5,
        kill=[(14, 0, 60, 14),                         # 胶带左上：DMIT 卡下缘
              (98, 0, 116, 14),                        # 胶带右上：同一条下缘
              (84, 62, 116, 100)])                     # 右下角黑色 "Sh" 与蓝色下划线

extract("pushpin-white", (782, 484, 858, 545), thresh=3.2)

extract("binder-clip-black", (1264, 442, 1380, 542), thresh=5.0,
        kill=[(56, 0, 116, 26),                        # 右上角 "0.0%"
              (0, 26, 50, 42),                         # 左侧：CCS 卡下缘
              (98, 26, 116, 42)])                      # 右侧：同一条下缘
