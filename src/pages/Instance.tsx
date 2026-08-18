import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  useLoadRecords,
  usePingRecords,
  useRecentRecords,
} from "@/api/queries";
import type {
  LoadRecord,
  NodeStatus,
  PingRecord,
  RecentReport,
} from "@/api/types";
import { RoughChart, type ChartSeries } from "@/components/chart/RoughChart";
import {
  TimeRangeBrush,
  type TimeRangeSelection,
} from "@/components/chart/TimeRangeBrush";
import { DoodleIcon } from "@/components/paper/DoodleIcon";
import { Flag } from "@/components/paper/Flag";
import {
  HandInfinity,
  HandRule,
  HandUnderline,
} from "@/components/paper/HandDrawn";
import { PaperSurface } from "@/components/paper/PaperSurface";
import { Stationery } from "@/components/paper/Stationery";
import { useLiveData } from "@/contexts/live-data";
import { useSite } from "@/contexts/site";
import { LOCALE } from "@/i18n";
import {
  expiryDays,
  formatBytes,
  formatPercent,
  formatSpeed,
  formatSpeedAxis,
  formatTraffic,
  formatUptime,
  shortenOS,
  toPercent,
} from "@/lib/format";
import { deriveAppearance, stableSeed } from "@/lib/seed";

/**
 * 历史接口按整小时查询。预设只负责提供常用窗口，最终会再按 Komari
 * 公布的保留期限裁切，避免请求一个服务端不可能返回完整数据的范围。
 */
const HISTORY_RANGE_PRESETS = [
  { hours: 1, key: "1h" },
  { hours: 4, key: "4h" },
  { hours: 24, key: "24h" },
  { hours: 168, key: "7d" },
] as const;

type HistoryTab = "system" | "latency";
type HistoryRange = {
  hours: number;
  key: string;
  labelKey?: (typeof HISTORY_RANGE_PRESETS)[number]["key"];
};

const FULL_TIME_RANGE: TimeRangeSelection = [0, 1_000];
const REALTIME_RECORD_LIMIT = 150;

function buildHistoryRanges(retentionHours: number | undefined): HistoryRange[] {
  if (retentionHours === undefined) {
    return HISTORY_RANGE_PRESETS.map((range) => ({
      ...range,
      labelKey: range.key,
    }));
  }

  const numericRetention = Number(retentionHours);
  // Komari 的旧版历史接口只接受整数小时；不足 1 小时或关闭记录时仍保留
  // 一个 1h 入口，让界面有稳定的最小窗口（关闭记录会显示专门的提示）。
  const maximum = Number.isFinite(numericRetention)
    ? Math.max(1, Math.floor(numericRetention))
    : 1;
  const ranges: HistoryRange[] = HISTORY_RANGE_PRESETS.filter(
    (range) => range.hours <= maximum,
  ).map((range) => ({ ...range, labelKey: range.key }));

  // 配置并不一定正好落在 1h / 4h / 24h / 7d 上。与官方前端一致，
  // 额外给出“保留期上限”这一档，但绝不显示超过上限的预设。
  if (!ranges.some((range) => range.hours === maximum)) {
    ranges.push({ hours: maximum, key: `retention-${maximum}` });
  }

  return ranges.sort((a, b) => a.hours - b.hours);
}

function resolveHistoryHours(ranges: HistoryRange[], selected: number): number {
  if (ranges.some((range) => range.hours === selected)) return selected;
  return ranges.at(-1)?.hours ?? 1;
}

function toSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentReportToLoadRecord(report: RecentReport): LoadRecord {
  return {
    client: report.uuid,
    time: report.updated_at,
    cpu: numeric(report.cpu?.usage),
    gpu: 0,
    ram: numeric(report.ram?.used),
    ram_total: numeric(report.ram?.total),
    swap: numeric(report.swap?.used),
    swap_total: numeric(report.swap?.total),
    load: numeric(report.load?.load1),
    temp: 0,
    disk: numeric(report.disk?.used),
    disk_total: numeric(report.disk?.total),
    net_in: numeric(report.network?.down),
    net_out: numeric(report.network?.up),
    net_total_up: numeric(report.network?.totalUp),
    net_total_down: numeric(report.network?.totalDown),
    process: numeric(report.process),
    connections: numeric(report.connections?.tcp),
    connections_udp: numeric(report.connections?.udp),
  };
}

