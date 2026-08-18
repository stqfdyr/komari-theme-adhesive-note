import { memo, useId, useMemo } from "react";

/**
 * 手绘笔触基元。
 *
 * 设计稿里几乎没有一条直线：进度条是蜡笔来回涂出的粗笔触，纵向分隔线末端带个
 * 小箭头，虚线的每一段长短不一。这些都不是 CSS 边框能表达的，全部用 SVG 画出来。
 *
 * 两条共同的实现约束：
 *
 * 1. `vector-effect="non-scaling-stroke"`。这些图形的宽高随内容变化，用
 *    `preserveAspectRatio="none"` 铺满容器时线宽会被一起拉伸——横线变粗、竖线
 *    变细。非缩放描边让线宽固定在 CSS 像素上，形状随容器走而笔触重量不变。
 *
 * 2. 几何只算一次。节点数 × 每 2 秒刷新，若每次都重新生成抖动路径，低端设备
 *    必然掉帧。所有随机形状按 seed 缓存，数值变化只改裁切宽度。
 */

/* ===================== 进度条 ===================== */

/**
 * 蜡笔进度条。
 *
 * 条体是来回涂了几遍的蜡笔痕迹：整体较粗、两端钝圆，上下边缘有轻微缺口，内部
 * 还露出几条纸纤维。用一块不规则的填充轮廓叠加确定性的刮痕路径实现，不使用
 * SVG filter，几十张卡同时刷新也不会产生滤镜栅格化开销。
 *
 * 数值只改变裁切宽度；末端另补一枚很窄的不规则圆头，避免矩形裁切露出竖直切口。
 */
const BAR_VIEW_W = 100;
const BAR_VIEW_H = 10;
const BAR_HALF = 3.34;
const BAR_CENTER_Y = BAR_VIEW_H / 2;

function crayonBarPath(seed: number): string {
  const topWobble = wobbler(seed);
  const bottomWobble = wobbler(seed + 3571);
  const steps = 16;

  // 首尾圆头的圆心都向内收一个半径，轮廓本身仍严丝合缝地铺满 0..100。
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = BAR_HALF + t * (BAR_VIEW_W - BAR_HALF * 2);
    // 上下边缘分别抖动，避免两条边像复制出来的平行线；这是蜡笔侧锋最明显的特征。
    const topY = BAR_CENTER_Y - BAR_HALF + topWobble(i) * 0.52;
    const bottomY = BAR_CENTER_Y + BAR_HALF + bottomWobble(i) * 0.52;
    top.push(`${x.toFixed(2)} ${topY.toFixed(2)}`);
    bottom.push(`${x.toFixed(2)} ${bottomY.toFixed(2)}`);
  }

  return (
    `M ${top[0]}` +
    top.slice(1).map((p) => ` L ${p}`).join("") +
    // 收笔端也保持钝圆，避免网页进度条常见的机械直角或毛笔尖。
    ` A ${BAR_HALF} ${BAR_HALF} 0 0 1 ${bottom[steps]}` +
    bottom.slice(0, steps).reverse().map((p) => ` L ${p}`).join("") +
    ` A ${BAR_HALF} ${BAR_HALF} 0 0 1 ${top[0]}` +
    " Z"
  );
}

/** 蜡层里露出来的细小纸纹；同一个 seed 永远生成同一组划痕。 */
function crayonScratchPaths(seed: number): readonly [string, string] {
  const wobble = wobbler(seed + 7919);
  const rows = [2.05, 3.02, 4.08, 5.15, 6.28, 7.35, 8.12];
  const fine: string[] = [];
  const coarse: string[] = [];

  rows.forEach((baseY, row) => {
    const points: string[] = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      // 每一笔从画布外不同位置开始；被轮廓裁掉后，虚线纹理不会机械地纵向对齐。
      const overshoot = 5 + (row % 3) * 2;
      const x = -overshoot + (i / steps) * (BAR_VIEW_W + overshoot * 2);
      const y = baseY + wobble(row * 13 + i) * 0.7;
      points.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    const path = `M ${points[0]}` + points.slice(1).map((point) => ` L ${point}`).join("");
    (row % 2 === 0 ? coarse : fine).push(path);
  });

  // 七道划痕合并成两个复合 path，避免 30 节点时额外制造上千个 SVG DOM 节点。
  return [fine.join(" "), coarse.join(" ")];
}

