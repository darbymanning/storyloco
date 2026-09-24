<script lang="ts">
	import { Input } from 'shared'
	import { CheckIcon } from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import { describe, filter_zones, list_zones, type Zone } from './timezones.js'

	let {
		value,
		onchange,
		onclose,
	}: { value: string; onchange: (zone: string) => void; onclose: () => void } = $props()

	// built when the panel opens, so the times shown are current
	const zones = list_zones()
	const by_id = new Map(zones.map((zone) => [zone.id, zone]))
	const zone_for = (id: string) => by_id.get(id) ?? describe(id)
	const local = Intl.DateTimeFormat().resolvedOptions().timeZone

	let query = $state('')
	let active = $state(0)
	let list = $state<HTMLElement | null>(null)

	const suggested = $derived([...new Set([value, local, 'UTC'])].map(zone_for))
	// one flat list, so the arrow keys move through suggestions and results alike
	const options = $derived(query.trim() ? filter_zones(zones, query) : [...suggested, ...zones])

	const tag = (zone: Zone) =>
		zone.id === value ? 'Selected' : zone.id === local ? 'Your timezone' : ''

	const pick = (id: string) => {
		onchange(id)
		onclose()
	}

	const keydown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			const step = event.key === 'ArrowDown' ? 1 : -1
			active = (active + step + options.length) % options.length
			list?.querySelector(`#tz-option-${active}`)?.scrollIntoView({ block: 'nearest' })
		} else if (event.key === 'Enter' && options[active]) {
			event.preventDefault()
			pick(options[active].id)
		} else if (event.key === 'Escape') {
			onclose()
		}
	}
</script>

{#snippet Option(zone: Zone, index: number)}
	<!-- keys are handled on the search input (aria-activedescendant), options never take focus -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<li
		id="tz-option-{index}"
		role="option"
		aria-selected={zone.id === value}
		class={cn(
			'flex cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2',
			{
				'bg-muted': index === active,
				'border-teal-muted bg-teal-muted/10': zone.id === value,
			}
		)}
		onpointermove={() => (active = index)}
		onclick={() => pick(zone.id)}
	>
		<span class="text-lg leading-none" aria-hidden="true">{zone.flag}</span>
		<div class="grid min-w-0 grow">
			<span class="flex items-center gap-2 text-sm font-medium">
				{zone.city}
				{#if tag(zone)}
					<span
						class={cn('text-xs font-normal text-muted-foreground', {
							'text-teal-muted': zone.id === value,
						})}
					>
						{tag(zone)}
					</span>
				{/if}
			</span>
			<span class="truncate text-xs text-muted-foreground">
				{zone.country} · {zone.abbr ? `${zone.abbr} · ` : ''}{zone.offset}
			</span>
		</div>
		<span class="text-sm tabular-nums text-muted-foreground">{zone.time}</span>
		<CheckIcon class={cn('size-4 shrink-0 text-teal-muted', { invisible: zone.id !== value })} />
	</li>
{/snippet}

<div class="grid gap-2">
	<Input
		type="search"
		placeholder="Start typing a city, country or offset…"
		aria-label="Search timezones"
		role="combobox"
		aria-expanded="true"
		aria-controls="tz-list"
		aria-activedescendant="tz-option-{active}"
		autocomplete="off"
		autofocus
		bind:value={query}
		oninput={() => (active = 0)}
		onkeydown={keydown}
	/>

	<ul
		id="tz-list"
		role="listbox"
		aria-label="Timezones"
		class="max-h-72 overflow-y-auto rounded-md border border-input p-1"
		bind:this={list}
	>
		{#if query.trim()}
			{#each options as zone, index (zone.id)}
				{@render Option(zone, index)}
			{:else}
				<li class="px-3 py-2 text-sm text-muted-foreground">No matching timezones</li>
			{/each}
		{:else}
			<li role="presentation" class="px-3 pt-2 pb-1 text-xs text-muted-foreground">Suggested</li>
			{#each suggested as zone, index (zone.id)}
				{@render Option(zone, index)}
			{/each}
			<li role="presentation" class="px-3 pt-3 pb-1 text-xs text-muted-foreground">
				All timezones
			</li>
			{#each zones as zone, index (zone.id)}
				{@render Option(zone, suggested.length + index)}
			{/each}
		{/if}
	</ul>
</div>
