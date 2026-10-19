import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { requestPersistence } from "./db/db";
import { syncConfigured } from "./sync/config";
import "./index.css";

void requestPersistence();

// Cloud sync is optional; its code (Supabase client) only loads when configured.
if (syncConfigured) void import("./sync/controller").then((m) => m.initSync());

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}

// Liquid-glass sheen: feed the pointer position to whichever glass surface is under it.
let sheenFrame = 0;
document.addEventListener(
  "pointermove",
  (e) => {
    if (e.pointerType === "touch" || sheenFrame) return;
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".glass");
    if (!el) return;
    sheenFrame = requestAnimationFrame(() => {
      sheenFrame = 0;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  },
  { passive: true },
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