/** 由 seed 生成一串确定的小抖动，范围约 -1..1 */
function wobbler(seed: number): (i: number) => number {
  let state = (seed || 1) >>> 0;
  const cache: number[] = [];
  return (i: number) => {
    while (cache.length <= i) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      cache.push((state / 0xffffffff) * 2 - 1);
    }
    return cache[i];
  };
}

const barPathCache = new Map<number, string>();
const barScratchCache = new Map<number, readonly [string, string]>();

function barPath(seed: number): string {
  let path = barPathCache.get(seed);
  if (!path) {
    path = crayonBarPath(seed);
    barPathCache.set(seed, path);
  }
  return path;
}

function barScratches(seed: number): readonly [string, string] {
  let paths = barScratchCache.get(seed);
  if (!paths) {
    paths = crayonScratchPaths(seed);
    barScratchCache.set(seed, paths);
  }
  return paths;
}

interface BarProps {
  /** 0-100 */
  value: number;
  /** 稳定种子，同一条进度条每次渲染必须传同一个值 */
  seed: number;
  /** 填充色，通常是 CSS 变量 var(--accent) */
  color: string;
  className?: string;
}

function CrayonBarImpl({ value, seed, color, className }: BarProps) {
  const clipId = useId();
  const d = useMemo(() => barPath(seed), [seed]);
  const scratches = useMemo(() => barScratches(seed), [seed]);
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const fillX = (clamped / 100) * BAR_VIEW_W;
  const shapeClipId = `${clipId}-shape`;
  const valueClipId = `${clipId}-value`;

  return (
    <svg
      className={className ?? "km-bar"}
      viewBox={`0 0 ${BAR_VIEW_W} ${BAR_VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={shapeClipId}>
          <path d={d} />
        </clipPath>
        <clipPath id={valueClipId}>
          {/* 只有这个 width 会随数值变化，路径本身始终不变 */}
          <rect
            className="km-bar-clip"
            x="0"
            y="0"
            width={fillX}
            height={BAR_VIEW_H}
          />
        </clipPath>
      </defs>

      <path
        d={d}
        fill="var(--track-color)"
        stroke="var(--ink-faint)"
        strokeWidth="0.34"
        vectorEffect="non-scaling-stroke"
        opacity="0.88"
      />
      <g clipPath={`url(#${shapeClipId})`}>
        <g className="km-bar-scratches km-bar-scratches--track">
          <path className="km-bar-scratch km-bar-scratch--fine" d={scratches[0]} />
          <path className="km-bar-scratch km-bar-scratch--coarse" d={scratches[1]} />
        </g>

        {clamped > 0 && (
          <>
            <g clipPath={`url(#${valueClipId})`}>
              <rect
                x="0"
                y="0"
                width={BAR_VIEW_W}
                height={BAR_VIEW_H}
                fill={color}
                opacity="0.91"
              />
            </g>
            {/* 两枚错开的半透明收笔叠出不规则蜡块，避免裁切末端成为规整圆角。 */}
            <ellipse
              cx={fillX - 0.18}
              cy={BAR_CENTER_Y - 0.16}
              rx="1.58"
              ry="3.08"
              fill={color}
              opacity="0.82"
            />
            <ellipse
              cx={fillX + 0.22}
              cy={BAR_CENTER_Y + 0.28}
              rx="1.08"
              ry="2.72"
              fill={color}
              opacity="0.7"
            />
            <g
              className="km-bar-scratches km-bar-scratches--fill"
              clipPath={`url(#${valueClipId})`}
            >
              <path className="km-bar-scratch km-bar-scratch--fine" d={scratches[0]} />
              <path className="km-bar-scratch km-bar-scratch--coarse" d={scratches[1]} />
            </g>
          </>
        )}
      </g>
    </svg>
  );
}

export const CrayonBar = memo(CrayonBarImpl);

/* ===================== 分隔线 ===================== */

/**
 * 一条带轻微起伏的手绘横线。
 *
 * 画布是 100×4 而不是 100×100：这些线的实际尺寸大约是 420×6，配 100×100 的
 * viewBox 会得到 4.2 : 0.06 的各向异性缩放（约 70 : 1）。Chromium 在这种极端
 * 各向异性下渲染 `vector-effect="non-scaling-stroke"` 的折线会在每个顶点处断开，
 * 一条连续的线看上去变成一串虚线。把画布压成同样扁的比例，缩放接近各向同性，
 * 问题就不存在了。
 */
function wavyPath(seed: number, steps = 7, amp = 0.55): string {
  const w = wobbler(seed);
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    pts.push(`${x.toFixed(2)} ${(2 + w(i) * amp).toFixed(2)}`);
  }
  return `M ${pts[0]}` + pts.slice(1).map((p) => ` L ${p}`).join("");
}

const rulePathCache = new Map<number, string>();

/**
 * 底栏之上的那道横线。
 *
 * 两端用渐变遮罩收掉，模拟落笔与收笔时的轻按——设计稿里这条线的两头是虚的，
 * 一刀切的实线会显得像 `border-top`。
 */
export const HandRule = memo(function HandRule({ seed }: { seed: number }) {
  const maskId = useId();
  const d = useMemo(() => {
    let p = rulePathCache.get(seed);
    if (!p) {
      p = wavyPath(seed, 13, 0.46);
      rulePathCache.set(seed, p);
    }
    return p;
  }, [seed]);

  return (
    <svg
      className="km-rule"
      viewBox="0 0 100 4"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={maskId}>
          <stop offset="0" stopColor="#000" />
          <stop offset="0.035" stopColor="#fff" />
          <stop offset="0.965" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id={`${maskId}-m`}>
          <rect x="0" y="0" width="100" height="4" fill={`url(#${maskId})`} />
        </mask>
      </defs>
      <path
        d={d}
        fill="none"
        stroke="var(--rule-color)"
        strokeWidth="1.05"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        mask={`url(#${maskId}-m)`}
      />
      <path
        d={d}
        fill="none"
        stroke="var(--rule-color)"
        strokeWidth="0.58"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.32"
        transform="translate(0 .28)"
        mask={`url(#${maskId}-m)`}
      />
    </svg>
  );
});

/**
 * 指标区与右栏之间的竖线。
 *
 * 设计稿里这条线的下端带一个小箭头，像笔顺着划下来最后一挑。箭头必须画在
 * 独立的、不参与纵向拉伸的 SVG 里——和线身共用一个 `preserveAspectRatio="none"`
 * 的画布，箭头会被拉成一条细长的叉。
 */
export const HandDivider = memo(function HandDivider({ seed }: { seed: number }) {
  // 竖着画，画布也跟着瘦长——理由同 wavyPath 的注释
  const d = useMemo(() => {
    const w = wobbler(seed + 7);
    const steps = 6;
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      pts.push(`${(2 + w(i) * 0.42).toFixed(2)} ${((i / steps) * 100).toFixed(2)}`);
    }
    return `M ${pts[0]}` + pts.slice(1).map((p) => ` L ${p}`).join("");
  }, [seed]);

  return (
    <div className="km-divider" aria-hidden="true">
      <svg
        className="km-divider-line"
        viewBox="0 0 4 100"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          d={d}
          fill="none"
          stroke="var(--divider-color)"
          strokeWidth="1.05"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={d}
          fill="none"
          stroke="var(--divider-color)"
          strokeWidth="0.58"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.3"
          transform="translate(.32 0)"
        />
      </svg>
      <svg className="km-divider-tip" viewBox="0 0 12 10" focusable="false">
        <path
          d="M1.4 1.2 C 3.2 4.4, 4.8 6.8, 6 9 C 7.4 6.6, 9.2 4.2, 10.8 1.6"
          fill="none"
          stroke="var(--divider-color)"
          strokeWidth="1.05"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
});

/**
 * Load 与 Net Speed 之间的手绘虚线。
 *
 * 每一段长短都不同：等长的 `stroke-dasharray` 一眼就是 CSS 画的，
 * 而设计稿里那几段明显是手抖出来的。
 */
const DASHES = [0, 9.5, 13.5, 21, 25.5, 36.5, 40, 51.5, 56, 65.5, 70.5, 82, 86, 100];

export const HandDashes = memo(function HandDashes({ seed }: { seed: number }) {
  const segments = useMemo(() => {
    const w = wobbler(seed + 13);
    const out: string[] = [];
    for (let i = 0; i + 1 < DASHES.length; i += 2) {
      const y1 = 2 + w(i) * 0.5;
      const y2 = 2 + w(i + 1) * 0.5;
      out.push(`M ${DASHES[i]} ${y1.toFixed(2)} L ${DASHES[i + 1]} ${y2.toFixed(2)}`);
    }
    return out;
  }, [seed]);

  return (
    <svg
      className="km-dashes"
      viewBox="0 0 100 4"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {segments.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="none"
            stroke="var(--rule-color)"
            strokeWidth="1.05"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={d}
            fill="none"
            stroke="var(--rule-color)"
            strokeWidth="0.55"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.28"
            transform="translate(0 .25)"
          />
        </g>
      ))}
    </svg>
  );
});

