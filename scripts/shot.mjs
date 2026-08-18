#!/usr/bin/env node
/**
 * 视觉验证脚本。
 *
 * 用无头 Chromium 打开开发服务器，等字体与纹理都加载完成后截图，
 * 用来和设计稿逐轮并排比对。默认输出尺寸与设计稿一致（1680×941）。
 *
 * 用法：
 *   node scripts/shot.mjs                          # 截首页
 *   node scripts/shot.mjs --path /instance/<uuid>  # 截指定路由
 *   node scripts/shot.mjs --click '#km-latency-tab' # 截交互后的状态
 *   node scripts/shot.mjs --range 250,750          # 设置双手柄选区
 *   node scripts/shot.mjs --out shot.png --width 1680 --height 941
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * playwright 有意不列进 package.json：它会拖下来几百 MB 的浏览器二进制，
 * 而绝大多数贡献者只是改代码，不需要跑视觉比对。
 * 这里依次尝试本地依赖与全局安装，都没有时给出可操作的提示。
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // 继续尝试全局
  }
  try {
    const globalRoot = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
    }).trim();
    return await import(pathToFileURL(join(globalRoot, "playwright", "index.mjs")).href);
  } catch {
    console.error(
      "找不到 playwright。安装其一即可：\n" +
        "  npm i -D playwright && npx playwright install chromium\n" +
        "  npm i -g playwright && playwright install chromium",
    );
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {
    url: process.env.SHOT_URL ?? "http://127.0.0.1:5273",
    path: "/",
    out: "scratch/shot.png",
    width: 1680,
    height: 941,
    full: false,
    clicks: [],
    range: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--full") args.full = true;
    else if (key === "--path") args.path = argv[++i];
    else if (key === "--click") args.clicks.push(argv[++i]);
    else if (key === "--range") {
      const values = argv[++i]?.split(",").map(Number);
      if (values?.length === 2 && values.every(Number.isFinite)) args.range = values;
    }
    else if (key === "--out") args.out = argv[++i];
    else if (key === "--url") args.url = argv[++i];
    else if (key === "--width") args.width = Number(argv[++i]);
    else if (key === "--height") args.height = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: args.width, height: args.height },
    // 用 2 倍像素密度截图，纸张纹理与手绘描边的细节才看得出来
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  const page = await context.newPage();

  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(`${args.url}${args.path}`, { waitUntil: "networkidle" });

  // 等第一张卡片出现，再等字体全部就绪，否则会截到 fallback 字体
  await page
    .waitForSelector(".km-node-card, .km-notice", { timeout: 15_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  for (const selector of args.clicks) {
    await page.click(selector);
    await page.waitForLoadState("networkidle");
  }
  if (args.range) {
    const track = await page.locator(".km-time-brush-track").boundingBox();
    if (track) {
      const y = track.y + track.height / 2;
      const points = args.range.map(
        (value) => track.x + (Math.max(0, Math.min(1_000, value)) / 1_000) * track.width,
      );
      await page.mouse.move(track.x, y);
      await page.mouse.down();
      await page.mouse.move(points[0], y, { steps: 8 });
      await page.mouse.up();
      await page.mouse.move(track.x + track.width, y);
      await page.mouse.down();
      await page.mouse.move(points[1], y, { steps: 8 });
      await page.mouse.up();
    }
  }
  // 让进度条的过渡动画走完
  await page.waitForTimeout(900);

  await page.screenshot({ path: out, fullPage: args.full });

  console.log(`截图已保存：${out}`);
  if (errors.length > 0) {
    console.log(`\n页面报错 ${errors.length} 条：`);
    for (const error of errors.slice(0, 10)) console.log(`  - ${error}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
