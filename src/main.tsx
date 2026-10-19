import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { requestPersistence } from "./db/db";
import "./index.css";

void requestPersistence();

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
