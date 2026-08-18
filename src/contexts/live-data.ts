import { createContext, useContext } from "react";
import type { NodeStatus, NodeStatusMap } from "@/api/types";

export interface LiveDataContextValue {
  /** 按 uuid 索引的最新状态；未变化的节点会复用上一次的对象引用 */
  status: NodeStatusMap;
  /** 上一次成功刷新的时间戳；0 表示尚未成功过 */
  updatedAt: number;
  loading: boolean;
  error: Error | null;
}

export const LiveDataContext = createContext<LiveDataContextValue>({
  status: {},
  updatedAt: 0,
  loading: true,
  error: null,
});

export function useLiveData(): LiveDataContextValue {
  return useContext(LiveDataContext);
}

/** 轮询间隔（毫秒）。官方主题同样是 2s。 */
export const LIVE_POLL_INTERVAL = 2_000;

/** 参与 diff 的标量字段——全部相等即可复用旧对象引用 */
const SCALAR_FIELDS = [
  "cpu",
  "gpu",
  "ram",
  "ram_total",
  "swap",
  "swap_total",
  "load",
  "load5",
  "load15",
  "temp",
  "disk",
  "disk_total",
  "net_in",
  "net_out",
  "net_total_up",
  "net_total_down",
  "process",
  "connections",
  "connections_udp",
  "online",
  "uptime",
] as const satisfies readonly (keyof NodeStatus)[];

/**
 * 判断两次采样是否完全一致。
 *
 * 有意**不比较 `time`**：agent 每次上报都会推进时间戳，但界面上并不展示它，
 * 若把它算进 diff，任何节点每 2 秒都会被判定为「已变化」，引用复用就完全失效了。
 */
export function sameStatus(a: NodeStatus, b: NodeStatus): boolean {
  if (a === b) return true;
  for (const field of SCALAR_FIELDS) {
    if (a[field] !== b[field]) return false;
  }
  return true;
}

/**
 * 合并新旧状态：逐节点 diff，未变化的沿用旧引用。
 * 若整体没有任何变化，直接返回旧 map，连父组件的 re-render 都省掉。
 */
export function mergeStatus(
  previous: NodeStatusMap,
  incoming: NodeStatusMap,
): NodeStatusMap {
  const merged: NodeStatusMap = {};
  let changed = false;

  for (const [uuid, next] of Object.entries(incoming)) {
    const prev = previous[uuid];
    if (prev && sameStatus(prev, next)) {
      merged[uuid] = prev;
    } else {
      merged[uuid] = next;
      changed = true;
    }
  }

  // 节点被删除时 key 数量会变少，这同样算变化
  if (!changed && Object.keys(previous).length !== Object.keys(merged).length) {
    changed = true;
  }

  return changed ? merged : previous;
}
