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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
