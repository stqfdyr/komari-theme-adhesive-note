#!/usr/bin/env node
/**
 * 无障碍检查：文字对比度 + 常见可访问性约束。
 *
 * 卡片的背景是纹理贴图叠滤镜，算不出单一色值，因此这里不去推算，
 * 而是**真的截图取像素**：在每个待测元素的位置采样其背后的实际颜色，
 * 再按 WCAG 2.1 的相对亮度公式算对比度。
 *
 * 用法：
 *   node scripts/a11y-check.mjs
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
    }).trim();
    return import(
      pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href
    );
  }
}

/** WCAG 相对亮度 */
function luminance([r, g, b]) {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function parseColor(css) {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2]];
}

/** 待测元素：选择器 → 说明 */
const TARGETS = [
  [".km-card-title", "服务器名"],
  [".km-card-meta", "OS 元信息"],
  [".km-status", "在线状态"],
  [".km-metric-label", "指标标签"],
  [".km-metric--cpu .km-metric-value", "CPU 数值"],
  [".km-metric--mem .km-metric-value", "内存数值"],
  [".km-metric--disk .km-metric-value", "磁盘数值"],
  [".km-metric-meta", "指标明细"],
  [".km-side-label", "Load 标签"],
  [".km-side-value", "Load 数值"],
  [".km-net-row--up", "上行速率"],
  [".km-net-row--down", "下行速率"],
  [".km-bottom-label", "底栏标签"],
  [".km-bottom-value", "底栏数值"],
  [".km-expiry-label", "到期标签"],
  [".km-expiry-value", "到期天数"],
  [".km-navbar-title", "站点标题"],
  [".km-navbar-subtitle", "在线计数"],
  [".km-footer", "页脚"],
  [".km-ui-button", "按钮文字"],
];

async function main() {
  const url = process.env.SHOT_URL ?? "http://127.0.0.1:5273";

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1680, height: 941 },
    colorScheme: "light",
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".km-node-card");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);

  // 取每个目标的文字颜色与位置
  const probes = await page.evaluate((targets) => {
    return targets
      .map(([selector, label]) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) return null;
        const style = getComputedStyle(el);
        return {
          selector,
          label,
          color: style.color,
          fontSize: Number.parseFloat(style.fontSize),
          fontWeight: Number(style.fontWeight) || 400,
          // 采样点取元素左侧偏外一点的空白处，拿到的是它背后的底色
          x: Math.round(box.left - 6),
          y: Math.round(box.top + box.height / 2),
        };
      })
      .filter(Boolean);
  }, TARGETS);

  // 截图后按坐标取像素，得到文字背后真实的合成底色
  const shot = await page.screenshot({ type: "png" });
  await browser.close();

  const { execFileSync: exec } = await import("node:child_process");
  const pixels = JSON.parse(
    exec("python3", ["-c", PIXEL_SCRIPT, JSON.stringify(probes.map((p) => [p.x, p.y]))], {
      input: shot,
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    }).toString("utf-8"),
  );

  console.log("\n对比度检查（浅色）");
  console.log("-".repeat(74));

  let failures = 0;
  for (const [index, probe] of probes.entries()) {
    const fg = parseColor(probe.color);
    const bg = pixels[index];
    if (!fg || !bg) continue;

    const ratio = contrastRatio(fg, bg);
    // WCAG：18.66px+ 的粗体或 24px+ 的常规文字算「大字号」，门槛 3:1
    const large =
      probe.fontSize >= 24 || (probe.fontSize >= 18.66 && probe.fontWeight >= 700);
    const threshold = large ? 3 : 4.5;
    const pass = ratio >= threshold;
    if (!pass) failures++;

    console.log(
      `${pass ? "✓" : "✗"} ${probe.label.padEnd(12)} ` +
        `${ratio.toFixed(2).padStart(6)}:1  (需 ${threshold}:1, ${probe.fontSize}px${large ? " 大字号" : ""})`,
    );
  }

  console.log("-".repeat(74));
  console.log(failures === 0 ? "全部通过 WCAG AA" : `${failures} 项未达标`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/**
 * 取的是采样点周围 9×9 的**逐通道中位数**，不是单个像素。
 *
 * 单点采样会被穿过采样点的细线骗到：到期方框那圈手绘绿边随机抖动，
 * 正好从「Expires in」左侧划过时，量到的"底色"就成了绿色，
 * 一段 15:1 的文字会被报成 4:1 不达标。取中位数后，占面积多数的纸面胜出。
 */
const PIXEL_SCRIPT = `
import sys, json, io, statistics
from PIL import Image
coords = json.loads(sys.argv[1])
img = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGB")
R = 4
out = []
for x, y in coords:
    x = max(R, min(img.width - 1 - R, x))
    y = max(R, min(img.height - 1 - R, y))
    px = [img.getpixel((x + dx, y + dy))
          for dy in range(-R, R + 1) for dx in range(-R, R + 1)]
    out.append([int(statistics.median(c[i] for c in px)) for i in range(3)])
print(json.dumps(out))
`;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
