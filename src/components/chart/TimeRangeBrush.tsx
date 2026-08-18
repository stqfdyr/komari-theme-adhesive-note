import type { CSSProperties } from "react";

const RANGE_MAX = 1_000;
const MIN_GAP = 10;

export type TimeRangeSelection = [number, number];

interface Props {
  value: TimeRangeSelection;
  onChange: (value: TimeRangeSelection) => void;
  label: string;
  startLabel: string;
  endLabel: string;
  startText: string;
  endText: string;
  summary: string;
  hint: string;
}

/**
 * 双手柄时间选区。
 *
 * 两个原生 range 叠在同一条铅笔轨道上：既保留鼠标拖拽，也天然支持键盘方向键与
 * 屏幕阅读器。组件只输出 0..1000 的归一化位置，时间换算留给数据页完成。
 */
export function TimeRangeBrush({
  value,
  onChange,
  label,
  startLabel,
  endLabel,
  startText,
  endText,
  summary,
  hint,
}: Props) {
  const [start, end] = value;
  const style = {
    "--range-start": `${(start / RANGE_MAX) * 100}%`,
    "--range-end": `${(end / RANGE_MAX) * 100}%`,
  } as CSSProperties;

  return (
    <section className="km-time-brush" style={style} aria-label={label}>
      <div className="km-time-brush-track" aria-hidden="true" />
      <input
        className="km-time-brush-input"
        data-handle="start"
        type="range"
        min="0"
        max={RANGE_MAX}
        step="1"
        value={start}
        aria-label={startLabel}
        aria-valuetext={startText}
        onChange={(event) =>
          onChange([
            Math.min(Number(event.currentTarget.value), end - MIN_GAP),
            end,
          ])
        }
      />
      <input
        className="km-time-brush-input"
        data-handle="end"
        type="range"
        min="0"
        max={RANGE_MAX}
        step="1"
        value={end}
        aria-label={endLabel}
        aria-valuetext={endText}
        onChange={(event) =>
          onChange([
            start,
            Math.max(Number(event.currentTarget.value), start + MIN_GAP),
          ])
        }
      />
      <div className="km-time-brush-labels km-num">
        <span>{summary}</span>
        <small>{hint}</small>
      </div>
    </section>
  );
}
