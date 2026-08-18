import { createContext, useContext } from "react";
import type { KomariNode, PublicSettings } from "@/api/types";

export interface SiteContextValue {
  settings: PublicSettings | undefined;
  nodes: KomariNode[];
  loading: boolean;
  error: Error | null;
}

export const SiteContext = createContext<SiteContextValue>({
  settings: undefined,
  nodes: [],
  loading: true,
  error: null,
});

export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}
