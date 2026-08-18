import { memo, useId, useMemo } from "react";

const VIEW_W = 1000;
const VIEW_H = 900;

interface Point {
  x: number;
  y: number;
}

interface PaperShape {
  outline: string;
  fibers: string[];
}

function randomSource(seed: number): () => number {
  let state = (seed || 1) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function toPath(points: Point[]): string {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    )
    .join(" ") + " Z";
}

/**
 * 生成一张真正独有的纸张轮廓。
 *
 * 长波起伏负责“纸不是机器裁出的矩形”，短波抖动负责撕口和毛边；二者分开，
 * 才不会得到邮票齿孔一样等频、等幅的锯齿。结果只由节点 seed 决定，因此刷新时
 * 不会跳动，也不需要浏览器每帧重算 feTurbulence。
 */
function makeShape(seed: number): PaperShape {
  const random = randomSource(seed);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;

  const jitter = (position: number, edge: number) => {
    const longWave =
      Math.sin(position * Math.PI * 2 + phaseA + edge * 0.91) * 1.65 +
      Math.sin(position * Math.PI * 5 + phaseB - edge * 0.67) * 0.78;
    const torn = (random() - 0.5) * 3.6;
    // 偶尔留一个更深的小缺口；频率低，避免整条边像锯齿。
    const notch = random() < 0.065 ? 2.4 + random() * 3.6 : 0;
    return longWave + torn + notch;
  };

  const points: Point[] = [];
  const horizontalSteps = 34;
  const verticalSteps = 30;

  for (let i = 0; i <= horizontalSteps; i++) {
    const t = i / horizontalSteps;
    points.push({ x: 5 + t * 990, y: 5 + jitter(t, 0) });
  }
  for (let i = 1; i <= verticalSteps; i++) {
    const t = i / verticalSteps;
    points.push({ x: 995 - jitter(t, 1), y: 5 + t * 890 });
  }
  for (let i = 1; i <= horizontalSteps; i++) {
    const t = i / horizontalSteps;
    points.push({ x: 995 - t * 990, y: 895 - jitter(t, 2) });
  }
  for (let i = 1; i < verticalSteps; i++) {
    const t = i / verticalSteps;
    points.push({ x: 5 + jitter(t, 3), y: 895 - t * 890 });
  }

  // 少量越出轮廓的纤维丝。它们很短且半透明，只在 2x 截图或近看时出现。
  const fibers: string[] = [];
  for (let i = 0; i < 18; i++) {
    const edge = i % 4;
    const t = 0.06 + random() * 0.88;
    const length = 2.5 + random() * 6;
    if (edge === 0) {
      const x = t * VIEW_W;
      fibers.push(
        `M${x.toFixed(1)} 6 L${(x + (random() - 0.5) * 3).toFixed(1)} ${(6 - length).toFixed(1)}`,
      );
    } else if (edge === 1) {
      const y = t * VIEW_H;
      fibers.push(
        `M994 ${y.toFixed(1)} L${(994 + length).toFixed(1)} ${(y + (random() - 0.5) * 3).toFixed(1)}`,
      );
    } else if (edge === 2) {
      const x = t * VIEW_W;
      fibers.push(
        `M${x.toFixed(1)} 894 L${(x + (random() - 0.5) * 3).toFixed(1)} ${(894 + length).toFixed(1)}`,
      );
    } else {
      const y = t * VIEW_H;
      fibers.push(
        `M6 ${y.toFixed(1)} L${(6 - length).toFixed(1)} ${(y + (random() - 0.5) * 3).toFixed(1)}`,
      );
    }
  }

  return { outline: toPath(points), fibers };
}

export const PaperSurface = memo(function PaperSurface({
  seed,
}: {
  seed: number;
}) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");
  const shape = useMemo(() => makeShape(seed), [seed]);

  return (
    <svg
      className="km-paper-surface"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern
          id={`${id}-grain`}
          width="1024"
          height="1024"
          patternUnits="userSpaceOnUse"
        >
          <image
            href="/assets/paper/textures/paper-grain.webp"
            width="1024"
            height="1024"
            preserveAspectRatio="none"
          />
        </pattern>
        <radialGradient id={`${id}-light`} cx="20%" cy="0%" r="105%">
          {/* 同色只衰减 alpha；transparent 会按透明黑插值，把整张纸意外压灰。 */}
          <stop
            offset="0"
            stopColor="var(--paper-light-color)"
            stopOpacity="var(--paper-light-opacity)"
          />
          <stop
            offset="64%"
            stopColor="var(--paper-light-color)"
            stopOpacity="0"
          />
        </radialGradient>
      </defs>

      {/* 阴影、纸厚、纸面各自独立：不能再把所有物理信息压进一个平面层。 */}
      <path className="km-paper-shadow-caster" d={shape.outline} />
      <path className="km-paper-thickness" d={shape.outline} />
      <path className="km-paper-face" d={shape.outline} />
      <path
        className="km-paper-grain"
        d={shape.outline}
        fill={`url(#${id}-grain)`}
      />
      <path
        className="km-paper-light"
        d={shape.outline}
        fill={`url(#${id}-light)`}
      />
      <path className="km-paper-rim" d={shape.outline} />

      {shape.fibers.map((fiber, index) => (
        <path key={index} className="km-paper-fiber" d={fiber} />
      ))}
    </svg>
  );
});
