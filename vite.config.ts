/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_PORT = Number(process.env.KAASU_PROXY_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${PROXY_PORT}` },
  },
  preview: {
    port: 4173,
    proxy: { "/api": `http://127.0.0.1:${PROXY_PORT}` },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
