import { useCallback, useSyncExternalStore } from "react";

/**
 * 订阅一条媒体查询。
 *
 * 用 useSyncExternalStore 而不是 useState + effect：首帧就要拿到正确的值，
 * 走 effect 的话首帧会先按默认值渲染一次再纠正，卡片墙在窄屏上会先闪一下
 * 宽屏的样子。服务端快照恒为 false，本主题不做 SSR。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia?.(query);
      if (!list) return () => {};
      if (typeof list.addEventListener === "function") {
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
      }
      // Safari 13 等旧 WebView 只有已废弃的 addListener
      list.addListener(onChange);
      return () => list.removeListener(onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
