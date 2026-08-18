import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { KomariNode, NodeStatus } from "@/api/types";
import { DoodleIcon } from "./DoodleIcon";
import { Flag } from "./Flag";
import {
  HandDashes,
  HandDivider,
  HandInfinity,
  HandRule,
  HandUnderline,
  CrayonBar,
} from "./HandDrawn";
import { Stationery } from "./Stationery";
import { PaperSheet } from "./PaperSheet";
import { PaperSurface } from "./PaperSurface";
import { deriveAppearance, stableSeed } from "@/lib/seed";
import {
  expiryDays,
  formatBytes,
  formatPercent,
  formatSpeed,
  formatTraffic,
  formatUptime,
  shortenOS,
  toPercent,
} from "@/lib/format";

interface Props {
  node: KomariNode;
  /** 未拿到实时状态时为 undefined（节点刚添加、或轮询尚未返回） */
  status: NodeStatus | undefined;
  /** 首页中的视觉槽位，用来避免随机结果整排扎堆 */
  appearanceIndex: number;
  /**
   * 用 Blender 素材而不是程序化 SVG 画这张纸。
   * 由 Index 统一判定后下发：每张卡各自订阅 matchMedia 的话，答案完全一样却要
   * 付出与节点数成正比的订阅开销。
   */
  useSheet: boolean;
}

/** 到期紧急程度：7 天内红色，30 天内黄色 */
function urgency(days: number | null): "true" | "soon" | "false" {
  if (days === null) return "false";
  if (days <= 7) return "true";
  if (days <= 30) return "soon";
  return "false";
}

const MetricRow = memo(function MetricRow({
  icon,
  label,
  percent,
  detail,
  modifier,
  seed,
  accent,
  digits,
}: {
  icon: "cpu" | "memory" | "disk";
  label: string;
  percent: number;
  detail: string;
  modifier: string;
  seed: number;
  accent: string;
  digits: number;
}) {
  return (
    <div className={`km-metric km-metric--${modifier}`}>
      <div className="km-metric-head">
        <span className="km-metric-label">
          <DoodleIcon name={icon} />
          {label}
        </span>
        <span className="km-metric-value km-num">
          {formatPercent(percent, digits)}
          <span className="km-metric-value-unit">%</span>
        </span>
      </div>
      <div className="km-metric-detail">
        <span className="km-metric-meta km-num">{detail}</span>
        <CrayonBar value={percent} seed={seed} color={accent} />
      </div>
    </div>
  );
});

const CardHeader = memo(function CardHeader({
  node,
  online,
  roughSeed,
  underlineColor,
}: {
  node: KomariNode;
  online: boolean;
  roughSeed: number;
  underlineColor: string;
}) {
  const { t } = useTranslation();
  const osLine = [shortenOS(node.os), node.arch, node.virtualization].filter(
    Boolean,
  );

  return (
    <header className="km-card-header">
      <div style={{ minWidth: 0 }}>
        <h2 className="km-card-title">
          <span className="km-hand-underline">
            {node.name}
            <HandUnderline seed={roughSeed} color={underlineColor} />
          </span>
        </h2>
        <p className="km-card-meta">
          {osLine.map((part, index) => (
            <span key={part}>
              {index === 0 ? "OS: " : null}
              {part}
              {index < osLine.length - 1 ? (
                <span className="km-card-meta-sep">·</span>
              ) : null}
            </span>
          ))}
        </p>
      </div>

      <div className="km-card-header-right">
        <Flag region={node.region} />
        {/* 状态不只靠颜色传达：圆点 + 文字双重指示 */}
        <span className="km-status" data-online={String(online)}>
          {online ? t("common.online") : t("common.offline")}
        </span>
      </div>
    </header>
  );
});

const CardBottom = memo(function CardBottom({
  remainingDays,
  trafficOutText,
  trafficInText,
  uptimeValue,
  uptimeUnit,
  roughSeed,
}: {
  remainingDays: number | null;
  trafficOutText: string;
  trafficInText: string;
  uptimeValue: number;
  uptimeUnit: "day" | "hour" | "minute";
  roughSeed: number;
}) {
  const { t } = useTranslation();

  return (
    <div className="km-card-bottom">
      <div className="km-bottom-cell km-bottom-cell--traffic">
          <div className="km-bottom-row km-bottom-row--out">
            <span className="km-bottom-label">
              <DoodleIcon name="upload" className="km-bottom-arrow" />
              {t("metric.trafficOut")}
            </span>
            <div className="km-bottom-value km-num">{trafficOutText}</div>
          </div>
          <div className="km-bottom-row km-bottom-row--in">
            <span className="km-bottom-label">
              <DoodleIcon name="download" className="km-bottom-arrow" />
              {t("metric.trafficIn")}
            </span>
          <div className="km-bottom-value km-num">{trafficInText}</div>
        </div>
      </div>

      <div className="km-bottom-cell km-bottom-cell--expiry">
          <div className="km-expiry-box">
            {remainingDays === null ? (
              <>
                <div className="km-expiry-label">{t("metric.expiresIn")}</div>
                <div className="km-expiry-value">
                  <HandInfinity seed={roughSeed} label={t("metric.neverExpires")} />
                </div>
              </>
            ) : remainingDays < 0 ? (
              <>
                <div className="km-expiry-label">{t("metric.expired")}</div>
                <div className="km-expiry-value km-num" data-urgent="true">
                  {Math.abs(remainingDays)} {t("unit.days")}
                </div>
              </>
            ) : (
              <>
                <div className="km-expiry-label">{t("metric.expiresIn")}</div>
                <div
                  className="km-expiry-value km-num"
                  data-urgent={urgency(remainingDays)}
                >
                  {remainingDays} {t("unit.days")}
                </div>
              </>
            )}

          <div className="km-expiry-uptime">
            {t("metric.uptime")}
            <b className="km-num">
              {uptimeValue} {t(`unit.${uptimeUnit}s`)}
            </b>
          </div>
        </div>
      </div>
    </div>
  );
});