/* ===================== 标题下划线 ===================== */

/**
 * 服务器名下面那道彩色铅笔痕。
 *
 * 与进度条同样是柳叶形，但两头都收尖——中间落笔最重，起收两端提笔。
 * 宽度跟着标题走，所以仍然是 `preserveAspectRatio="none"` 拉伸；
 * 这里是填充形状而非描边，拉伸时厚度的相对关系不变。
 */
export const HandUnderline = memo(function HandUnderline({
  seed,
  color,
}: {
  seed: number;
  color: string;
}) {
  const d = useMemo(() => {
    const w = wobbler(seed + 29);
    const steps = 10;
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * 100;
      // sin 包络：两端薄、中间厚；再叠一点抖动让它不像个纺锤形色块
      const half = (0.9 + 1.5 * Math.sin(Math.PI * Math.min(1, t * 1.06))) * 1.0;
      const drift = w(i) * 0.5;
      top.push(`${x.toFixed(2)} ${(5 - half + drift).toFixed(2)}`);
      bottom.push(`${x.toFixed(2)} ${(5 + half + drift).toFixed(2)}`);
    }
    return (
      `M ${top[0]}` +
      top.slice(1).map((p) => ` L ${p}`).join("") +
      bottom.reverse().map((p) => ` L ${p}`).join("") +
      " Z"
    );
  }, [seed]);

  return (
    <svg
      className="km-underline"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill={color} />
    </svg>
  );
});


