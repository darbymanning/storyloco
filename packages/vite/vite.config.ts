import devtools from "vite-plugin-devtools-json"
import adapter from "@sveltejs/adapter-auto"
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import schema from "./src/lib/schema/plugin.js"
import redirects from "./src/lib/redirects/plugin.js"

export interface StoryblokCustomPlugins {
	"mux-video": { foo: "bar" }
	"heading-field": { foo: "bar" }
}

export default defineConfig({
	plugins: [
		sveltekit({ adapter: adapter(), preprocess: vitePreprocess() }),
		devtools(),
		schema(),
		redirects({ datasource: "301s" }),
	],
	// its dist imports a file without an extension, which only works bundled
	ssr: { noExternal: ["@storyblok/svelte"] },
})
