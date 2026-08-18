import spriteMarkup from "@/assets/doodle-sprite.svg?raw";

/** sprite 中可用的图标名 */
export type DoodleName =
  | "cpu"
  | "memory"
  | "disk"
  | "load"
  | "globe"
  | "clock"
  | "upload"
  | "download"
  | "status"
  | "calendar"
  | "uptime"
  | "server"
  | "network";

/**
 * 把手绘图标 sprite 内联进文档，全应用挂载一次。
 *
 * 内联而不是外链一个 sprite 文件：`currentColor` 的继承才可靠，也省掉一次
 * 额外请求。文件仅数 KB。
 */
export function DoodleSprite() {
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: spriteMarkup }}
    />
  );
}

interface Props {
  name: DoodleName;
  className?: string;
}

/** 装饰性图标：语义由相邻文字承担，这里对屏幕阅读器隐藏 */
export function DoodleIcon({ name, className = "km-doodle" }: Props) {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#icon-${name}`} />
    </svg>
  );
}