function liveStatusToLoadRecord(
  uuid: string,
  status: NodeStatus,
  sampledAt: number,
): LoadRecord {
  return {
    client: uuid,
    time: new Date(sampledAt).toISOString(),
    cpu: numeric(status.cpu),
    gpu: numeric(status.gpu),
    ram: numeric(status.ram),
    ram_total: numeric(status.ram_total),
    swap: numeric(status.swap),
    swap_total: numeric(status.swap_total),
    load: numeric(status.load),
    temp: numeric(status.temp),
    disk: numeric(status.disk),
    disk_total: numeric(status.disk_total),
    net_in: numeric(status.net_in),
    net_out: numeric(status.net_out),
    net_total_up: numeric(status.net_total_up),
    net_total_down: numeric(status.net_total_down),
    process: numeric(status.process),
    connections: numeric(status.connections),
    connections_udp: numeric(status.connections_udp),
  };
}

function mergeRealtimeRecords(
  recent: LoadRecord[],
  appended: LoadRecord[],
): LoadRecord[] {
  const byTime = new Map<number, LoadRecord>();
  for (const record of [...recent, ...appended]) {
    const timestamp = new Date(record.time).getTime();
    if (Number.isFinite(timestamp)) byTime.set(timestamp, record);
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, record]) => record)
    .slice(-REALTIME_RECORD_LIMIT);
}

