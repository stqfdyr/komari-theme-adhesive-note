#!/usr/bin/env node
/**
 * 国旗资源准备脚本。
 *
 * Komari 的 `region` 字段返回的是 regional indicator 字符（如 `🇺🇸`），
 * 直接渲染要依赖系统的彩色 emoji 字体——Linux 服务器和部分安卓设备上缺这套字体，
 * 会显示成两个方框字母。这里改用自托管的 SVG。
 *
 * 有意打包**全部 258 面国旗**而不是只打包某个站点用到的几面：
 * 这是一个会被别人安装的开源主题，安装者的节点可能在任何国家。
 * 浏览器按 `<img src>` 只请求页面上真正出现的那几面（每面 2-6 KB），
 * 打包体积换来的是"对谁都能用"。
 *
 * 图形来源：Twemoji（https://github.com/jdecked/twemoji）
 *   代码 MIT，图形 CC-BY-4.0，见 THIRD_PARTY.md
 *
 * 用法：
 *   node scripts/prepare-flags.mjs                 # 自动下载 @twemoji/svg
 *   node scripts/prepare-flags.mjs <svg 目录>       # 用本地已解压的目录
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "assets", "paper", "flags");

const TWEMOJI_PACKAGE = "@twemoji/svg@15.0.0";
/** regional indicator 码点起点：U+1F1E6 对应字母 A */
const REGIONAL_BASE = 0x1f1e6;

/** `1f1fa-1f1f8` → `us`；不是国旗组合时返回 null */
function codepointsToISO(basename) {
  const parts = basename.split("-");
  if (parts.length !== 2) return null;

  let iso = "";
  for (const part of parts) {
    const code = Number.parseInt(part, 16);
    if (!Number.isInteger(code)) return null;
    const offset = code - REGIONAL_BASE;
    if (offset < 0 || offset > 25) return null;
    iso += String.fromCharCode(97 + offset);
  }
  return iso;
}

/** 轻量压缩：去掉 XML 声明、注释与标签间空白，不改动任何图形数据 */
/**
 * 把画布裁到旗面本身。
 *
 * Twemoji 的旗帜画在 36×36 的方形画布里，旗面只占中间的 y 5..31，上下各留 5 个
 * 单位的透明边。留着这圈透明边有两个麻烦：一是布局上旗子的盒子比看得见的旗面
 * 高一截，得靠负外边距去凑；二是主题给旗面加的飘动位移滤镜会在透明边里空转，
 * 做不出旗子上下缘起伏的效果。裁掉之后，位移直接作用在旗面的上下边缘上。
 *
 * 瑞士、梵蒂冈（正方形）与尼泊尔（燕尾旗）的旗面纵向范围与矩形旗一致，
 * 横向的空白由 preserveAspectRatio 的默认 meet 居中处理，不受影响。
 */
function cropViewBox(svg) {
  return svg.replace('viewBox="0 0 36 36"', 'viewBox="0 5 36 26"');
}

function minifySvg(source) {
  return source
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/>\s+</g, "><")
    .trim();
}

function resolveSourceDir() {
  const provided = process.argv[2];
  if (provided) {
    const dir = resolve(provided);
    if (!existsSync(dir)) {
      console.error(`目录不存在：${dir}`);
      process.exit(1);
    }
    return { dir, cleanup: null };
  }

  console.log(`下载 ${TWEMOJI_PACKAGE} …`);
  const scratch = mkdtempSync(join(tmpdir(), "komari-flags-"));
  execFileSync("npm", ["pack", TWEMOJI_PACKAGE], {
    cwd: scratch,
    stdio: ["ignore", "pipe", "inherit"],
  });

  const tarball = readdirSync(scratch).find((name) => name.endsWith(".tgz"));
  if (!tarball) {
    console.error("下载失败：未找到 tgz");
    process.exit(1);
  }
  execFileSync("tar", ["xzf", tarball], { cwd: scratch });

  return { dir: join(scratch, "package"), cleanup: scratch };
}

function main() {
  const { dir, cleanup } = resolveSourceDir();
  mkdirSync(outDir, { recursive: true });

  let count = 0;
  let bytes = 0;

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".svg")) continue;
    const iso = codepointsToISO(name.slice(0, -4));
    if (!iso) continue;

    const content = cropViewBox(minifySvg(readFileSync(join(dir, name), "utf-8")));
    writeFileSync(join(outDir, `${iso}.svg`), content, "utf-8");
    count++;
    bytes += Buffer.byteLength(content);
  }

  if (cleanup) rmSync(cleanup, { recursive: true, force: true });

  console.log(
    `写入 ${count} 面国旗到 public/assets/paper/flags/（${(bytes / 1024).toFixed(0)} KB）`,
  );
}

main();
