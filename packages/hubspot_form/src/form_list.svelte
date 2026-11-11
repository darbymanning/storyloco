<!--
	@component
	A HubSpot portal's forms to pick from, searched as you type and chosen by pointer or keys:
	the arrows move through them, Enter picks, Escape closes. In the page's flow rather than a
	popover, since a plugin's frame is only as tall as its content.
-->
<script lang="ts">
	import type { HubspotForm } from '../types.js'
	import type { HubspotForms } from './forms.svelte.js'
	import Check from '@lucide/svelte/icons/check'
	import Search from '@lucide/svelte/icons/search'
	import CircleAlert from '@lucide/svelte/icons/circle-alert'

	interface Props {
		hubspot: HubspotForms
		value: HubspotForm | null | undefined
		onchoose: (form: HubspotForm | null) => void
		/** Escape, to put the list away without choosing */
		onclose?: () => void
	}

	let { hubspot, value, onchoose, onclose }: Props = $props()

	const id = $props.id()
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

	// the chosen form starts highlighted, so Enter keeps it and the arrows go on from it; the
	// arrows and the pointer move it until the search or the choice changes
	let active = $derived.by(() => {
		const at = filtered.findIndex((form) => form.id === value?.id)
		return at === -1 ? 0 : at
	})

	function choose(form: HubspotForm) {
		onchoose(hubspot.pick(form.id) ?? form)
	}

	function move(by: number) {
		if (!filtered.length) return
		active = (active + by + filtered.length) % filtered.length
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') move(1)
		else if (event.key === 'ArrowUp') move(-1)
		else if (event.key === 'Enter' && filtered[active]) choose(filtered[active])
		else if (event.key === 'Escape') onclose?.()
		else return
		event.preventDefault()
	}
</script>

<div
	class="overflow-hidden rounded-lg border border-input bg-input-background shadow-sm animate-in fade-in-0 slide-in-from-top-1 duration-150"
>
	<label class="flex h-10 items-center gap-2 border-b border-input px-3">
		<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<input
			{@attach (input) => input.focus()}
			bind:value={query}
			onkeydown={keydown}
			class="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
			type="text"
			role="combobox"
			aria-expanded="true"
			aria-controls="{id}-forms"
			aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
			aria-label="Search forms"
			placeholder={hubspot.loading ? 'Loading forms…' : `Search ${forms.length} forms…`}
			autocomplete="off"
			spellcheck="false"
		/>
	</label>

	{#if hubspot.loading}
		<div class="grid gap-px p-1" aria-busy="true">
			{#each [72, 54, 64] as width (width)}
				<div class="flex h-9 items-center px-3">
					<div
						class="h-3 animate-pulse rounded bg-muted-foreground/20"
						style:width="{width}%"
					></div>
				</div>
			{/each}
		</div>
	{:else if hubspot.error}
		<p class="flex items-start gap-2 p-3 text-sm text-destructive">
			<CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			{hubspot.error}
		</p>
	{:else}
		<!-- the highlighted form in view: the chosen one on opening, then wherever the arrows go -->
		<div
			{@attach () =>
				document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })}
			id="{id}-forms"
			role="listbox"
			aria-label="Forms"
			class="grid max-h-72 gap-px overflow-y-auto overscroll-contain p-1"
		>
			{#each filtered as form, index (form.id)}
				{@const selected = value?.id === form.id}
				<button
					id="{id}-{index}"
					type="button"
					role="option"
					aria-selected={selected}
					tabindex="-1"
					class="flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors {index ===
					active
						? 'bg-accent text-accent-foreground'
						: ''} {selected ? 'font-medium text-primary' : ''}"
					onpointermove={() => (active = index)}
					onclick={() => choose(form)}
				>
					<span class="min-w-0 wrap-break-word">{form.name}</span>
					{#if selected}
						<Check class="size-4 shrink-0" aria-hidden="true" />
					{/if}
				</button>
			{:else}
				<p class="px-3 py-6 text-center text-sm text-muted-foreground">
					{forms.length ? `No forms match “${query.trim()}”` : 'This portal has no forms yet'}
				</p>
			{/each}
		</div>
	{/if}
</div>
