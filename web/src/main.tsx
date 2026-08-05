import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

// Register service worker for PWA install + offline shell on iOS/Android.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Ask the browser to persist IndexedDB so iOS doesn't evict it under storage
// pressure. Granted automatically when the PWA is installed to home screen.
if ("storage" in navigator && "persist" in navigator.storage) {
  navigator.storage.persist().catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
