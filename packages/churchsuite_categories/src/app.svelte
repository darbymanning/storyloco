<script lang="ts">
	import { CategoriesManager } from './app.svelte.js'
	import Check from '@lucide/svelte/icons/check'
	import X from '@lucide/svelte/icons/x'

	const manager = new CategoriesManager()

	let query = $state('')

	const by_id = $derived(new Map(manager.categories?.map((category) => [category.id, category])))
	// keep saved ids visible even once ChurchSuite drops the category (or the list fails to load)
	const chosen = $derived(
		manager.selected.map(
			(id) =>
				by_id.get(id) ?? {
					id,
					name: manager.categories ? `Removed category #${id}` : `Category #${id}`,
					colour: undefined,
				}
		)
	)
	const filtered = $derived(
		(manager.categories ?? []).filter((category) =>
			category.name.toLowerCase().includes(query.trim().toLowerCase())
		)
	)
</script>

{#snippet swatch(colour?: string)}
	<span class="size-2.5 shrink-0 rounded-full border border-input" style:background-color={colour}
	></span>
{/snippet}

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
		{#if chosen.length}
			<div class="flex flex-wrap gap-1.5">
				{#each chosen as category (category.id)}
					<span
						class="flex items-center gap-1.5 rounded-full border border-input bg-input-background py-1 pr-1.5 pl-2.5 text-sm"
					>
						{@render swatch(category.colour)}
						{category.name}
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground cursor-pointer"
							aria-label="Remove {category.name}"
							onclick={() => manager.toggle(category.id)}
						>
							<X class="size-3.5" />
						</button>
					</span>
				{/each}
			</div>
		{:else}
			<p class="text-muted-foreground text-sm">No categories chosen, so every category shows.</p>
		{/if}
		<input
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
						{@render swatch(category.colour)}
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
		{#if manager.error}
			<p class="text-sm text-destructive">{manager.error}</p>
		{/if}
	</div>
{/if}
