import { useEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { LOCALE } from "@/i18n";

/**
 * 手绘风格的时序图表。
 *
 * 选 uPlot 而不是 recharts：Canvas 渲染，几千个点也不掉帧，且暴露 draw hook，
 * 可以直接接管描线过程画出手绘抖动。
 *
 * 抖动按数据点索引确定性生成，不是每帧随机——否则曲线会像在发抖。
 */

export interface ChartSeries {
  label: string;
  /** 与 timestamps 等长；null 表示该点缺数据 */
  values: (number | null)[];
  color: string;
}

interface Props {
  /** Unix 秒 */
  timestamps: number[];
  series: ChartSeries[];
  height?: number;
  /** y 轴数值格式化 */
  formatValue?: (value: number) => string;
  /** 固定 y 轴范围，如百分比图传 [0, 100] */
  range?: [number, number];
  /** 按实际绘图宽度抽稀；每个时间桶保留各序列峰、谷与断点 */
  adaptiveDensity?: boolean;
}

/** 确定性伪随机：同一索引永远得到同一偏移 */
function jitter(index: number, seed: number): number {
  const value = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

/**
 * 把 `var(--x)` 解析成真实色值。
 *
 * uPlot 画在 Canvas 上，而 Canvas 的 strokeStyle 不认 CSS 变量——直接把
 * "var(--c-cpu)" 传进去会被当成无效值，所有线条一律退化成黑色。
 * 这里在渲染前从根元素上把变量读出来。
 */
function resolveColor(value: string, fallback = "#666"): string {
  const match = value.match(/^var\((--[^,)]+)\)$/);
  if (!match) return value;
  if (typeof window === "undefined") return fallback;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(match[1])
    .trim();
  return resolved || fallback;
}

/**
 * 让长时间窗不把几千个采样硬挤进几百个像素。
 *
 * 不能简单每 N 点取一个：那会漏掉瞬时延迟尖峰，也会跨过失败采样把本该断开的线
 * 连起来。这里按宽度分桶，每个序列都保留桶内峰值、谷值和一个 null 断点；同一时间
 * 索引只存一次，最后仍是严格对齐的 uPlot 数据。
 */
function downsampleAligned(
  timestamps: number[],
  series: ChartSeries[],
  limit: number,
): { timestamps: number[]; series: ChartSeries[] } {
  const count = timestamps.length;
  if (count <= limit || count <= 2 || series.length === 0) {
    return { timestamps, series };
  }

  const perBucket = Math.max(1, series.length * 3);
  const bucketCount = Math.max(1, Math.floor((limit - 2) / perBucket));
  const indices = new Set<number>([0, count - 1]);

  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor((bucket * (count - 2)) / bucketCount);
    const end = Math.min(
      count - 1,
      1 + Math.floor(((bucket + 1) * (count - 2)) / bucketCount),
    );

    for (const item of series) {
      let minIndex = -1;
      let maxIndex = -1;
      let nullIndex = -1;

      for (let index = start; index < end; index++) {
        const value = item.values[index];
        if (value == null) {
          if (nullIndex === -1) nullIndex = index;
          continue;
        }
        if (minIndex === -1 || value < (item.values[minIndex] as number)) {
          minIndex = index;
        }
        if (maxIndex === -1 || value > (item.values[maxIndex] as number)) {
          maxIndex = index;
        }
      }

      if (minIndex !== -1) indices.add(minIndex);
      if (maxIndex !== -1) indices.add(maxIndex);
      if (nullIndex !== -1) indices.add(nullIndex);
    }
  }

  const ordered = [...indices].sort((a, b) => a - b);
  return {
    timestamps: ordered.map((index) => timestamps[index]),
    series: series.map((item) => ({
      ...item,
      values: ordered.map((index) => item.values[index]),
    })),
  };
}

