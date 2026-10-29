import { defineConfig } from "vite";
import { execSync } from "node:child_process";

// Build id shown to players and compared between them, so everyone at a table runs the same code.
function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "dev"; }
}

// The import map in index.html is only for running the sources unbuilt; the build bundles everything.
const stripImportMap = {
  name: "strip-import-map",
  apply: "build",
  transformIndexHtml: html => html.replace(/<!-- Lets the source run[\s\S]*?<\/script>\n/, ""),
};

export default defineConfig({
  plugins: [stripImportMap],
  base: "./",
  define: {
    __BUILD__: JSON.stringify({ id: buildId(), t: Date.now() }),
  },
  build: {
    target: "es2020",
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    // libraries change rarely, so players keep them cached across game updates
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three/ },
            { name: "vendor", test: /node_modules/ },
          ],
        },
      },
    },
  },
});