export function InstancePage() {
  const { t } = useTranslation();
  const { uuid } = useParams<{ uuid: string }>();
  const { nodes, settings, loading } = useSite();
  const { status, updatedAt } = useLiveData();
  const [systemView, setSystemView] = useState<"realtime" | number>("realtime");
  const [latencyHours, setLatencyHours] = useState(4);
  const [liveRecordBuffer, setLiveRecordBuffer] = useState<{
    uuid: string;
    records: LoadRecord[];
  }>({ uuid: "", records: [] });
  const [historyTab, setHistoryTab] = useState<HistoryTab>("system");
  const [pingRange, setPingRange] =
    useState<TimeRangeSelection>(FULL_TIME_RANGE);

  const handleHistoryTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: HistoryTab,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: HistoryTab = current === "system" ? "latency" : "system";
    setHistoryTab(next);
    requestAnimationFrame(() => document.getElementById(`km-${next}-tab`)?.focus());
  };

  const node = nodes.find((item) => item.uuid === uuid);
  const live = node ? status[node.uuid] : undefined;

  const systemRanges = useMemo(
    () => buildHistoryRanges(settings?.record_preserve_time),
    [settings?.record_preserve_time],
  );
  const latencyRanges = useMemo(
    () => buildHistoryRanges(settings?.ping_record_preserve_time),
    [settings?.ping_record_preserve_time],
  );
  const selectedSystemHours = typeof systemView === "number" ? systemView : 4;
  const systemHours = resolveHistoryHours(systemRanges, selectedSystemHours);
  const resolvedLatencyHours = resolveHistoryHours(latencyRanges, latencyHours);
  const activeRanges = historyTab === "system" ? systemRanges : latencyRanges;
  const hours = historyTab === "system" ? systemHours : resolvedLatencyHours;
  const isRealtime = historyTab === "system" && systemView === "realtime";
  const historySettingsReady = settings !== undefined;

  const recentQuery = useRecentRecords(node?.uuid, isRealtime);
  const recordsQuery = useLoadRecords(
    node?.uuid,
    "all",
    systemHours,
    historySettingsReady && historyTab === "system" && !isRealtime,
  );
  const pingQuery = usePingRecords(
    node?.uuid,
    hours,
    historySettingsReady && historyTab === "latency",
  );

  useEffect(() => {
    if (!isRealtime || !node || !live || updatedAt <= 0) return;
    const next = liveStatusToLoadRecord(node.uuid, live, updatedAt);

    // 实时轮询属于外部数据订阅；每次成功刷新追加一个点，并限制为官方同量级的
    // 150 点 FIFO，离开实时视图后停止增长。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveRecordBuffer((current) => {
      const previous = current.uuid === node.uuid ? current.records : [];
      if (previous.at(-1)?.time === next.time) return current;
      return {
        uuid: node.uuid,
        records: [...previous, next].slice(-REALTIME_RECORD_LIMIT),
      };
    });
  }, [isRealtime, live, node, updatedAt]);

  const look = useMemo(
    () => deriveAppearance(node?.uuid ?? "unknown"),
    [node?.uuid],
  );

  const recentRecords = useMemo(
    () => (recentQuery.data ?? []).map(recentReportToLoadRecord),
    [recentQuery.data],
  );

  const realtimeRecords = useMemo(
    () =>
      mergeRealtimeRecords(
        recentRecords,
        node && liveRecordBuffer.uuid === node.uuid ? liveRecordBuffer.records : [],
      ),
    [liveRecordBuffer, node, recentRecords],
  );

  const records: LoadRecord[] = useMemo(() => {
    if (!isRealtime) {
      // 从实时首次切到历史时，历史查询还没有 previousData 可沿用；继续画实时
      // 曲线直到首个历史响应回来，避免五张图同时闪空。
      return recordsQuery.data?.records ?? realtimeRecords;
    }
    return realtimeRecords;
  }, [isRealtime, realtimeRecords, recordsQuery.data]);

  const timestamps = useMemo(
    () => records.map((record) => toSeconds(record.time)),
    [records],
  );

  /**
   * 历史记录里的 ram_total / disk_total 恒为 0（服务端不重复存总量），
   * 换算百分比必须回到节点静态信息里取。
   */
  const cpuSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: t("metric.cpu"),
        values: records.map((r) => r.cpu),
        color: "var(--c-cpu)",
      },
    ],
    [records, t],
  );

  const memSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: t("metric.memory"),
        values: records.map((r) => toPercent(r.ram, node?.mem_total ?? 0)),
        color: "var(--c-mem)",
      },
    ],
    [records, node?.mem_total, t],
  );

  const diskSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: t("metric.disk"),
        values: records.map((r) => toPercent(r.disk, node?.disk_total ?? 0)),
        color: "var(--c-disk)",
      },
    ],
    [records, node?.disk_total, t],
  );

  const netSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: t("metric.upload"),
        values: records.map((r) => r.net_out),
        color: "var(--c-cpu)",
      },
      {
        label: t("metric.download"),
        values: records.map((r) => r.net_in),
        color: "var(--c-online)",
      },
    ],
    [records, t],
  );

  const loadSeries = useMemo<ChartSeries[]>(
    () => [
      {
        label: t("metric.load"),
        values: records.map((r) => r.load),
        color: "var(--c-disk)",
      },
    ],
    [records, t],
  );

  /**
   * Ping 记录是「每个任务一条流」混在一个数组里的，需要先按任务拆开，
   * 再对齐到同一条时间轴上——缺失的采样点填 null，uPlot 会自然断开线段。
   */
  const pingChart = useMemo(() => {
    const raw: PingRecord[] = pingQuery.data?.records ?? [];
    if (raw.length === 0) return null;

    const tasks = pingQuery.data?.tasks ?? [];
    const taskName = new Map(tasks.map((task) => [task.id, task.name]));

    const times = [...new Set(raw.map((record) => toSeconds(record.time)))].sort(
      (a, b) => a - b,
    );
    const timeIndex = new Map(times.map((time, index) => [time, index]));

    const byTask = new Map<number, (number | null)[]>();
    for (const record of raw) {
      let list = byTask.get(record.task_id);
      if (!list) {
        list = new Array<number | null>(times.length).fill(null);
        byTask.set(record.task_id, list);
      }
      const index = timeIndex.get(toSeconds(record.time));
      // 负值代表这次探测失败，画成断点而不是画到 0
      if (index !== undefined) list[index] = record.value < 0 ? null : record.value;
    }

    const palette = [
      "var(--c-cpu)",
      "var(--c-mem)",
      "var(--c-disk)",
      "var(--c-online)",
      "var(--c-warn)",
    ];

    const series: ChartSeries[] = [...byTask.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([taskId, values], index) => ({
        label: taskName.get(taskId) ?? `#${taskId}`,
        values,
        color: palette[index % palette.length],
      }));

    return { times, series };
  }, [pingQuery.data]);

  const selectedPingChart = useMemo(() => {
    if (!pingChart || pingChart.times.length === 0) return null;

    const first = pingChart.times[0];
    const last = pingChart.times[pingChart.times.length - 1];
    const duration = Math.max(1, last - first);
    const startTime = first + (duration * pingRange[0]) / 1_000;
    const endTime = first + (duration * pingRange[1]) / 1_000;

    let startIndex = pingChart.times.findIndex((time) => time >= startTime);
    if (startIndex === -1) startIndex = pingChart.times.length - 1;

    let endIndex = pingChart.times.findIndex((time) => time > endTime);
    if (endIndex === -1) endIndex = pingChart.times.length;
    endIndex = Math.max(startIndex + 1, endIndex);

    return {
      times: pingChart.times.slice(startIndex, endIndex),
      series: pingChart.series.map((item) => ({
        ...item,
        values: item.values.slice(startIndex, endIndex),
      })),
    };
  }, [pingChart, pingRange]);

  const rangeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(LOCALE, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [],
  );

  const selectedStart = selectedPingChart?.times[0];
  const selectedEnd = selectedPingChart?.times.at(-1);
  const selectedStartText = selectedStart
    ? rangeFormatter.format(selectedStart * 1_000)
    : "—";
  const selectedEndText = selectedEnd
    ? rangeFormatter.format(selectedEnd * 1_000)
    : "—";

  if (loading && !node) {
    return (
      <div className="km-page-instance">
        <div className="km-notice">
          <p>{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (!node) {
    return (
      <div className="km-page-instance">
        <div className="km-notice">
          <h2>{t("instance.notFound")}</h2>
          <p>{t("instance.notFoundHint")}</p>
          <Link to="/">{t("instance.backToIndex")}</Link>
        </div>
      </div>
    );
  }

  const online = live?.online ?? false;
  const memTotal = live?.ram_total || node.mem_total;
  const diskTotal = live?.disk_total || node.disk_total;
  const up = formatSpeed(live?.net_out ?? 0);
  const down = formatSpeed(live?.net_in ?? 0);
  const uptime = formatUptime(live?.uptime ?? 0);
  const remainingDays = expiryDays(node.expired_at);
  const recordsDisabled = settings?.record_enabled === false;

  const paperStyle = {
    "--rotation": `${look.rotation}deg`,
    "--paper-depth": `${look.paperDepth}px`,
    "--paper-accent": look.paperAccent,
    "--paper-shadow-y": `${look.shadowY}px`,
    "--paper-shadow-blur": `${look.shadowBlur}px`,
    "--paper-x": `${look.offsetX}px`,
    "--paper-y": `${look.offsetY}px`,
    "--paper-pivot-x": `${look.pivotX}%`,
  } as React.CSSProperties;

  return (
    <div className="km-page-instance">
      <div className="km-instance-sheet km-node-card" style={paperStyle}>
        <PaperSurface seed={look.paperSeed} />
        <Stationery def={look.stationery} offset={look.stationeryOffset} />

        {/* 内边距与排版基准都挂在 body 上：容器查询单位不能解析自身容器 */}
        <div className="km-card-body">
        <header className="km-card-header">
          <div style={{ minWidth: 0 }}>
            <h2 className="km-card-title">
              <span className="km-hand-underline">
                {node.name}
                <HandUnderline
                  seed={look.roughSeed}
                  color={look.underlineColor}
                />
              </span>
            </h2>
            <p className="km-card-meta">
              OS: {shortenOS(node.os)}
              <span className="km-card-meta-sep">·</span>
              {node.arch}
              <span className="km-card-meta-sep">·</span>
              {node.virtualization}
              <span className="km-card-meta-sep">·</span>
              {node.kernel_version}
            </p>
            <p className="km-card-meta">{node.cpu_name}</p>
          </div>
          <div className="km-card-header-right">
            <Flag region={node.region} />
            <span className="km-status" data-online={String(online)}>
              {online ? t("common.online") : t("common.offline")}
            </span>
          </div>
        </header>

        <HandRule seed={look.roughSeed} />

        <div className="km-instance-stats">
          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="cpu" />
              {t("metric.cpu")}
            </span>
            <b className="km-stat-value km-num" style={{ color: "var(--c-cpu)" }}>
              {formatPercent(live?.cpu ?? 0)}%
            </b>
            <span className="km-stat-meta km-num">
              {node.cpu_cores}{" "}
              {node.cpu_cores === 1 ? t("common.core") : t("common.cores")}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="memory" />
              {t("metric.memory")}
            </span>
            <b className="km-stat-value km-num" style={{ color: "var(--c-mem)" }}>
              {formatPercent(toPercent(live?.ram ?? 0, memTotal))}%
            </b>
            <span className="km-stat-meta km-num">
              {formatBytes(live?.ram ?? 0)} / {formatBytes(memTotal)}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="disk" />
              {t("metric.disk")}
            </span>
            <b
              className="km-stat-value km-num"
              style={{ color: "var(--c-disk-text)" }}
            >
              {formatPercent(toPercent(live?.disk ?? 0, diskTotal))}%
            </b>
            <span className="km-stat-meta km-num">
              {formatBytes(live?.disk ?? 0)} / {formatBytes(diskTotal)}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="load" />
              {t("metric.load")}
            </span>
            <b className="km-stat-value km-num">
              {(live?.load ?? 0).toFixed(2)}
            </b>
            <span className="km-stat-meta km-num">
              {(live?.load5 ?? 0).toFixed(2)} / {(live?.load15 ?? 0).toFixed(2)}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="network" />
              {t("metric.netSpeed")}
            </span>
            <b className="km-stat-value km-num" style={{ color: "var(--c-cpu)" }}>
              ↑ {up.value} {up.unit}
            </b>
            <span
              className="km-stat-meta km-num"
              style={{ color: "var(--c-online-text)" }}
            >
              ↓ {down.value} {down.unit}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="globe" />
              {t("metric.trafficOut")}
            </span>
            <b className="km-stat-value km-num">
              {formatTraffic(live?.net_total_up ?? 0)}
            </b>
            <span className="km-stat-meta km-num">
              ↓ {formatTraffic(live?.net_total_down ?? 0)}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="uptime" />
              {t("metric.uptime")}
            </span>
            <b className="km-stat-value km-num">
              {uptime.value} {t(`unit.${uptime.unit}s`)}
            </b>
            <span className="km-stat-meta km-num">
              {live?.process ?? 0} {t("metric.process")}
            </span>
          </div>

          <div className="km-stat">
            <span className="km-stat-label">
              <DoodleIcon name="calendar" />
              {t("metric.expiresIn")}
            </span>
            <b className="km-stat-value km-num">
              {remainingDays === null ? (
                <HandInfinity
                  seed={look.roughSeed}
                  label={t("metric.neverExpires")}
                />
              ) : (
                `${remainingDays} ${t("unit.days")}`
              )}
            </b>
            <span className="km-stat-meta km-num">
              {node.price > 0
                ? `${node.currency}${node.price} / ${t("instance.perDays", { count: node.billing_cycle })}`
                : t("instance.free")}
            </span>
          </div>
        </div>
        </div>
      </div>

      <div className="km-instance-toolbar">
        <div>
          <h3 className="km-instance-section-title">{t("instance.charts")}</h3>
          <div
            className="km-history-tabs"
            role="tablist"
            aria-label={t("instance.charts")}
          >
            <button
              id="km-system-tab"
              type="button"
              role="tab"
              className="km-history-tab"
              aria-selected={historyTab === "system"}
              aria-controls="km-system-panel"
              data-active={historyTab === "system"}
              onClick={() => setHistoryTab("system")}
              onKeyDown={(event) => handleHistoryTabKeyDown(event, "system")}
            >
              <DoodleIcon name="server" />
              {t("instance.systemTab")}
            </button>
            <button
              id="km-latency-tab"
              type="button"
              role="tab"
              className="km-history-tab"
              aria-selected={historyTab === "latency"}
              aria-controls="km-latency-panel"
              data-active={historyTab === "latency"}
              onClick={() => setHistoryTab("latency")}
              onKeyDown={(event) => handleHistoryTabKeyDown(event, "latency")}
            >
              <DoodleIcon name="clock" />
              {t("instance.latencyTab")}
            </button>
          </div>
        </div>
        <div className="km-range-picker" role="group" aria-label={t("instance.charts")}>
          {historyTab === "system" ? (
            <button
              type="button"
              className="km-ui-button"
              aria-pressed={isRealtime}
              data-active={isRealtime}
              onClick={() => setSystemView("realtime")}
            >
              {t("range.realtime")}
            </button>
          ) : null}
          {(historySettingsReady ? activeRanges : []).map((range) => {
            const active =
              historyTab === "system"
                ? systemView !== "realtime" && systemHours === range.hours
                : resolvedLatencyHours === range.hours;
            return (
              <button
                key={range.key}
                type="button"
                className="km-ui-button"
                aria-pressed={active}
                data-active={active}
                onClick={() => {
                  if (historyTab === "system") {
                    setSystemView(range.hours);
                  } else {
                    setLatencyHours(range.hours);
                    setPingRange(FULL_TIME_RANGE);
                  }
                }}
              >
                {range.labelKey
                  ? t(`range.${range.labelKey}`)
                  : range.hours % 24 === 0
                    ? t("range.days", { count: range.hours / 24 })
                    : t("range.hours", { count: range.hours })}
              </button>
            );
          })}
        </div>
      </div>

      {historyTab === "system" ? (
        <div
          id="km-system-panel"
          role="tabpanel"
          aria-labelledby="km-system-tab"
          aria-busy={!isRealtime && recordsQuery.isFetching}
        >
          {recordsDisabled && !isRealtime ? (
            <div className="km-notice">
              <p>{t("instance.recordDisabled")}</p>
            </div>
          ) : (
            <div
              className="km-instance-charts"
              data-refreshing={
                isRealtime ? recentQuery.isFetching : recordsQuery.isFetching
              }
            >
              <ChartCard
                title={t("instance.cpuChart")}
                seed="cpu"
              >
                <RoughChart
                  timestamps={timestamps}
                  series={cpuSeries}
                  range={[0, 100]}
                  formatValue={(v) => `${v.toFixed(0)}%`}
                />
              </ChartCard>

              <ChartCard
                title={t("instance.memoryChart")}
                seed="memory"
              >
                <RoughChart
                  timestamps={timestamps}
                  series={memSeries}
                  range={[0, 100]}
                  formatValue={(v) => `${v.toFixed(0)}%`}
                />
              </ChartCard>

              <ChartCard
                title={t("instance.diskChart")}
                seed="disk"
              >
                <RoughChart
                  timestamps={timestamps}
                  series={diskSeries}
                  range={[0, 100]}
                  formatValue={(v) => `${v.toFixed(0)}%`}
                />
              </ChartCard>

              <ChartCard
                title={t("instance.loadChart")}
                seed="load"
              >
                <RoughChart
                  timestamps={timestamps}
                  series={loadSeries}
                />
              </ChartCard>

              <ChartCard
                title={t("instance.networkChart")}
                seed="network"
              >
                <RoughChart
                  timestamps={timestamps}
                  series={netSeries}
                  formatValue={formatSpeedAxis}
                />
              </ChartCard>
            </div>
          )}
        </div>
      ) : (
        <div
          id="km-latency-panel"
          role="tabpanel"
          aria-labelledby="km-latency-tab"
          aria-busy={pingQuery.isFetching}
          className="km-instance-charts km-instance-charts--latency"
          data-refreshing={pingQuery.isFetching}
        >
          <ChartCard
            title={`${t("instance.pingChart")} · ms`}
            seed="ping"
            className="km-chart-card--latency"
          >
            {pingQuery.isLoading && !selectedPingChart ? (
              <p className="km-chart-empty">{t("common.loading")}</p>
            ) : selectedPingChart ? (
              <>
                <TimeRangeBrush
                  value={pingRange}
                  onChange={setPingRange}
                  label={t("instance.latencyRange")}
                  startLabel={t("instance.rangeStart")}
                  endLabel={t("instance.rangeEnd")}
                  startText={selectedStartText}
                  endText={selectedEndText}
                  summary={t("instance.selectedRange", {
                    start: selectedStartText,
                    end: selectedEndText,
                  })}
                  hint={t("instance.adaptiveDensity")}
                />
                <RoughChart
                  timestamps={selectedPingChart.times}
                  series={selectedPingChart.series}
                  height={300}
                  formatValue={(value) => `${value.toFixed(0)}`}
                  adaptiveDensity
                />
                <div className="km-chart-legend">
                  {selectedPingChart.series.map((series) => (
                    <span key={series.label} className="km-chart-legend-item">
                      <i style={{ background: series.color }} aria-hidden="true" />
                      {series.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="km-chart-empty">{t("instance.noData")}</p>
            )}
          </ChartCard>
        </div>
      )}

      <p className="km-instance-back">
        <Link to="/">{t("instance.backToIndex")}</Link>
      </p>
    </div>
  );
}

function ChartCard({
  title,
  children,
  seed,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  seed: string;
  className?: string;
}) {
  return (
    <section className={`km-chart-card ${className}`.trim()}>
      <PaperSurface seed={stableSeed(`chart:${seed}`)} />
      <h4 className="km-chart-title">{title}</h4>
      {children}
    </section>
  );
}
