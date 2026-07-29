<script lang="ts">
	import { HubspotFormManager } from './app.svelte.js'
	import Check from '@lucide/svelte/icons/check'
	import ChevronDown from '@lucide/svelte/icons/chevron-down'
	import X from '@lucide/svelte/icons/x'

	const manager = new HubspotFormManager()

	let query = $state('')
	let picking = $state(false)
	let filter_element = $state<HTMLInputElement>()

	// keep the saved selection visible even if it has since been removed from
	// the portal (or the list failed to load)
	const orphaned = $derived(
		manager.content && !manager.forms?.some((form) => form.id === manager.content?.id)
			? manager.content
			: null
	)

	const forms = $derived([...(orphaned ? [orphaned] : []), ...(manager.forms ?? [])])
	const filtered = $derived(
		forms.filter((form) => form.name.toLowerCase().includes(query.trim().toLowerCase()))
	)

	function choose(id: string) {
		manager.select(id)
		picking = false
		query = ''
	}

	function toggle() {
		picking = !picking
		if (picking) requestAnimationFrame(() => filter_element?.focus())
	}
</script>

<!-- Inline, in-flow UI only: the plugin iframe sizes to the document, and
	popovers/top-layer pickers would clip at the iframe edge. -->
<div class="grid gap-2">
	<div
		class="flex min-h-11.5 items-center justify-between gap-2 rounded-lg border border-input bg-input-background px-3 text-sm"
	>
		<button
			type="button"
			class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 self-stretch text-left"
			aria-expanded={picking}
			onclick={toggle}
		>
			{#if manager.content}
				<span class="truncate" title={manager.content.name}>{manager.content.name}</span>
			{:else}
				<span class="text-muted-foreground">
					{manager.loading ? 'Loading forms…' : 'Select a form…'}
				</span>
			{/if}
			<ChevronDown
				class="text-muted-foreground size-4 shrink-0 transition-transform {picking
					? 'rotate-180'
					: ''}"
			/>
		</button>
		{#if manager.content}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
				aria-label="Clear selection"
				onclick={() => choose('')}
			>
				<X class="size-4" />
			</button>
		{/if}
	</div>
	{#if picking}
		<input
			bind:this={filter_element}
			bind:value={query}
			class="min-h-11.5 w-full rounded-lg outline-none focus:border-ring border-input border bg-input-background px-3 text-sm disabled:opacity-50 disabled:cursor-wait"
			type="text"
			placeholder={manager.loading ? 'Loading forms…' : `Filter ${forms.length} forms…`}
			aria-label="Filter forms"
			disabled={manager.loading}
		/>
		{#if !manager.loading && forms.length}
			<div
				class="grid max-h-64 gap-0.5 overflow-x-hidden overflow-y-auto rounded-lg border border-input p-1"
				role="listbox"
				aria-label="Forms"
			>
				{#each filtered as form (form.id)}
					{@const selected = manager.content?.id === form.id}
					<button
						type="button"
						role="option"
						aria-selected={selected}
						class="flex cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground {selected
							? 'bg-accent text-accent-foreground'
							: ''}"
						onclick={() => choose(form.id)}
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
	{/if}
	{#if manager.error}
		<p class="text-sm text-destructive">{manager.error}</p>
	{/if}
</div>
