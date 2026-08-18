import { startTransition, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { NodeStatusMap } from "@/api/types";
import { rpc2, rpcCall } from "@/lib/rpc2";
import {
  LIVE_POLL_INTERVAL,
  LiveDataContext,
  mergeStatus,
} from "./live-data";

/** 大批节点同时变化时每帧最多提交的卡片数。 */
const STATUS_BATCH_SIZE = 10;

/**
 * 实时状态轮询。
 *
 * 官方主题已放弃 `/api/clients` WebSocket，改为定时调用 RPC2 的
 * `common:getNodesLatestStatus`，本主题跟随该实践，并沿用两项优化：
 * 逐字段 diff 后复用旧引用、页面隐藏时暂停轮询。
 */
export function LiveDataProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NodeStatusMap>({});
  const [updatedAt, setUpdatedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let batchFrame: number | null = null;
    let batchGeneration = 0;
    let statusSnapshot: NodeStatusMap = {};

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = () => {
      clearTimer();
      if (!stopped && !document.hidden) {
        timer = setTimeout(() => void fetchLatest(), LIVE_POLL_INTERVAL);
      }
    };

    const clearStatusBatch = () => {
      batchGeneration++;
      if (batchFrame !== null) {
        cancelAnimationFrame(batchFrame);
        batchFrame = null;
      }
    };

    const commitStatus = (incoming: NodeStatusMap, sampledAt: number) => {
      clearStatusBatch();
      const generation = batchGeneration;
      const merged = mergeStatus(statusSnapshot, incoming);
      const statusKeys = new Set([
        ...Object.keys(statusSnapshot),
        ...Object.keys(merged),
      ]);
      const changedKeys = [...statusKeys].filter(
        (uuid) => statusSnapshot[uuid] !== merged[uuid],
      );

      // 首屏必须一次完整出现；小批更新也不值得引入跨帧调度。
      const isInitial = Object.keys(statusSnapshot).length === 0;
      if (isInitial || changedKeys.length <= STATUS_BATCH_SIZE) {
        statusSnapshot = merged;
        const update = () => {
          setStatus(merged);
          setUpdatedAt(sampledAt);
        };
        // 首屏与 loading 状态同步提交；后续小更新可以作为非紧急更新让路给交互。
        if (isInitial) update();
        else startTransition(update);
        return;
      }

      let offset = 0;
      let working = statusSnapshot;
      const commitNextBatch = () => {
        batchFrame = null;
        if (stopped || generation !== batchGeneration) return;

        const nextMap = { ...working };
        for (const uuid of changedKeys.slice(offset, offset + STATUS_BATCH_SIZE)) {
          const nextStatus = merged[uuid];
          if (nextStatus) nextMap[uuid] = nextStatus;
          else delete nextMap[uuid];
        }
        offset += STATUS_BATCH_SIZE;
        working = nextMap;
        statusSnapshot = nextMap;

        const complete = offset >= changedKeys.length;
        setStatus(nextMap);
        if (complete) {
          setUpdatedAt(sampledAt);
        } else {
          batchFrame = requestAnimationFrame(commitNextBatch);
        }
      };

      // 与网络响应任务错开，再按帧提交；不改变数据，只避免一次性协调整面卡片墙。
      batchFrame = requestAnimationFrame(commitNextBatch);
    };

    const fetchLatest = async () => {
      if (inFlight || stopped || document.hidden) return;
      inFlight = true;

      try {
        const next = await rpcCall<NodeStatusMap>("common:getNodesLatestStatus");
        if (stopped) return;

        // 服务端异常时可能返回 null，此时保留上一次的数据而不是清空界面
        if (next && typeof next === "object") {
          commitStatus(next, Date.now());
        }
        setError(null);
      } catch (err) {
        if (!stopped) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        inFlight = false;
        if (!stopped) {
          setLoading(false);
          // 从响应结束后再计时；慢请求不会制造空转 tick 或紧挨着下一轮请求。
          scheduleNext();
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        // 切到别的标签页就停下：既省服务端资源，也省客户端电量
        clearTimer();
        clearStatusBatch();
        rpc2.pause();
      } else {
        // 回到前台立刻补一次，避免看到过期数字
        rpc2.resume();
        void fetchLatest();
      }
    };

    if (document.hidden) rpc2.pause();
    else void fetchLatest();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      clearTimer();
      clearStatusBatch();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const value = useMemo(
    () => ({ status, updatedAt, loading, error }),
    [status, updatedAt, loading, error],
  );

  return (
    <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>
  );
}
