import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LiveDataProvider } from "@/contexts/LiveDataProvider";
import { SiteProvider } from "@/contexts/SiteProvider";
import { Layout } from "@/components/shell/Layout";
import { IndexPage } from "@/pages/Index";
import { InstancePage } from "@/pages/Instance";
import { NotFoundPage } from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      // 站点数据本就在轮询，窗口聚焦时不必再额外重取一遍
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SiteProvider>
          <LiveDataProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<IndexPage />} />
                <Route path="/instance/:uuid" element={<InstancePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </LiveDataProvider>
        </SiteProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
