#!/usr/bin/env node
/**
 * 与设计稿并排比对。
 *
 * 把参考图和当前截图缩放到同宽后上下拼接，可选只裁某个区域放大细看。
 * 需要 Python 与 Pillow。
 *
 * 用法：
 *   node scripts/compare.mjs --ref design.png --shot scratch/shot.png
 *   node scripts/compare.mjs --ref design.png --shot a.png --crop 0,0,700,420
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {
    shot: "scratch/shot.png",
    ref: null,
    out: "scratch/compare.png",
    crop: null,
    scale: 1,
    // 页面比设计稿多一个页头，裁剪同一块内容时要把这段高度补回去
    shotY: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shot") args.shot = argv[++i];
    else if (argv[i] === "--ref") args.ref = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--crop") args.crop = argv[++i];
    else if (argv[i] === "--scale") args.scale = Number(argv[++i]);
    else if (argv[i] === "--shot-y") args.shotY = Number(argv[++i]);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.ref) {
  console.error("用法：node scripts/compare.mjs --ref <设计稿.png> [--shot <截图.png>]");
  process.exit(1);
}
const out = resolve(args.out);
mkdirSync(dirname(out), { recursive: true });

const script = `
import sys
from PIL import Image, ImageDraw

shot_path, ref_path, out_path, crop, scale, shot_y = sys.argv[1:7]
scale = float(scale)
shot_y = int(shot_y)

shot = Image.open(shot_path).convert("RGB")
ref = Image.open(ref_path).convert("RGB")

# 统一到参考图的宽度，两张图的同一处内容才落在同一列上
width = ref.width
if shot.width != width:
    shot = shot.resize((width, round(shot.height * width / shot.width)), Image.LANCZOS)

if crop != "none":
    x, y, w, h = (int(v) for v in crop.split(","))
    right = min(x + w, width)
    ref = ref.crop((x, y, right, min(y + h, ref.height)))
    sy = y + shot_y
    shot = shot.crop((x, sy, right, min(sy + h, shot.height)))

if scale != 1:
    ref = ref.resize((round(ref.width * scale), round(ref.height * scale)), Image.LANCZOS)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)

label = 30
gap = 14
canvas = Image.new(
    "RGB",
    (max(ref.width, shot.width), ref.height + shot.height + label * 2 + gap),
    (24, 24, 26),
)
draw = ImageDraw.Draw(canvas)

draw.text((10, 9), "REFERENCE  " + ref_path, fill=(235, 235, 235))
canvas.paste(ref, (0, label))

y = label + ref.height + gap
draw.text((10, y - 21), "CURRENT  " + shot_path, fill=(120, 220, 150))
canvas.paste(shot, (0, y + label - label))

canvas.save(out_path)
print(f"{out_path}  {canvas.width}x{canvas.height}")
`;

const tmp = resolve("node_modules/.tmp/compare.py");
mkdirSync(dirname(tmp), { recursive: true });
writeFileSync(tmp, script, "utf-8");

execFileSync(
  "python3",
  [
    tmp,
    resolve(args.shot),
    resolve(args.ref),
    out,
    args.crop ?? "none",
    String(args.scale),
    String(args.shotY),
  ],
  { stdio: "inherit" },
);
