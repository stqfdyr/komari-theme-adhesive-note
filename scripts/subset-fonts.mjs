#!/usr/bin/env node
/**
 * 字体准备脚本。
 *
 * 做两件事：
 *   1. 把 @fontsource 的 Architects Daughter **拉丁子集** 拷到 public/assets/fonts/
 *      （只取 latin，latin-ext 里的东欧变音符号本主题用不到）
 *   2. 把霞鹜文楷子集化成单个 woff2
 *
 * 产物有意提交入库，这样 `npm ci && npm run build` 在任何环境都能跑，
 * 不依赖 Python 与 fontTools。只有需要更新字体时才重跑本脚本。
 *
 * 用法：
 *   node scripts/subset-fonts.mjs                    # 只同步拉丁字体
 *   node scripts/subset-fonts.mjs --cjk <字体.ttf>   # 另外子集化中文
 *
 * 中文字体来源（OFL-1.1）：
 *   https://github.com/lxgw/LxgwWenKai/releases → LXGWWenKai-Regular.ttf
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontsDir = join(root, "public", "assets", "fonts");

/**
 * 从 @fontsource 拷贝的拉丁字体。
 *
 * 全站只用 Architects Daughter 一款手写体：字形直立、单层 a、开口的 D、宽字距，
 * 是开源手写体里最贴近设计稿的一款。标题与正文都由它承担。
 */
const LATIN_FONTS = [
  "@fontsource/architects-daughter/files/architects-daughter-latin-400-normal.woff2",
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function syncLatinFonts() {
  mkdirSync(fontsDir, { recursive: true });
  for (const relative of LATIN_FONTS) {
    const source = join(root, "node_modules", relative);
    if (!existsSync(source)) {
      console.warn(`  跳过（未安装）：${relative}`);
      continue;
    }
    const name = relative.split("/").pop();
    const target = join(fontsDir, name);
    copyFileSync(source, target);
    console.log(`  ${name}  ${kb(statSync(target).size)}`);
  }
}

/**
 * 构造中文子集的字符集。
 *
 * 主题界面本身只有英文，这套字体是给管理员填的内容用的——站点名、节点名、
 * 自定义页脚都可能是中文，而它们无法预先枚举，所以按常用字覆盖：
 *   - GB2312 全部汉字（6763 字）：日常中文的绝对主体
 *   - 中英文标点、拉丁字母与数字：中文排版里混排的部分
 */
function buildCharsetScript() {
  return `
import unicodedata

chars = set()

# GB2312 区位码遍历：0xB0-0xF7 区、0xA1-0xFE 位，即 6763 个常用汉字
for high in range(0xB0, 0xF8):
    for low in range(0xA1, 0xFF):
        try:
            chars.add(bytes([high, low]).decode("gb2312"))
        except UnicodeDecodeError:
            pass

# 中英文标点、拉丁字母、数字
chars.update(
    "，。、；：？！“”‘’（）【】《》…—～·「」『』〈〉"
    "0123456789"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    " .,:;!?'\\"()[]{}<>/\\\\|-_=+*&^%$#@~\`"
)

# 过滤掉代理对与控制字符
usable = sorted(c for c in chars if c.isprintable() and not unicodedata.category(c).startswith("C"))
sys.stdout.write("".join(usable))
`;
}

function subsetCJK(sourceFont) {
  if (!existsSync(sourceFont)) {
    console.error(`找不到字体文件：${sourceFont}`);
    process.exit(1);
  }

  const scratch = join(root, "node_modules", ".tmp");
  mkdirSync(scratch, { recursive: true });

  const charsetScript = join(scratch, "build-charset.py");
  const charsetFile = join(scratch, "charset.txt");
  writeFileSync(charsetScript, buildCharsetScript(), "utf-8");

  const charset = execFileSync("python3", [charsetScript], {
    encoding: "utf-8",
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(charsetFile, charset, "utf-8");
  console.log(`  字符集：${[...charset].length} 个字符`);

  const target = join(fontsDir, "lxgw-wenkai-subset.woff2");
  execFileSync(
    "python3",
    [
      "-m",
      "fontTools.subset",
      sourceFont,
      `--text-file=${charsetFile}`,
      `--output-file=${target}`,
      "--flavor=woff2",
      "--layout-features=*",
      "--no-hinting",
      "--desubroutinize",
      "--drop-tables+=DSIG",
      "--name-IDs=*",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  console.log(`  lxgw-wenkai-subset.woff2  ${kb(statSync(target).size)}`);
}

function main() {
  const args = process.argv.slice(2);
  const cjkIndex = args.indexOf("--cjk");

  console.log("同步拉丁字体：");
  syncLatinFonts();

  if (cjkIndex !== -1) {
    const source = args[cjkIndex + 1];
    if (!source) {
      console.error("--cjk 需要指定字体文件路径");
      process.exit(1);
    }
    console.log("\n子集化中文字体：");
    subsetCJK(resolve(source));
  } else {
    console.log("\n未指定 --cjk，跳过中文子集化。");
    console.log("如需更新中文字体：node scripts/subset-fonts.mjs --cjk /path/to/LXGWWenKai-Regular.ttf");
  }
}

main();
