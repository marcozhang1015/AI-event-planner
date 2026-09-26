import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// 开发：bun run web:dev，打开 http://localhost:5173/sim 或 /o/<token>；/api 和模拟器的 WebSocket 转发给 Bun 服务（3000 端口）。
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/sim/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
