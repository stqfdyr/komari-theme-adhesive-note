#!/usr/bin/env python3
"""从参考图重新生成纸张与墙面纹理。

参考图是本主题的设计目标（一张 AI 生成的、被钉在墙上的手写纸片仪表盘），
不随仓库分发；产物已提交入库，只有需要重新调纹理时才用得上这个脚本。

    python3 scripts/assets/make-textures.py <参考图.png> [输出目录]

方法：频谱合成，而不是从图上裁块去平铺。
纸的颗粒是各向同性的平稳随机场，裁块平铺必然留下接缝与可辨认的重复图案。
这里先测出参考图干净区域的径向功率谱，再用随机相位做逆 FFT 合成——
FFT 的结果天生周期，因此无缝；统计量（各频段能量）与参考图一致，
而成品与原图没有任何一块像素相同。

输出的是灰度 multiply 贴图：CSS 里
    background-color: <纸色>;  background-blend-mode: multiply;
纸的颜色完全由变量控制，一套素材可以配任何底色，也不会像彩色贴图那样把纸拉黄。

依赖：numpy、Pillow
"""

import os
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "paper.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/assets/paper/textures"
os.makedirs(OUT, exist_ok=True)

PATCH = 64


def boxf(a, k):
    pad = k // 2
    p = np.pad(a, pad, mode="reflect")
    c = np.cumsum(p, axis=0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    a1 = (c[k:, :] - c[:-k, :]) / k
    c = np.cumsum(a1, axis=1)
    c = np.hstack([np.zeros((c.shape[0], 1)), c])
    return (c[:, k:] - c[:, :-k]) / k


def bands(a):
    f3, f13, f41 = boxf(a, 3), boxf(a, 13), boxf(a, 41)
    return dict(std=a.std(), hi=(a - f3).std(), mid=(f3 - f13).std(), low=(f13 - f41).std())


def report(tag, a):
    b = bands(a)
    print(f"  {tag:26s} std={b['std']:5.2f}  hi={b['hi']:5.2f}  mid={b['mid']:5.2f}  low={b['low']:5.2f}")


def collect_patches(gray, mask, lo, hi, step=6, limit=400, patch=None):
    """在 mask 允许的区域里收集干净的 patch×patch 块"""
    patch = patch or PATCH
    out = []
    Hh, Ww = gray.shape
    for y in range(0, Hh - patch, step):
        for x in range(0, Ww - patch, step):
            if not mask[y:y + patch, x:x + patch].all():
                continue
            b = gray[y:y + patch, x:x + patch]
            if b.min() > lo and b.max() < hi:
                # 统一补到 PATCH 大小，功率谱的分辨率才一致
                out.append(np.pad(b, ((0, PATCH - patch), (0, PATCH - patch)), mode="reflect")
                           if patch < PATCH else b)
            if len(out) >= limit:
                return out
    return out


def radial_power(patches):
    """多块的平均功率谱，按频率半径归并成一维曲线"""
    acc = np.zeros((PATCH, PATCH))
    for p in patches:
        d = p - p.mean()
        # 加窗抑制块边界造成的谱泄漏
        w = np.hanning(PATCH)
        d = d * w[:, None] * w[None, :]
        acc += np.abs(np.fft.fft2(d)) ** 2
    acc /= len(patches)
    fy = np.fft.fftfreq(PATCH)[:, None]
    fx = np.fft.fftfreq(PATCH)[None, :]
    r = np.sqrt(fy ** 2 + fx ** 2)
    # 归并到 64 个半径档
    edges = np.linspace(0, r.max(), 65)
    idx = np.clip(np.digitize(r, edges) - 1, 0, 63)
    prof = np.zeros(64)
    for i in range(64):
        m = idx == i
        prof[i] = acc[m].mean() if m.any() else 0
    centers = 0.5 * (edges[:-1] + edges[1:])
    return centers, prof


# 大于这个尺度的结构一律不合成（像素）
LOW_CUT = 60


def synthesize(centers, prof, size, rng):
    """按径向功率谱合成 size×size 的无缝纹理。

    低频要**硬性截断**。测目标图时用的是 48px 的小块，块内统计量约束不到比块更大
    的结构；照着 48px 块的方差去合成一整张 512 的贴图，多出来的能量会全部堆到
    低频上，铺到墙面就是一片一片的霉斑。截掉 60px 以上的频率后，墙在大尺度上
    是平的，与设计稿一致。
    """
    fy = np.fft.fftfreq(size)[:, None]
    fx = np.fft.fftfreq(size)[None, :]
    r = np.sqrt(fy ** 2 + fx ** 2)
    amp = np.interp(r, centers, np.sqrt(np.maximum(prof, 0)), left=0, right=0)
    amp[r < 1.0 / LOW_CUT] = 0
    amp[0, 0] = 0  # 去掉直流，保证零均值
    phase = rng.uniform(0, 2 * np.pi, (size, size))
    # 让频谱共轭对称，逆变换才是实数
    spec = amp * np.exp(1j * phase)
    spec = 0.5 * (spec + np.conj(spec[::-1, ::-1].copy()))
    out = np.real(np.fft.ifft2(spec))
    return out


def fit_gain(synth, target_bands):
    """整体缩放到与目标一致的 std"""
    s = bands(synth)
    return target_bands["std"] / max(s["std"], 1e-6)


# 三个频段各自对应的频率区间（周期分别是 <3px、3~13px、13~41px）
BAND_FREQ = {"hi": (1 / 3.0, 0.71), "mid": (1 / 13.0, 1 / 3.0), "low": (1 / 41.0, 1 / 13.0)}


def block_bands(a, p=24, step=12):
    """按 p×p 块统计各频段，与测量目标图时的口径保持一致"""
    out = []
    for y in range(0, a.shape[0] - p, step):
        for x in range(0, a.shape[1] - p, step):
            b = a[y:y + p, x:x + p]
            out.append([b.std(), (b - boxf(b, 3)).std(),
                        (boxf(b, 3) - boxf(b, 13)).std(),
                        (boxf(b, 13) - boxf(b, 41)).std()])
    m = np.median(np.array(out), axis=0)
    return dict(std=m[0], hi=m[1], mid=m[2], low=m[3])


def match_bands(centers, prof, size, target, rng, rounds=6):
    """迭代校正径向功率谱，让合成结果的三个频段能量都对上目标图。

    单纯按整体 std 缩放会出现"细颗粒过强、中频斑驳过弱"这类分布错位——
    加窗与径向平均都会改变谱形状。这里按频段测量偏差，反过来修正谱曲线。
    """
    prof = prof.copy()
    best, best_err = None, 1e9
    for _ in range(rounds):
        synth = synthesize(centers, prof, size, rng)
        synth *= target["std"] / max(block_bands(synth)["std"], 1e-6)
        got = block_bands(synth)
        err = sum(abs(got[k] / max(target[k], 1e-6) - 1) for k in BAND_FREQ)
        if err < best_err:
            best, best_err = synth, err
        if err < 0.06:
            break
        # 每个频段按 (目标/实测)^2 修正功率（功率是幅度的平方）
        corr = np.ones_like(prof)
        for k, (f0, f1) in BAND_FREQ.items():
            ratio = target[k] / max(got[k], 1e-6)
            sel = (centers >= f0) & (centers < f1)
            corr[sel] *= np.clip(ratio ** 2, 0.25, 4.0)
        # 平滑修正曲线，避免谱上出现突变造成的环状伪影
        k5 = np.ones(5) / 5
        corr = np.convolve(np.pad(corr, 2, mode="edge"), k5, mode="valid")
        prof = prof * corr
    return best, best_err


img = Image.open(SRC).convert("RGB")
rgb = np.asarray(img, dtype=np.float32)
gray = np.asarray(img.convert("L"), dtype=np.float32)
H, W = gray.shape

rng = np.random.default_rng(20260816)

# ---------------- 纸面 ----------------
paper_mask = np.zeros((H, W), dtype=bool)
paper_mask[30:H - 30, 60:W - 90] = True
pp = collect_patches(gray, paper_mask, lo=215, hi=253, step=5, limit=600)
print(f"纸面干净块 {len(pp)} 个")
tgt_paper = {k: float(np.median([bands(p)[k] for p in pp])) for k in ("std", "hi", "mid", "low")}
print("目标图纸面：")
print(f"  {'实测中位数':26s} std={tgt_paper['std']:5.2f}  hi={tgt_paper['hi']:5.2f}  "
      f"mid={tgt_paper['mid']:5.2f}  low={tgt_paper['low']:5.2f}")

c, prof = radial_power(pp)
paper, err = match_bands(c, prof, 512, tgt_paper, rng)
print(f"合成纸纹（512×512，无缝，频段误差 {err:.3f}）：")
report("合成(整幅)", paper)
print(f"  {'合成(48px块中位)':26s} " + "  ".join(f"{k}={v:5.2f}" for k, v in block_bands(paper).items()))

# ---------------- 墙面 ----------------
# 只取画布最左侧那条：越靠近卡片，投影的柔和渐变越会被当成"墙的斑驳"统计进来。
# 用带投影的区域标定过一版，合成出的墙面全是霉斑一样的团块——
# 那些能量本来是卡片的影子，不是墙的材质。
wall_mask = np.zeros((H, W), dtype=bool)
wall_mask[:, 0:26] = True
wp = collect_patches(gray, wall_mask, lo=200, hi=253, step=2, limit=600, patch=24)
print(f"\n墙面干净块 {len(wp)} 个")
# 目标值直接用干净区域的实测：std 2.14 / hi 1.74 / mid 0.87
tgt_wall = {"std": 2.14, "hi": 1.74, "mid": 0.87, "low": 0.30}
print(f"  {'目标图墙面实测':26s} std={tgt_wall['std']:5.2f}  hi={tgt_wall['hi']:5.2f}  "
      f"mid={tgt_wall['mid']:5.2f}  low={tgt_wall['low']:5.2f}")
c2, prof2 = radial_power(wp)
wall, err2 = match_bands(c2, prof2, 512, tgt_wall, rng)
print(f"合成墙纹（512×512，无缝，频段误差 {err2:.3f}）：")
report("合成(整幅)", wall)
print(f"  {'合成(48px块中位)':26s} " + "  ".join(f"{k}={v:5.2f}" for k, v in block_bands(wall).items()))

# ---------------- 无缝性自检 ----------------
def seam_check(a, tag):
    lr = np.abs(a[:, 0] - a[:, -1]).mean()
    base = np.abs(a[:, 1] - a[:, 2]).mean()
    tb = np.abs(a[0, :] - a[-1, :]).mean()
    base2 = np.abs(a[1, :] - a[2, :]).mean()
    print(f"  {tag}: 左右接缝 {lr:.3f} / 内部基线 {base:.3f}；上下接缝 {tb:.3f} / 基线 {base2:.3f}")

print("\n无缝性（接缝差应与内部基线相当）：")
seam_check(paper, "纸纹")
seam_check(wall, "墙纹")

# ---------------- 输出 ----------------
#
# 存成灰度 multiply 贴图而不是彩色纸张图：CSS 里
#   background-color: <纸色>;  background-blend-mode: multiply;
# 纸的颜色完全由变量控制，一套素材可以配任何底色，也不会像彩色贴图那样把纸拉黄。
#
# 贴图的均值按 目标色 = 底色 × 贴图/255 反解，deviation 直接按 1× 存。
# 1× 存进 8bit 引入的量化噪声 std 只有 0.29，相对 std 2.13 的信号是 1.9% 的
# 功率增量，肉眼与统计上都可以忽略；放大存储再用 opacity 缩回来纯属自找麻烦。

def emit(detail, base, target_mean, name):
    """base=CSS 底色分量(取最亮通道)，target_mean=设计稿实测的该表面亮度"""
    mean = target_mean / base * 255.0
    scale = 255.0 / base          # 贴图上的 1 单位对应输出的 base/255 单位
    img = np.clip(mean + detail * scale, 0, 255)
    clipped = float(((mean + detail * scale) > 255).mean())
    Image.fromarray(img.round().astype(np.uint8), "L").save(f"{OUT}/{name}", optimize=True)
    out = img * base / 255.0
    print(f"  {name:18s} 底色 {base:3d} → 贴图均值 {mean:5.1f}  "
          f"合成后 mean={out.mean():6.2f} std={out.std():5.2f}  高光截断 {clipped:.2%}")

print("\n=== 输出（灰度 multiply 贴图）===")
emit(paper, 254, 249.0, "paper-grain.png")
emit(wall, 253, 243.0, "wall-grain.png")

# ---------------- 颜色 ----------------
print("\n=== 颜色令牌 ===")
def med(mask):
    return np.median(rgb[mask], axis=0)

pm = paper_mask & (gray > 240) & (gray < 252)
wm = wall_mask & (gray > 225) & (gray < 250)
pc, wc = med(pm), med(wm)
print("纸面 RGB:", pc.round(1), "#%02x%02x%02x" % tuple(pc.round().astype(int)))
print("墙面 RGB:", wc.round(1), "#%02x%02x%02x" % tuple(wc.round().astype(int)))

print("\n=== 墙面大尺度打光 ===")
prof_x = gray[H - 16:H - 3, :].mean(axis=0)
print("底边横向:", [round(float(prof_x[i]), 1) for i in range(0, W, 209)])
prof_y = gray[:, 5:22].mean(axis=1)
print("左边纵向:", [round(float(prof_y[i]), 1) for i in range(0, H, 117)])
prof_y2 = gray[:, W - 30:W - 8].mean(axis=1)
print("右边纵向:", [round(float(prof_y2[i]), 1) for i in range(0, H, 117)])
