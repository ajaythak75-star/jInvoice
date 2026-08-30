import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { authPlugin } from "./server/viteAuthPlugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Render sets SUPABASE_URL / SUPABASE_ANON_KEY (no VITE_ prefix) for the Node server.
  // Copy them as VITE_* so Vite embeds them in the client bundle at build time.
  if (!process.env.VITE_SUPABASE_URL && env.SUPABASE_URL)
    process.env.VITE_SUPABASE_URL = env.SUPABASE_URL;
  if (!process.env.VITE_SUPABASE_ANON_KEY && env.SUPABASE_ANON_KEY)
    process.env.VITE_SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;
  return {
    plugins: [react(), authPlugin(env)],
    optimizeDeps: { exclude: ["pdfjs-dist"] },
    worker: { format: "es" },
  };
});
