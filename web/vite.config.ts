import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { authPlugin } from "./server/viteAuthPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Render uses SUPABASE_URL / SUPABASE_ANON_KEY (no VITE_ prefix) for the Node server.
  // Expose them to the client bundle via custom globals to avoid conflicts with
  // Vite's own import.meta.env handling (which only auto-exposes VITE_* vars).
  const sbUrl  = env.VITE_SUPABASE_URL  || env.SUPABASE_URL  || "";
  const sbAnon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
  return {
    plugins: [react(), authPlugin(env)],
    optimizeDeps: { exclude: ["pdfjs-dist"] },
    worker: { format: "es" },
    define: {
      __SB_URL__:  JSON.stringify(sbUrl),
      __SB_ANON__: JSON.stringify(sbAnon),
    },
  };
});
