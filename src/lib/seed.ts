/**
 * 稳定外观派生。
 *
 * 每个节点的旋转角、文具、撕边形状、笔触抖动全部由 UUID 哈希派生，同一节点在
 * 任何设备、任何次刷新下外观完全一致——每张卡片是一个持久的物件，而不是每次
 * 重绘都变样的随机装饰。
 */

export type StationeryKind =
  | "pin"
  | "pin-white"
  | "clip"
  | "binder"
  | "tape"
  | "washi";

/**
 * 四张 Blender 纸张素材。
 *
 * 纸的形变不是随机的：固定物压住纸的位置决定了纸在哪里被压平、朝哪个方向翘起。
 * 这个影响只有两个维度——握持位置（左约 6.5% 或中约 50%）× 握持宽度（图钉是
 * 一个点，胶带是一整条带），四种组合即可覆盖全部六件文具。
 */
export type PaperSheet =
  | "a-left-point"
  | "b-left-band"
  | "c-mid-point"
  | "d-mid-band";

export interface StationeryDef {
  /** 素材文件名（不含扩展名） */
  file: string;
  /** 决定 CSS 定位与尺寸的类别 */
  kind: StationeryKind;
  /** 素材原始尺寸（@1x），用于计算宽高比 */
  ratio: number;
  /**
   * 与该文具的握持位置、握持宽度匹配的纸张素材。
   *
   * 写在文具上而不是另开一张 kind→sheet 的表：新增文具时漏改那张表，纸的
   * 压平点就会落在没有东西压着的地方。
   */
  sheet: PaperSheet;
}

/**
 * 六件文具（素材来源见 THIRD_PARTY.md）。每张卡只挂一件。
 *
 * pin 与 clip 共用 a、tape 与 binder 共用 d：这两对的握持宽度只差几毫米，
 * 折算到卡片上是几个像素，而它们各自盖着不同的文具、有各自的旋转角。
 */
export const STATIONERY: readonly StationeryDef[] = [
  { file: "pushpin-brass", kind: "pin", ratio: 40 / 55, sheet: "a-left-point" },
  { file: "paperclip-silver", kind: "clip", ratio: 55 / 93, sheet: "a-left-point" },
  { file: "tape-kraft", kind: "tape", ratio: 132 / 51, sheet: "d-mid-band" },
  { file: "washi-blue", kind: "washi", ratio: 113 / 90, sheet: "b-left-band" },
  { file: "pushpin-white", kind: "pin-white", ratio: 55 / 61, sheet: "c-mid-point" },
  { file: "binder-clip-black", kind: "binder", ratio: 86 / 66, sheet: "d-mid-band" },
];

/**
 * 标题下划线的两种笔色：蓝、紫两支笔交替。
 * 颜色再多就会被读成分类标记，而这道线只是随手划的强调。
 */
export const UNDERLINE_COLORS = ["#2f6fe0", "#7b4fd0"] as const;

/**
 * murmur3 的最终混合（avalanche）。
 *
 * FNV-1a 的低位雪崩很弱，而 UUID 之间往往只差末尾几个字符，直接对 6 或 8 取余
 * 会让多个节点分到同一件文具。补上这步混合，小模数取余的分布才接近均匀。
 */
