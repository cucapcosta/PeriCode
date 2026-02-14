import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    conditions: ["node"],
    mainFields: ["module", "jsnext:main", "jsnext"],
  },
  define: {
    __CI_BUILD__: JSON.stringify(!!process.env.CI_BUILD),
  },
  build: {
    rollupOptions: {
      external: ["better-sqlite3", "simple-git", "sql.js"],
    },
  },
});
