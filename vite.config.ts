/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PROXY_PORT = Number(process.env.KAASU_PROXY_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Also expose the two public variables Vercel's Supabase integration injects.
  // Deliberately narrow: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET and POSTGRES_* never reach the browser bundle.
  envPrefix: ["VITE_", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
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
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "supabase/**/*.test.ts"],
  },
});
