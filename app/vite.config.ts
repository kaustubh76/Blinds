import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  build: {
    target: "es2023",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Only Market and Explorer draw charts; the shell, Desk and Positions never load recharts.
        codeSplitting: {
          groups: [
            {
              name: "recharts",
              test: /node_modules[\\/](recharts|d3-|victory-vendor|@reduxjs|redux|reselect|immer)/,
              priority: 30,
            },
            { name: "solana", test: /node_modules[\\/](@solana|@wallet-standard|@solana-program)/, priority: 20 },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|@tanstack)/, priority: 10 },
          ],
        },
      },
    },
  },
  optimizeDeps: { exclude: ["@thewindow/solana-sdk"] },
  test: {
    projects: [
      { extends: true, test: { name: "node", environment: "node", include: ["src/**/*.test.ts"] } },
      {
        extends: true,
        test: { name: "dom", environment: "jsdom", include: ["src/**/*.test.tsx"], setupFiles: ["src/test/setup.ts"] },
      },
    ],
  },
});
