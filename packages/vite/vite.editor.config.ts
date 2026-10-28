import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { defineConfig } from "vite"

/*
 * The editor app on its own, Svelte and all, for moxy to serve: an ES module per chunk, the badge
 * first and the overlay, settings, rich text and Page history as they're asked for. Its styles go
 * in with its components, since no site's bundler sees them
 */
export default defineConfig({
	plugins: [
		svelte({
			configFile: false,
			preprocess: vitePreprocess(),
			compilerOptions: { css: "injected" },
		}),
	],
	build: {
		outDir: "dist-editor",
		emptyOutDir: true,
		target: "es2022",
		lib: {
			entry: "src/lib/editor/app.svelte.ts",
			formats: ["es"],
			fileName: "app",
		},
		rolldownOptions: {
			output: { chunkFileNames: "[name]-[hash].js" },
		},
	},
})
