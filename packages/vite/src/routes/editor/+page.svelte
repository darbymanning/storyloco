<script lang="ts">
	import { attrs, StoryblokClient } from "$lib/storyblok.svelte.js"
	import { EditBar } from "$lib/editor/index.js"

	let { data } = $props()

	const client = $derived(new StoryblokClient({ token: data.token }))
	const connected = $derived(client.connect(data.story))
	const story = $derived(connected.story ?? data.story)
</script>

<main {...attrs(story.content)}>
	{#each story.content.body as blok (blok._uid)}
		<section {...attrs(blok)}>
			<h2>{blok.bacon}</h2>
		</section>
	{/each}
</main>

<EditBar />
