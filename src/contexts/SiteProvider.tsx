import { useMemo } from "react";
import type { ReactNode } from "react";
import { useNodes, usePublicSettings } from "@/api/queries";
import { SiteContext } from "./site";

/**
 * 站点级静态数据：公开设置与节点列表。
 * 这些数据变动频率低（5 分钟刷新），与 2 秒轮询的实时状态分开，
 * 避免静态数据的重取引起卡片重渲染。
 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const settingsQuery = usePublicSettings();
  const nodesQuery = useNodes();

  const nodes = useMemo(() => {
    const list = nodesQuery.data ?? [];
    // weight 是管理员设定的排序权重，同权重时按名称，保证顺序稳定
    return [...list].sort(
      (a, b) => a.weight - b.weight || a.name.localeCompare(b.name),
    );
  }, [nodesQuery.data]);

  const value = useMemo(
    () => ({
      settings: settingsQuery.data,
      nodes,
      loading: nodesQuery.isLoading || settingsQuery.isLoading,
      error:
        (nodesQuery.error as Error | null) ??
        (settingsQuery.error as Error | null) ??
        null,
    }),
    [
      settingsQuery.data,
      settingsQuery.isLoading,
      settingsQuery.error,
      nodes,
      nodesQuery.isLoading,
      nodesQuery.error,
    ],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
