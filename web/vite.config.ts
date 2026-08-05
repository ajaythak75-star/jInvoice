import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { authPlugin } from "./server/viteAuthPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), authPlugin(env)],
    optimizeDeps: { exclude: ["pdfjs-dist"] },
    worker: { format: "es" },
  };
});
