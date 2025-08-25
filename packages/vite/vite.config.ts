import devtools from "vite-plugin-devtools-json"
import { sveltekit } from "@sveltejs/kit/vite"
import { defineConfig } from "vite"
import storyblok_schema from "./src/lib/schema.plugin.js"

export interface StoryblokCustomPlugins {
	"mux-video": { foo: "bar" }
	"heading-field": { foo: "bar" }
}

export default defineConfig({
	plugins: [sveltekit(), devtools(), storyblok_schema()],
})
