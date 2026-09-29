<script lang="ts">
	// The asset field: the chosen files in the story, and in Storyblok's modal, the file browser or one file's
	// details. The link and SEO fields mount this with their own plugin to pick a file.
	import { Toaster } from 'shared'
	import { AssetManager, type Props } from './app.svelte.js'
	import Details from './details.svelte'
	import Field from './field.svelte'
	import Picker from './picker.svelte'

	const props: Props = $props()
	// svelte-ignore state_referenced_locally
	const manager = new AssetManager(props)
</script>

<Toaster />

{#if manager.loaded && !manager.configured}
	<div class="rounded-lg border border-input bg-card p-4 text-sm">
		<p class="font-medium">This field isn’t connected to storage yet</p>
		<p class="mt-1 text-muted-foreground">
			Open <strong>R2 Assets</strong> from the Apps menu in the Storyblok sidebar to set it up.
		</p>
	</div>
{:else if manager.screen === 'details' && manager.details}
	{#key manager.details.id}
		<Details {manager} asset={manager.details} />
	{/key}
{:else if manager.screen === 'picker'}
	<Picker {manager} />
{:else if manager.loaded}
	<Field {manager} />
{/if}

<style>
	:global([data-modal-open='true']) {
		&,
		& body,
		& #app {
			height: 100%;
		}
	}
</style>
