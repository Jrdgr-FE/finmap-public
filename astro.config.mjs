// @ts-check
import { defineConfig } from "astro/config";

// Astro generates static pages; a narrow Pages Function caches the public monitoring snapshot.
export default defineConfig({
  site: "https://map.finhot.fun",
  output: "static",
  // Preserve HTML-aware whitespace when moving to Astro 7's compiler.
  compressHTML: true,
  build: {
    format: "directory",
  },
  devToolbar: { enabled: false },
  vite: {
    server: {
      proxy: {
        "/api/monitor": {
          target: "https://monitor.example.com",
          changeOrigin: true,
          rewrite: (input) => {
            const params = new URL(input, "http://localhost").searchParams;
            const c = params.get("company");
            return c && /^[a-z0-9-]{1,100}$/.test(c)
              ? `/finmap/company/${c}.json`
              : params.get("view") === "directory"
                ? "/finmap/directory.json"
                : "/finmap/monitor.json";
          },
        },
      },
    },
  },
});
