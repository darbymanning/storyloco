<script lang="ts">
	import type { HubspotForm } from '../types.js'
	import type { HubspotForms } from './forms.svelte.js'
	import Check from '@lucide/svelte/icons/check'

	interface Props {
		hubspot: HubspotForms
		value: HubspotForm | null | undefined
		onchoose: (form: HubspotForm | null) => void
	}

	let { hubspot, value, onchoose }: Props = $props()

	let query = $state('')

	// keep the saved selection visible even if it has since been removed from
	// the portal (or the list failed to load)
	const orphaned = $derived(
		value && !hubspot.forms?.some((form) => form.id === value.id) ? value : null
	)

	const forms = $derived([...(orphaned ? [orphaned] : []), ...(hubspot.forms ?? [])])
	const filtered = $derived(
		forms.filter((form) => form.name.toLowerCase().includes(query.trim().toLowerCase()))
	)
</script>

<input
	{@attach (input) => input.focus()}
	bind:value={query}
	class="min-h-11.5 w-full rounded-lg outline-none focus:border-ring border-input border bg-input-background px-3 text-sm disabled:opacity-50 disabled:cursor-wait"
	type="text"
	placeholder={hubspot.loading ? 'Loading forms…' : `Filter ${forms.length} forms…`}
	aria-label="Filter forms"
	disabled={hubspot.loading}
/>
{#if !hubspot.loading && forms.length}
	<div
		class="grid max-h-64 gap-0.5 overflow-x-hidden overflow-y-auto rounded-lg border border-input p-1"
		role="listbox"
		aria-label="Forms"
	>
		{#each filtered as form (form.id)}
			{@const selected = value?.id === form.id}
			<button
				type="button"
				role="option"
				aria-selected={selected}
				class="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground {selected
					? 'bg-accent text-accent-foreground'
					: ''}"
				onclick={() => onchoose(hubspot.pick(form.id) ?? form)}
			>
				<span class="truncate" title={form.name}>{form.name}</span>
				{#if selected}
					<Check class="text-primary size-4 shrink-0" />
				{/if}
			</button>
		{:else}
			<p class="text-muted-foreground p-2 text-sm">No forms match “{query}”</p>
		{/each}
	</div>
{/if}
