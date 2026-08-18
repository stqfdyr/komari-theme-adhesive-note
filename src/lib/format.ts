/**
 * 数值格式化。
 *
 * 口径对齐设计稿：字节按 1024 进制显示为 KB/MB/GB/TB，
 * 网速按 bps/Kbps/Mbps 显示（字节/秒 × 8 换算为比特/秒）。
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const BIT_RATE_UNITS = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"] as const;

/** 有效数字优先的短格式：>=100 取整，>=10 保留 1 位，否则 2 位 */
function short(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/** 字节 → `2.41GB`（1024 进制，无空格，与设计稿一致） */
export function formatBytes(bytes: number, gap = ""): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0${gap}B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${short(value)}${gap}${BYTE_UNITS[unit]}`;
}

/** 字节 → `63.9 GB`（带空格，用于流量统计一行） */
export function formatTraffic(bytes: number): string {
  return formatBytes(bytes, " ");
}

/**
 * 字节/秒 → `952 bps` / `1.52 Kbps`。
 *
 * Komari 的 `net_in` / `net_out` 单位是字节/秒，网络速率习惯用比特计，因此 ×8。
 * 返回值与单位拆开，方便设计稿里那种「数字重、单位轻」的排版。
 */
export function formatSpeed(bytesPerSecond: number): {
  value: string;
  unit: string;
} {
  const bits = Math.max(0, bytesPerSecond) * 8;
  let value = bits;
  let unit = 0;
  while (value >= 1000 && unit < BIT_RATE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return {
    value: unit === 0 ? value.toFixed(0) : short(value),
    unit: BIT_RATE_UNITS[unit],
  };
}

/**
 * 图表坐标轴专用的速率格式化。
 *
 * 与卡片上的 formatSpeed 有两点不同：
 *   - 保证相邻刻度不会显示成同一个值。轴上的刻度常落在同一数量级内
 *     （如 0.5/1.0/1.5 Mbps），卡片那套「≥10 只留一位小数」的短格式会把
 *     它们压成重复标签。
 *   - 不留空格、位数从紧。轴的横向空间很窄，标签一长就会被裁掉左半边。
 */
export function formatSpeedAxis(bytesPerSecond: number): string {
  const bits = Math.max(0, bytesPerSecond) * 8;
  if (bits < 1) return "0";

  let value = bits;
  let unit = 0;
  while (value >= 1000 && unit < BIT_RATE_UNITS.length - 1) {
    value /= 1000;
    unit++;
  }

  const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
  return `${value.toFixed(digits)}${BIT_RATE_UNITS[unit]}`;
}

/** 百分比 → `17.43`（不含 % 号，两位小数，与设计稿一致） */
export function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  return Math.min(100, Math.max(0, value)).toFixed(digits);
}

/** 已用/总量 → 百分比数值 */
export function toPercent(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/**
 * 秒 → 分级的运行时长，天数不足时降级到小时/分钟，
 * 避免刚重启的节点显示 `0 days`。
 */
export function formatUptime(seconds: number): {
  value: number;
  unit: "day" | "hour" | "minute";
} {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { value: 0, unit: "minute" };
  }
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return { value: days, unit: "day" };
  const hours = Math.floor(seconds / 3_600);
  if (hours >= 1) return { value: hours, unit: "hour" };
  return { value: Math.floor(seconds / 60), unit: "minute" };
}

/** 后端未设置到期时间时返回的零值时间 */
function isZeroTime(iso: string): boolean {
  return !iso || iso.startsWith("0001-01-01");
}

/**
 * 「长期有效」的天数阈值。
 *
 * Komari 没有单独的永久标记，管理员表达长期的做法是把到期日填到很远的将来，
 * 于是界面上会出现「73019 天后到期」这种读不出信息的数字。官方前端以约 100 年
 * 为界另作一类，这里取同一个阈值，同一台机器在两边的判定才一致。
 */
const LONG_TERM_DAYS = 36_500;

/**
 * 到期剩余天数。null 表示长期有效——未设置到期日，或到期日远在百年之后；
 * 负数表示已过期。
 */
export function expiryDays(expiredAt: string): number | null {
  if (isZeroTime(expiredAt)) return null;
  const target = new Date(expiredAt).getTime();
  if (!Number.isFinite(target)) return null;
  const days = Math.ceil((target - Date.now()) / 86_400_000);
  return days > LONG_TERM_DAYS ? null : days;
}

/**
 * 从 Komari 的 `os` 字段提炼简称。
 * `Debian GNU/Linux 12 (bookworm)` → `Debian 12 (bookworm)`
 */
export function shortenOS(os: string): string {
  if (!os) return "";
  return os
    .replace(/\s*GNU\/Linux\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}
