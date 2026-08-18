/**
 * 地区标识 → 国旗资源。
 *
 * Komari 的 `region` 字段存的是 regional indicator 组合字符（如 `🇺🇸`）。
 * 直接把它渲染成文本要依赖系统的彩色 emoji 字体，而 Linux 服务器与部分安卓设备
 * 并不带这套字体，会退化成两个方框字母。这里统一换算成 ISO 3166-1 alpha-2 码，
 * 再指向自托管的 SVG。
 */

/** U+1F1E6 REGIONAL INDICATOR SYMBOL LETTER A */
const REGIONAL_BASE = 0x1f1e6;
const REGIONAL_LAST = 0x1f1ff;

/**
 * 解析出小写 ISO 码；解析不出时返回 null，由调用方回退渲染原始字符。
 *
 * 同时接受三种写法，因为管理员可能手工填过：
 *   `🇺🇸`（regional indicator）、`US`、`us`
 */
export function regionToISO(region: string | null | undefined): string | null {
  if (!region) return null;
  const trimmed = region.trim();
  if (!trimmed) return null;

  const codePoints = [...trimmed].map((char) => char.codePointAt(0) ?? 0);

  // regional indicator 组合
  if (
    codePoints.length === 2 &&
    codePoints.every((cp) => cp >= REGIONAL_BASE && cp <= REGIONAL_LAST)
  ) {
    return codePoints
      .map((cp) => String.fromCharCode(97 + (cp - REGIONAL_BASE)))
      .join("");
  }

  // 纯字母写法
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toLowerCase();

  return null;
}

/** 国旗 SVG 的公开路径 */
export function flagSrc(iso: string): string {
  return `/assets/paper/flags/${iso}.svg`;
}

/** 用于 alt / aria-label 的地区名，浏览器不支持 DisplayNames 时回退大写码 */
export function regionLabel(iso: string, language: string): string {
  try {
    const names = new Intl.DisplayNames([language], { type: "region" });
    return names.of(iso.toUpperCase()) ?? iso.toUpperCase();
  } catch {
    return iso.toUpperCase();
  }
}