function fmix32(value: number): number {
  let h = value;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a 32 位哈希 + 雪崩混合 */
export function hashUUID(uuid: string): number {
  let h = 2166136261;
  for (let i = 0; i < uuid.length; i++) {
    h ^= uuid.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return fmix32(h);
}

export interface PaperAppearance {
  /** 旋转角度，单位 deg */
  rotation: number;
  stationery: StationeryDef;
  /**
   * 文具的水平位置偏移（px）。
   * 节点多于六个时同一件文具必然重复出现，位置再完全一致就会显出复制感。
   */
  stationeryOffset: number;
  /** 独立纸张轮廓与纤维的种子 */
  paperSeed: number;
  /** 纸边厚度（CSS px） */
  paperDepth: number;
  /** 纸面极轻的冷暖偏色 */
  paperAccent: string;
  /** 离墙投影的纵向距离与模糊半径（CSS px） */
  shadowY: number;
  shadowBlur: number;
  /** 纸片在栅格格子里的轻微错位（CSS px） */
  offsetX: number;
  offsetY: number;
  /** 按固定物位置决定的物理旋转支点（百分比） */
  pivotX: number;
  /** 下划线笔色 */
  underlineColor: string;
  /** 手绘笔触用的稳定随机种子 */
  roughSeed: number;
}

/**
 * 由 UUID 派生一整套外观参数。
 *
 * 每个属性用独立的哈希（uuid 拼上属性名），而不是同一个哈希的不同位段：
 * 位段之间存在相关性，会让若干节点连文具带角度一起撞车，卡片墙上就出现
 * 两张看起来一模一样的纸。
 */
export function deriveAppearance(
  uuid: string,
  wallIndex?: number,
): PaperAppearance {
  const pick = (attribute: string, modulo: number) =>
    hashUUID(`${uuid}:${attribute}`) % modulo;

  /**
   * 姿态按槽位编排而不是纯随机：UUID 哈希只保证大样本均匀，不保证眼前这六张纸
   * 的角度不趋同。这组角度正负交错并含近水平值，第二轮反向循环，节点再多也不会出现
   * 整排朝同一方向倾斜。UUID 只补不超过 0.035° 的个体差。
   */
  const poses = [-0.42, 0.06, -0.18, 0.28, -0.05, 0.16] as const;
  const xOffsets = [-1, 0.5, 1, -0.5, 0, 0.8] as const;
  const yOffsets = [-1, 1, 0, 2, -1, 1] as const;
  const slot = wallIndex ?? pick("wall-slot", poses.length);
  const cycle = Math.floor(slot / poses.length);
  const position = slot % poses.length;
  const direction = cycle % 2 === 0 ? 1 : -1;
  const rotationJitter = (pick("rotation-jitter", 71) - 35) / 1000;

  // 第一屏严格一纸一件；后续每六张错开两位，避免同一列重复出现相同文具。
  const stationeryIndex =
    wallIndex === undefined
      ? pick("stationery", STATIONERY.length)
      : (position + cycle * 2) % STATIONERY.length;
  const stationery = STATIONERY[stationeryIndex];
  const pivotByKind: Record<StationeryKind, number> = {
    pin: 7,
    clip: 7,
    tape: 52,
    washi: 7,
    "pin-white": 51,
    binder: 48,
  };
  const paperAccents = [
    "#d8c9ac",
    "#d8e0e2",
    "#dfd2c2",
    "#d2d7cc",
    "#e1d5c8",
    "#cfd8dd",
  ];

  return {
    rotation: poses[position] * direction + rotationJitter,
    stationery,
    // -14px ~ +14px
    stationeryOffset: pick("stationery-offset", 29) - 14,
    paperSeed: stableSeed(`${uuid}:paper-edge`),
    paperDepth: 1.2 + pick("paper-depth", 14) / 10,
    paperAccent: paperAccents[pick("paper-accent", paperAccents.length)],
    shadowY: 9 + pick("paper-shadow-y", 5),
    shadowBlur: 12 + pick("paper-shadow-blur", 6),
    offsetX: xOffsets[position] * direction,
    offsetY: yOffsets[position],
    pivotX: pivotByKind[stationery.kind],
    underlineColor: UNDERLINE_COLORS[pick("underline", UNDERLINE_COLORS.length)],
    roughSeed: stableSeed(`${uuid}:rough`),
  };
}

/** 供手绘笔触使用的稳定种子（同一 key 永远得到同一形状） */
export function stableSeed(key: string): number {
  return (hashUUID(key) % 2147483647) || 1;
}
