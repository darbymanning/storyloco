<script lang="ts">
	import { Button, Input, Label } from 'shared'
	import { GripVerticalIcon, PlusIcon, Settings2Icon, TrashIcon } from '@lucide/svelte'
	import { slide } from 'svelte/transition'
	import { useDragAndDrop as dnd } from 'fluid-dnd/svelte'
	import { cn } from 'shared/utils'
	import { DatesManager, blank } from './app.svelte.js'
	import TimezonePicker from './timezone_picker.svelte'
	import { describe } from './timezones.js'

	const manager = new DatesManager()
	let settings_open = $state(false)
	const zone = $derived(describe(manager.timezone))
	const [sortable, insert] = dnd(manager.entries, {
		onDragEnd: manager.update,
		handlerSelector: '.handle',
		// without a handle fluid-dnd drags by the whole row, so switch it off when sorting is automatic
		isDraggable: () => !manager.auto_sort,
	})

	const icon_button =
		'size-9 shrink-0 rounded-full flex items-center justify-center transition-colors outline-none'
</script>

<div class="grid gap-2">
	{#if !manager.entries.length}
		<p
			class="rounded-md border border-dashed border-input p-4 text-center text-sm text-muted-foreground"
		>
			No dates added.
		</p>
	{/if}
	<!-- stays mounted when empty: drag and drop is bound to it -->
	<div
		class="border border-input rounded-md divide-y divide-input"
		class:hidden={!manager.entries.length}
		use:sortable
	>
		{#each manager.entries as entry, index (entry.id)}
			{@const invalid = manager.is_invalid(entry)}
			<div
				class={cn('group grid items-center gap-2 p-2', {
					'grid-cols-[auto_1fr_auto]': !manager.auto_sort,
					'grid-cols-[1fr_auto]': manager.auto_sort,
				})}
				data-index={index}
				out:slide={{ duration: 200 }}
				onfocusout={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node)) manager.settle()
				}}
			>
				{#if !manager.auto_sort}
					<button
						class="handle {icon_button} cursor-grab"
						aria-label="Drag to reorder"
						title="Drag to reorder"
					>
						<GripVerticalIcon
							class="size-4 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
						/>
					</button>
				{/if}

				<div class="grid grid-cols-[2.5rem_1fr_7rem] items-center gap-2">
					<Label for="start_date_{entry.id}">Start</Label>
					<Input
						id="start_date_{entry.id}"
						type="date"
						bind:value={entry.start_date}
						oninput={manager.update}
					/>
					<Input
						type="time"
						step="60"
						aria-label="Start time (optional)"
						bind:value={entry.start_time}
						oninput={manager.update}
					/>

					<Label for="end_date_{entry.id}">End</Label>
					<Input
						id="end_date_{entry.id}"
						type="date"
						min={entry.start_date || undefined}
						aria-invalid={invalid || undefined}
						bind:value={entry.end_date}
						oninput={manager.update}
					/>
					<Input
						type="time"
						step="60"
						aria-label="End time (optional)"
						title={entry.start_time ? undefined : 'Add a start time first'}
						disabled={!entry.start_time}
						aria-invalid={invalid || undefined}
						bind:value={entry.end_time}
						oninput={manager.update}
					/>
					{#if invalid}
						<p class="col-start-2 col-span-2 text-xs text-destructive">Ends before it starts</p>
					{/if}
				</div>

				<button
					class={cn(
						icon_button,
						'hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive',
						{ 'invisible pointer-events-none': !manager.can_remove }
					)}
					disabled={!manager.can_remove}
					aria-label="Remove date"
					title="Remove date"
					onclick={() => {
						// not dnd's remove: it splices after a 200ms animation, so the save would miss it
						manager.entries.splice(index, 1)
						manager.update()
					}}
				>
					<TrashIcon
						class="size-4 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
					/>
				</button>
			</div>
		{/each}
	</div>

	<!-- no gap here: the panel spaces itself with mt-2, which slide can animate; a parent gap would snap -->
	<div>
		<div class="flex items-center gap-2">
			{#if manager.can_add}
				<Button
					variant="ghost"
					class="text-teal-muted hover:text-teal-muted"
					onclick={() => insert(manager.entries.length, blank())}
				>
					<PlusIcon class="size-4" />
					Add date
				</Button>
			{:else if manager.max > 1}
				<!-- a single-date field needs no explaining -->
				<p class="px-3 text-xs text-muted-foreground">Maximum of {manager.max} dates</p>
			{/if}

			<!-- the zone stays visible: every time above is read in it -->
			<span class="ml-auto truncate text-xs text-muted-foreground">
				{zone.flag}
				{zone.city} · {zone.abbr || zone.offset}
			</span>
			<button
				class="{icon_button} hover:bg-muted/50 focus-visible:bg-muted/50"
				aria-label="Date settings"
				title="Date settings"
				aria-expanded={settings_open}
				aria-controls="date-settings"
				onclick={() => (settings_open = !settings_open)}
			>
				<Settings2Icon class="size-4" />
			</button>
		</div>

		{#if settings_open}
			<section
				id="date-settings"
				class="mt-2 grid gap-2 rounded-md border border-input p-3"
				transition:slide
			>
				<Label>Timezone</Label>
				<TimezonePicker
					value={manager.timezone}
					onchange={manager.set_timezone}
					onclose={() => (settings_open = false)}
				/>
			</section>
		{/if}
	</div>
</div>
