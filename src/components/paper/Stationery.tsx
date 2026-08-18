import { memo } from "react";
import type { StationeryDef } from "@/lib/seed";

/**
 * 卡片上的固定物：图钉 / 回形针 / 胶带 / 长尾夹。
 *
 * 素材自带高光与投影，把纸「钉在墙上」靠的就是这份实物质感。
 * 显式给出宽高比：图片异步解码，没有内在尺寸时浏览器会先按 0 高度布局、
 * 解码完再撑开，整面卡片墙会抖一下。
 */
export const Stationery = memo(function Stationery({
  def,
  offset,
}: {
  def: StationeryDef;
  /** 水平位置抖动（px），让重复出现的同类文具不至于整齐划一 */
  offset: number;
}) {
  return (
    <img
      className={`km-stationery km-stationery--${def.kind}`}
      src={`/assets/paper/stationery/${def.file}.png`}
      style={
        {
          "--stationery-offset": `${offset}px`,
          aspectRatio: def.ratio,
        } as React.CSSProperties
      }
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  );
});
