<script lang="ts">
	import type { HubspotForm } from '../types.js'
	import { HubspotFormManager } from './app.svelte.js'
	import FormList from './form_list.svelte'
	import ChevronDown from '@lucide/svelte/icons/chevron-down'
	import X from '@lucide/svelte/icons/x'

	const manager = new HubspotFormManager()

	let picking = $state(false)

	function choose(form: HubspotForm | null) {
		manager.select(form)
		picking = false
	}
</script>

<!-- Inline, in-flow UI only: the plugin iframe sizes to the document, and
	popovers/top-layer pickers would clip at the iframe edge. -->
{#if manager.missing_options}
	<div class="rounded-lg border border-input bg-card p-4 text-sm">
		<p class="font-medium">This field isn’t connected to HubSpot yet</p>
		<p class="text-muted-foreground mt-1">
			Open <strong>HubSpot</strong> from the Apps menu in the Storyblok sidebar to set it up.
		</p>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-2">
		<div
			class="relative flex h-11.5 items-center gap-2 rounded-lg border bg-input-background px-3 text-sm transition-colors hover:border-primary {picking
				? 'border-ring'
				: 'border-input'}"
		>
			<button
				type="button"
				class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-left outline-none"
				aria-expanded={picking}
				onclick={() => (picking = !picking)}
			>
				{#if manager.content}
					<!-- the whole name shows in the list, scrolled to it: this frame has no room for a tooltip -->
					<span class="min-w-0 flex-1 truncate">{manager.content.name}</span>
				{:else}
					<span class="flex-1 text-muted-foreground">
						{manager.hubspot.loading ? 'Loading forms…' : 'Select a form…'}
					</span>
				{/if}
				<ChevronDown
					class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {picking
						? 'rotate-180'
						: ''}"
				/>
			</button>
			{#if manager.content}
				<button
					type="button"
					class="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					aria-label="Clear selection"
					onclick={() => choose(null)}
				>
					<X class="size-4" />
				</button>
			{/if}
		</div>
		{#if picking}
			<FormList
				hubspot={manager.hubspot}
				value={manager.content}
				onchoose={choose}
				onclose={() => (picking = false)}
			/>
		{:else if manager.hubspot.error}
			<p class="text-sm text-destructive">{manager.hubspot.error}</p>
		{/if}
	</div>
{/if}
