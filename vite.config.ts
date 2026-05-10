import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // base נקבע לפי משתנה סביבה: ב-GitHub Actions נגדיר DEPLOY_TARGET=gh-pages
  // כך שב-Lovable preview/publish ה-base יישאר "/" והנכסים ייטענו כראוי.
  base:
    process.env.DEPLOY_TARGET === "gh-pages"
      ? "/doona-receipt-return-ai/"
      : "/",

  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
  }
}));