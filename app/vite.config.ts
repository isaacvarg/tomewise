import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const web = (path: string) => fileURLToPath(new URL(`./web/${path}`, import.meta.url));

export default defineConfig({
  root: web(""),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/", import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: { index: web("index.html"), styleguide: web("styleguide.tsx") },
    },
  },
});