export function RoughChart({
  timestamps,
  series,
  height = 220,
  formatValue,
  range,
  adaptiveDensity = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === "undefined" || !document.fonts,
  );
  // uPlot 需要显式像素宽度，跟随容器变化
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(Math.floor(next));
    };
    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth, { passive: true });
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(Math.floor(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Canvas 在字体下载完成前绘制会永久留下 fallback 字形；字体就绪后重建一次
  // options，确保坐标轴和页面其余文字使用同一套手写字体。
  useEffect(() => {
    if (!document.fonts) return;
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) setFontsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const sampled = useMemo(
    () =>
      adaptiveDensity
        ? downsampleAligned(
            timestamps,
            series,
            Math.max(120, Math.floor(width / 2)),
          )
        : { timestamps, series },
    [adaptiveDensity, series, timestamps, width],
  );

  const data = useMemo(
    () =>
      [
        sampled.timestamps,
        ...sampled.series.map((s) => s.values),
      ] as unknown as uPlot.AlignedData,
    [sampled],
  );

  const options = useMemo<uPlot.Options>(() => {
    const axisColor = resolveColor("var(--ink-muted)", "#4a4a45");
    const gridColor = resolveColor("var(--rule-color)", "rgba(0,0,0,.18)");
    const firstTime = sampled.timestamps[0] ?? 0;
    const lastTime = sampled.timestamps.at(-1) ?? firstTime;
    const duration = Math.max(0, lastTime - firstTime);
    const showSeconds = duration <= 10 * 60;
    const showDate = duration > 12 * 60 * 60;
    const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
      hour: "2-digit",
      minute: "2-digit",
      second: showSeconds ? "2-digit" : undefined,
      hourCycle: "h23",
    });
    const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
      month: "numeric",
      day: "numeric",
    });
    const axisFont =
      '17px "Architects Daughter", "LXGW WenKai Subset", ui-sans-serif, system-ui, sans-serif';

    return {
      width,
      height,
      // 图表是数据的可视化补充，键盘用户可通过下方的数值读到同样的信息
      cursor: { show: true, y: false },
      legend: { show: false },
      scales: {
        x: { time: true },
        y: range ? { range: () => range } : {},
      },
      axes: [
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 0.8, dash: [2, 8] },
          ticks: { stroke: gridColor, width: 1, size: 4 },
          font: axisFont,
          size: 46,
          gap: 10,
          // uPlot 的默认日期轴会把日期拆成第二行，多个小图并排时显得零碎。
          // 这里统一成稀疏单行：实时带秒，日内只显示时分，长窗口补月/日。
          space: duration > 12 * 60 * 60 ? 148 : showSeconds ? 116 : 104,
          values: (_self, splits) =>
            splits.map((value) => {
              const date = new Date(value * 1_000);
              const time = timeFormatter.format(date);
              return showDate ? `${dateFormatter.format(date)}  ${time}` : time;
            }),
        },
        {
          stroke: axisColor,
          grid: { stroke: gridColor, width: 1, dash: [3, 5] },
          ticks: { stroke: gridColor, width: 1 },
          font: axisFont,
          // 够宽才不会把「16Mbps」这类标签从左边裁掉半个字符
          size: 86,
          values: formatValue
            ? (_self, splits) => splits.map((v) => formatValue(v))
            : undefined,
        },
      ],
      series: [
        {},
        ...series.map((s, index) => ({
          label: s.label,
          stroke: resolveColor(s.color),
          width: 1.8,
          points: { show: false },
          /**
           * 接管描线：沿折线逐点加一点垂直抖动，画出手绘感。
           * 偏移量由点的索引决定，因此每次重绘的曲线完全一致。
           */
          paths: (
            self: uPlot,
            seriesIndex: number,
            idx0: number,
            idx1: number,
          ) => {
            const path = new Path2D();
            const xs = self.data[0];
            const ys = self.data[seriesIndex] as (number | null)[];
            let started = false;

            for (let i = idx0; i <= idx1; i++) {
              const y = ys[i];
              if (y == null) {
                started = false;
                continue;
              }
              const cx = self.valToPos(xs[i] as number, "x", true);
              const cy = self.valToPos(y, "y", true) + jitter(i, index + 1) * 1.1;

              if (!started) {
                path.moveTo(cx, cy);
                started = true;
              } else {
                path.lineTo(cx, cy);
              }
            }
            return { stroke: path };
          },
        })),
      ],
    };
    // fontsReady 不出现在上面的表达式里，但必须留在依赖里：它变化时要重建一份
    // 新的 options 对象，uPlot 才会用已下载好的手写体重画坐标轴。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    width,
    height,
    series,
    sampled.timestamps,
    range,
    formatValue,
    fontsReady,
  ]);

  return (
    <div ref={containerRef} className="km-load-chart">
      {width > 0 ? <UplotReact options={options} data={data} /> : null}
    </div>
  );
}
