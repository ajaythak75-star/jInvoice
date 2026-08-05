// Set VITE_AUTH_BASE in .env to the deployed proxy URL before building the binary.
// Leave empty for dev (viteAuthPlugin handles routes locally).
export const AUTH_BASE = (import.meta.env.VITE_AUTH_BASE as string | undefined) ?? "";