function PaperCardImpl({ node, status, appearanceIndex, useSheet }: Props) {
  const { t } = useTranslation();

  // 外观完全由 UUID 派生：同一台服务器永远是同一个角度、同一个图钉
  const look = useMemo(
    () => deriveAppearance(node.uuid, appearanceIndex),
    [appearanceIndex, node.uuid],
  );

  const online = status?.online ?? false;

  const cpuPercent = status?.cpu ?? 0;
  // 实时状态里的 ram_total 可信；缺失时退回节点静态信息
  const memTotal = status?.ram_total || node.mem_total;
  const diskTotal = status?.disk_total || node.disk_total;
  const memPercent = toPercent(status?.ram ?? 0, memTotal);
  const diskPercent = toPercent(status?.disk ?? 0, diskTotal);

  const up = formatSpeed(status?.net_out ?? 0);
  const down = formatSpeed(status?.net_in ?? 0);

  // 服务端在不同版本用过 net_total_out / net_total_up 两种命名
  const trafficOut = status?.net_total_up ?? status?.net_total_out ?? 0;
  const trafficIn = status?.net_total_down ?? 0;
  const remainingDays = expiryDays(node.expired_at);
  const uptime = formatUptime(status?.uptime ?? 0);

  const cores = node.cpu_cores || 1;

  return (
    <Link
      className="km-node-card"
      to={`/instance/${node.uuid}`}
      data-online={String(online)}
      style={
        {
          "--rotation": `${look.rotation}deg`,
          "--paper-depth": `${look.paperDepth}px`,
          "--paper-accent": look.paperAccent,
          "--paper-shadow-y": `${look.shadowY}px`,
          "--paper-shadow-blur": `${look.shadowBlur}px`,
          "--paper-x": `${look.offsetX}px`,
          "--paper-y": `${look.offsetY}px`,
          "--paper-pivot-x": `${look.pivotX}%`,
        } as React.CSSProperties
      }
      aria-label={`${node.name} · ${online ? t("common.online") : t("common.offline")}`}
    >
      {useSheet ? (
        <PaperSheet sheet={look.stationery.sheet} />
      ) : (
        <PaperSurface seed={look.paperSeed} />
      )}
      <Stationery def={look.stationery} offset={look.stationeryOffset} />

      <div className="km-card-body">
        <CardHeader
          node={node}
          online={online}
          roughSeed={look.roughSeed}
          underlineColor={look.underlineColor}
        />

        {/* OS 行与指标区之间是留白而不是分隔线，只有底栏之上才有那一道 */}
        <div className="km-card-metrics">
          <div className="km-metrics-left">
            <MetricRow
              icon="cpu"
              label={t("metric.cpu")}
              percent={cpuPercent}
              detail={`${cores} ${cores === 1 ? t("common.core") : t("common.cores")}`}
              modifier="cpu"
              seed={stableSeed(`${node.uuid}:cpu`)}
              accent="var(--c-cpu)"
              digits={2}
            />
            <MetricRow
              icon="memory"
              label={t("metric.memory")}
              percent={memPercent}
              detail={`${formatBytes(status?.ram ?? 0)} / ${formatBytes(memTotal)}`}
              modifier="mem"
              seed={stableSeed(`${node.uuid}:mem`)}
              accent="var(--c-mem)"
              digits={2}
            />
            {/* 磁盘只保留一位小数：占用以天为尺度变化，第二位小数是噪声 */}
            <MetricRow
              icon="disk"
              label={t("metric.disk")}
              percent={diskPercent}
              detail={`${formatBytes(status?.disk ?? 0)} / ${formatBytes(diskTotal)}`}
              modifier="disk"
              seed={stableSeed(`${node.uuid}:disk`)}
              accent="var(--c-disk)"
              digits={1}
            />
          </div>

          <div className="km-card-side">
            <HandDivider seed={look.roughSeed} />

            <div className="km-side-label">
              <DoodleIcon name="load" />
              {t("metric.load")}
            </div>
            <div className="km-side-value km-num">
              {(status?.load ?? 0).toFixed(2)}
            </div>

            <HandDashes seed={look.roughSeed} />

            <div className="km-side-label">{t("metric.netSpeed")}</div>
            <div className="km-net-row km-net-row--up">
              <DoodleIcon name="upload" className="km-net-arrow" />
              <span className="km-num">{up.value}</span>
              <span className="km-net-unit">{up.unit}</span>
            </div>
            <div className="km-net-row km-net-row--down">
              <DoodleIcon name="download" className="km-net-arrow" />
              <span className="km-num">{down.value}</span>
              <span className="km-net-unit">{down.unit}</span>
            </div>
          </div>
        </div>

        <HandRule seed={look.roughSeed} />

        {/* 累计流量上下成组，内容高度与右侧的到期 + 运行时长自然平衡 */}
        <CardBottom
          remainingDays={remainingDays}
          trafficOutText={formatTraffic(trafficOut)}
          trafficInText={formatTraffic(trafficIn)}
          uptimeValue={uptime.value}
          uptimeUnit={uptime.unit}
          roughSeed={look.roughSeed}
        />
      </div>
    </Link>
  );
}

/**
 * 只有该节点自身的数据变化时才重渲染。
 *
 * 这是 LiveDataContext「未变化就复用旧对象引用」那套优化的落点：每 2 秒父组件
 * 都会重渲染，但状态没动的卡片在这里被整张跳过。
 */
export const PaperCard = memo(PaperCardImpl);
