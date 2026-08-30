import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { authPlugin } from "./server/viteAuthPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Render sets SUPABASE_URL / SUPABASE_ANON_KEY (no VITE_ prefix) for the Node server.
  // Fall back to those so the Vite build picks them up without duplicating env vars.
  const sbUrl  = env.VITE_SUPABASE_URL  || env.SUPABASE_URL  || "";
  const sbAnon = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";
  return {
    plugins: [react(), authPlugin(env)],
    optimizeDeps: { exclude: ["pdfjs-dist"] },
    worker: { format: "es" },
    define: {
      "import.meta.env.VITE_SUPABASE_URL":      JSON.stringify(sbUrl),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(sbAnon),
    },
  };
});
