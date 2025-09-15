<script lang="ts">
	import { Input, Label } from 'shared'
	import { TicketSourceManager } from './app.svelte.js'

	const ticketsource = new TicketSourceManager()
</script>

<div class="grid gap-2">
	<select
		class="rounded outline-none focus-visible:border-ring border-input border bg-input-background min-h-11.5 w-full disabled:opacity-50 disabled:cursor-wait"
		bind:value={ticketsource.content.event}
		onchange={ticketsource.setup_event}
		disabled={ticketsource.loading}
	>
		<option value="">{ticketsource.loading ? 'Loading events…' : 'Select an event…'}</option>
		{#if ticketsource.events?.length}
			<optgroup label="Events">
				{#each ticketsource.events as event (event.id)}
					{#if !event.attributes.archived && event.attributes.activated}
						<option value={event.id}>
							{@html event.attributes.name}
							{#if event.count && event.count > 1}
								({event.count} dates)
							{/if}
						</option>
					{/if}
				{/each}
			</optgroup>
		{/if}
	</select>
	{#if ticketsource.content.dates?.length}
		<div class="grid gap-2" role="group">
			{#each ticketsource.content.dates as date (date.id)}
				<legend class="text-lg">
					{date.start}
				</legend>
				<div class="grid gap-2">
					<Label for="price_{date.id}">Price</Label>
					<Input id="price_{date.id}" bind:value={date.price} oninput={ticketsource.update} />
				</div>
			{/each}
		</div>
	{/if}
</div>
