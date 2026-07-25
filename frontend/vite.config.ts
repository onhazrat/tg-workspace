import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

// Load VITE_* from the monorepo root `.env` (same file as the backend).
const envDir = path.resolve(__dirname, "..")

export default defineConfig(({ mode }) => {
  // Prefix "" loads every key (not just VITE_*), and process.env wins over the
  // file — that's how the Docker build arg reaches us, since the image never
  // copies the root `.env`.
  const env = loadEnv(mode, envDir, "")
  const deployEnvironment = env.VITE_ENVIRONMENT || env.ENVIRONMENT || ""

  // Sourcemaps make staging debuggable (React DevTools resolves minified
  // components back to real file:line), but they publish full source to anyone
  // who can load the app. Fail closed: only an explicit "staging" turns them on,
  // so a missing or misspelled value ships production without them.
  const emitSourcemap = deployEnvironment === "staging"

  return {
    envDir,
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: emitSourcemap,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target:
            process.env.PLAYWRIGHT_API_URL ||
            process.env.VITE_API_URL ||
            "http://localhost:8000",
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== "true",
    },
  }
})
