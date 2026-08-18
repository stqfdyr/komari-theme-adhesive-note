import { useQuery } from "@tanstack/react-query";
import { rpcCall } from "@/lib/rpc2";
import type {
  KomariNode,
  LoadRecordsResp,
  LoadType,
  PingRecordsResp,
  PublicSettings,
  RecentReport,
} from "./types";

/** 静态数据的刷新间隔：节点增删、站点设置变更不需要秒级同步 */
const STATIC_REFRESH = 5 * 60_000;

export const queryKeys = {
  nodes: ["nodes"] as const,
  settings: ["settings"] as const,
  recentRecords: (uuid: string) => ["recent-records", uuid] as const,
  records: (uuid: string, loadType: LoadType, hours: number) =>
    ["records", uuid, loadType, hours] as const,
  pingRecords: (uuid: string, hours: number) =>
    ["ping-records", uuid, hours] as const,
};

/** 节点静态信息 */
export function useNodes() {
  return useQuery({
    queryKey: queryKeys.nodes,
    queryFn: () => rpcCall<KomariNode[]>("public:getNodesInformation"),
    refetchInterval: STATIC_REFRESH,
    staleTime: 60_000,
  });
}

/** 站点公开设置 */
export function usePublicSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => rpcCall<PublicSettings>("public:getPublicSettings"),
    refetchInterval: STATIC_REFRESH,
    staleTime: 60_000,
  });
}

/** 系统图“实时”模式的短时原始采样；后续点由全局实时轮询在页面内追加。 */
export function useRecentRecords(uuid: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recentRecords(uuid ?? ""),
    queryFn: () =>
      rpcCall<RecentReport[]>("public:getClientRecentRecords", { uuid }),
    enabled: Boolean(uuid) && enabled,
    staleTime: 0,
  });
}

/** 节点历史负载记录（详情页图表） */
export function useLoadRecords(
  uuid: string | undefined,
  loadType: LoadType,
  hours: number,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.records(uuid ?? "", loadType, hours),
    queryFn: () =>
      rpcCall<LoadRecordsResp>("public:getRecordsByUUID", {
        uuid,
        load_type: loadType,
        hours: String(hours),
      }),
    enabled: Boolean(uuid) && enabled,
    // 同一节点首次切换时间窗时保留旧画布，避免数据暂时清空造成整卡跳变；
    // UUID 改变时绝不沿用上一台节点的数据。
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === uuid ? previousData : undefined,
    // 历史窗口越长，越不需要频繁刷新
    refetchInterval: hours <= 1 ? 60_000 : 5 * 60_000,
  });
}

/** 节点 Ping 历史（详情页图表） */
export function usePingRecords(
  uuid: string | undefined,
  hours: number,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.pingRecords(uuid ?? "", hours),
    queryFn: () =>
      rpcCall<PingRecordsResp>("public:getPingRecords", {
        uuid,
        hours: String(hours),
      }),
    enabled: Boolean(uuid) && enabled,
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === uuid ? previousData : undefined,
    refetchInterval: 60_000,
  });
}
