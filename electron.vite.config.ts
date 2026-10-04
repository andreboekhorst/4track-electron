import { resolve } from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import type { Plugin } from "vite"

/**
 * In dev, Vite appends a `?v=<hash>` query to files it serves from
 * node_modules. For the .svelte components inside 4track that breaks
 * vite-plugin-svelte's lookup of their compiled CSS ("failed to load virtual
 * css module" followed by PostCSS parse errors), so resolve them without it.
 */
function svelteNodeModulesWithoutVersionQuery(): Plugin {
  return {
    name: "svelte-node-modules-without-version-query",
    enforce: "pre",
    apply: "serve",
    async resolveId(source, importer, options) {
      if (!/\.svelte(\?|$)/.test(source)) return
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && /\/node_modules\/.*\.svelte\?v=\w+$/.test(resolved.id)) {
        return { ...resolved, id: resolved.id.replace(/\?v=\w+$/, "") }
      }
      return resolved
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
    plugins: [
      svelteNodeModulesWithoutVersionQuery(),
      svelte({ configFile: resolve(__dirname, "svelte.config.mjs") }),
    ],
    // 4track ships .svelte sources and `?url` asset imports, which esbuild's
    // pre-bundling can't handle; let the svelte plugin compile it instead.
    optimizeDeps: {
      exclude: ["4track"],
    },
  },
})
