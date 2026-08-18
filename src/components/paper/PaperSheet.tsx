import { memo } from "react";
import type { PaperSheet as SheetName } from "@/lib/seed";

import aLeftPoint1x from "@/assets/sheets/paper-a-left-point@1x.webp";
import aLeftPoint2x from "@/assets/sheets/paper-a-left-point@2x.webp";
import bLeftBand1x from "@/assets/sheets/paper-b-left-band@1x.webp";
import bLeftBand2x from "@/assets/sheets/paper-b-left-band@2x.webp";
import cMidPoint1x from "@/assets/sheets/paper-c-mid-point@1x.webp";
import cMidPoint2x from "@/assets/sheets/paper-c-mid-point@2x.webp";
import dMidBand1x from "@/assets/sheets/paper-d-mid-band@1x.webp";
import dMidBand2x from "@/assets/sheets/paper-d-mid-band@2x.webp";

/**
 * 素材走 import 而不是 public/ 下的固定路径：Vite 会给文件名加内容 hash，
 * 换一版素材 URL 就变一次，CDN 不会继续供旧文件。产物仍落在 `/assets/` 下
 * （见 vite.config.ts 的 assetFileNames），严格白名单型的反代通常只放行该目录。
 */
const SHEETS: Record<SheetName, readonly [string, string]> = {
  "a-left-point": [aLeftPoint1x, aLeftPoint2x],
  "b-left-band": [bLeftBand1x, bLeftBand2x],
  "c-mid-point": [cMidPoint1x, cMidPoint2x],
  "d-mid-band": [dMidBand1x, dMidBand2x],
};

/**
 * 卡片的纸：一张 Blender 渲染的素材。
 *
 * 正交相机、无透视，画布 176×165.8 mm，纸 140×129.8 mm 居中。轮廓、撕边咬口、
 * 四角磨损、折痕、翘起与投影全部烘在素材里——纸面是漫反射的，程序化路线下
 * 翘角、纸边、褶皱只能返回同一灰度，深度线索被系统性抹掉。
 *
 * 投影编码在 alpha 通道里（黑色 + alpha），换任何墙色都不会泛白雾；四条边的
 * 翘起高度不同，投影的宽窄深浅随之变化，这是「贴在墙上」最关键的线索。
 *
 * 倾斜角有意不烘进素材：素材一律正视，逐卡旋转交给 CSS 的 `--rotation`，
 * 四张素材才能自由复用，角度也能随时调而不必重渲。
 *
 * 两档由 DPR 选择而不用 sizes：素材的显示宽度约等于 @1x 的像素宽度。不能让
 * 浏览器缩 @2x 顶替 @1x——缩放会滤掉纸面赖以成立的微观纤维细节。
 */
export const PaperSheet = memo(function PaperSheet({
  sheet,
}: {
  sheet: SheetName;
}) {
  const [x1, x2] = SHEETS[sheet];
  return (
    <img
      className="km-paper-sheet"
      src={x1}
      srcSet={`${x1} 1x, ${x2} 2x`}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  );
});
