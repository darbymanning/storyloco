<script lang="ts">
	import { CategoriesManager } from './app.svelte.js'
	import Check from '@lucide/svelte/icons/check'
	import ChevronDown from '@lucide/svelte/icons/chevron-down'
	import X from '@lucide/svelte/icons/x'

	const manager = new CategoriesManager()

	let query = $state('')
	let picking = $state(false)
	let filter_element = $state<HTMLInputElement>()

	const by_id = $derived(new Map(manager.categories?.map((category) => [category.id, category])))
	const chosen = $derived(manager.selected.map((id) => by_id.get(id)?.name ?? `#${id}`))
	// keep saved ids ChurchSuite has since dropped in the list, so they can be unticked
	const removed = $derived(
		manager.categories
			? manager.selected
					.filter((id) => !by_id.has(id))
					.map((id) => ({ id, name: `Removed category #${id}`, colour: undefined }))
			: []
	)
	const filtered = $derived(
		[...removed, ...(manager.categories ?? [])].filter((category) =>
			category.name.toLowerCase().includes(query.trim().toLowerCase())
		)
	)

	function toggle() {
		picking = !picking
		query = ''
		if (picking) requestAnimationFrame(() => filter_element?.focus())
	}
</script>

<!-- Inline, in-flow UI only: the plugin iframe sizes to the document, and
	popovers/top-layer pickers would clip at the iframe edge. -->
{#if manager.missing_options}
	<div class="rounded border border-input bg-card p-4 text-sm">
		<p class="font-medium">This field doesn’t know where to load categories from</p>
		<p class="text-muted-foreground mt-1">
			Set the <code>endpoint</code> option to the site’s ChurchSuite categories URL.
		</p>
	</div>
{:else}
	<div class="grid gap-2">
		<div
			class="flex min-h-11.5 min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-input-background px-3 text-sm"
		>
			<button
				type="button"
				class="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 self-stretch text-left"
				aria-expanded={picking}
				onclick={toggle}
			>
				{#if chosen.length}
					<span class="min-w-0 truncate" title={chosen.join(', ')}>
						<span class="font-medium">{chosen.length}</span>
						<span class="text-muted-foreground">·</span>
						{chosen.join(', ')}
					</span>
				{:else}
					<span class="text-muted-foreground">
						{manager.loading ? 'Loading categories…' : 'All categories'}
					</span>
				{/if}
				<ChevronDown
					class="text-muted-foreground size-4 shrink-0 transition-transform {picking
						? 'rotate-180'
						: ''}"
				/>
			</button>
			{#if chosen.length}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
					aria-label="Clear categories"
					onclick={() => manager.set([])}
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
				placeholder={manager.loading
					? 'Loading categories…'
					: `Filter ${manager.categories?.length ?? 0} categories…`}
				aria-label="Filter categories"
				disabled={manager.loading}
			/>
			{#if manager.categories?.length}
				<div
					class="grid max-h-64 gap-0.5 overflow-x-hidden overflow-y-auto rounded-lg border border-input p-1"
					role="listbox"
					aria-label="Categories"
					aria-multiselectable="true"
				>
					{#each filtered as category (category.id)}
						{@const selected = manager.selected.includes(category.id)}
						<button
							type="button"
							role="option"
							aria-selected={selected}
							class="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground {selected
								? 'bg-accent text-accent-foreground'
								: ''}"
							onclick={() => manager.toggle(category.id)}
						>
							<span
								class="size-2.5 shrink-0 rounded-full border border-input"
								style:background-color={category.colour}
							></span>
							<span class="flex-1 truncate" title={category.name}>{category.name}</span>
							{#if selected}
								<Check class="text-primary size-4 shrink-0" />
							{/if}
						</button>
					{:else}
						<p class="text-muted-foreground p-2 text-sm">No categories match “{query}”</p>
					{/each}
				</div>
			{/if}
		{/if}
		{#if manager.error}
			<p class="text-sm text-destructive">{manager.error}</p>
		{/if}
	</div>
{/if}