/* ===================== 永不到期 ===================== */

const infinityPathCache = new Map<number, string>();

/**
 * 手写 ∞ 的轮廓。
 *
 * 沿 Gerono 双纽线取中线，再按法线方向张开成一条粗细起伏的填充带——与标题下划线
 * 同一种做法，因此笔触重量和整卡的手写体是同一套。起笔略早于交叉点、收笔略晚，
 * 两端在中心重叠一小段，中心的墨迹自然比别处厚，像一笔连着写完的。
 */
function infinityPath(seed: number): string {
  const cached = infinityPathCache.get(seed);
  if (cached) return cached;

  const w = wobbler(seed + 53);
  const cx = 50;
  const cy = 26;
  const rx = 43;
  const ry = 38;
  const tilt = (w(0) * 2.5 - 2) * (Math.PI / 180);
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  const from = -0.16;
  const to = Math.PI * 2 + 0.2;
  const steps = 96;

  const outer: string[] = [];
  const inner: string[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    const sin = Math.sin(t);
    const cos = Math.cos(t);

    // 中线与它的单位法线
    const dx = rx * cos;
    const dy = ry * Math.cos(2 * t);
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    const drift = w(i + 1) * 0.35;
    const px = rx * sin + nx * drift;
    const py = ry * sin * cos + ny * drift;

    // 半宽随笔画位置起伏：行笔处重、转折处轻。基准对齐手写体的笔画重量
    const half = 2.2 + 1.0 * Math.abs(Math.sin(t + 0.6)) + w(i + 128) * 0.26;

    const place = (x: number, y: number) =>
      `${(cx + x * cosTilt - y * sinTilt).toFixed(2)} ${(cy + x * sinTilt + y * cosTilt).toFixed(2)}`;

    outer.push(place(px + nx * half, py + ny * half));
    inner.push(place(px - nx * half, py - ny * half));
  }

  const path =
    `M ${outer[0]}` +
    outer.slice(1).map((point) => ` L ${point}`).join("") +
    inner.reverse().map((point) => ` L ${point}`).join("") +
    " Z";
  infinityPathCache.set(seed, path);
  return path;
}

/**
 * 长期有效节点的到期值：一个手写的 ∞。
 *
 * 不用 `∞` 字符：随包分发的手写体是 latin 子集，不含 U+221E，浏览器会回退到
 * 系统字体，一个机械的印刷符号落在满卡手写笔迹里格外扎眼。
 */
export const HandInfinity = memo(function HandInfinity({
  seed,
  label,
}: {
  seed: number;
  /** 供屏幕阅读器朗读的等价文字 */
  label: string;
}) {
  const d = useMemo(() => infinityPath(seed), [seed]);

  return (
    <svg
      className="km-hand-infinity"
      viewBox="0 0 100 52"
      role="img"
      aria-label={label}
    >
      <path d={d} />
    </svg>
  );
});
