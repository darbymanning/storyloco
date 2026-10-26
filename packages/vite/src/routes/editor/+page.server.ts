import { StoryblokClient } from "$lib/storyblok.svelte.js"
import type { ISbStoryData } from "@storyblok/svelte"

// A story to try in-place editing on: run with DEMO_STORYBLOK_TOKEN set to a space's preview token, and the
// Site Editor extension installed in that space
const token = process.env.DEMO_STORYBLOK_TOKEN ?? ""
new StoryblokClient({ token })

type Teaser = { _uid: string; component: "teaser"; bacon: string; _editable?: string }

export async function load({ fetch }) {
	const res = await fetch(
		`https://api.storyblok.com/v2/cdn/stories/editor-demo?version=draft&token=${token}&cv=${Date.now()}`
	)
	const { story } = (await res.json()) as {
		story: ISbStoryData<{ _uid: string; _editable?: string; body: Array<Teaser> }>
	}
	// the page connects the story in the browser too, as a site would
	return { story, token }
}
