import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: { target: "es2023", sourcemap: false },
  optimizeDeps: { exclude: ["@thewindow/solana-sdk"] },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
