import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

/** Komari 后端在本机的监听地址，dev 期间用真实数据开发 */
const KOMARI_ORIGIN = process.env.KOMARI_ORIGIN ?? "http://127.0.0.1:25774";

/**
 * 代理到真实后端。
 *
 * Komari 默认开启 CORS 校验，要求 Origin 与 Host 一致
 * （见后端 web/security/cors.go 的 OriginMatchesHost）。changeOrigin 只改 Host，
 * 浏览器发来的 Origin 仍是本地服务的地址，不重写就会被 403 掉——
 * HTTP 与 WebSocket 两条路都要改。
 */
const apiProxy: Record<string, ProxyOptions> = {
  "/api": {
    target: KOMARI_ORIGIN,
    changeOrigin: true,
    ws: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        proxyReq.setHeader("origin", KOMARI_ORIGIN);
      });
      proxy.on("proxyReqWs", (proxyReq) => {
        proxyReq.setHeader("origin", KOMARI_ORIGIN);
      });
    },
  },
};

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5273,
    proxy: apiProxy,
  },
  // 性能验收要在生产构建上做，preview 也得能连到真实后端
  preview: {
    host: "127.0.0.1",
    port: 5274,
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        // go embed 会忽略下划线开头的文件，Vite 默认可能产出 _xxx.js
        chunkFileNames: "assets/chunk-[name]-[hash].js",
        entryFileNames: "assets/entry-[name]-[hash].js",
        assetFileNames: "assets/asset-[name]-[hash][extname]",
      },
    },
  },
});
