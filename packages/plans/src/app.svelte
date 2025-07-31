<script lang="ts">
	import { Accordion, Button, Card, Input, Label, Tabs } from 'shared'
	import type { Floor, Dimension, Type, UUID } from '../types.js'
	import { PlusIcon, TrashIcon, GripVerticalIcon } from '@lucide/svelte'
	import FloorPlanIcon from './floor_plan_icon.svelte'
	import { FloorPlanManager } from './app.svelte.js'
	import { useDragAndDrop as dnd } from 'fluid-dnd/svelte'

	const floor_plan_manager = new FloorPlanManager()
	const content = $derived(floor_plan_manager.content)
</script>

{#snippet Type(type: Type)}
	<div class="grid gap-2">
		<Label for="type-name">Type Name</Label>
		<Input
			id="type-name"
			bind:value={type.name}
			placeholder="Type Name"
			oninput={floor_plan_manager.update}
			required
		/>
	</div>
{/snippet}

{#snippet Floors(type: Type)}
	{@const [sortable] = dnd(type.floors, {
		onDragEnd: floor_plan_manager.update,
		direction: 'horizontal',
	})}
	<Tabs.Root
		value={content._active_floor}
		onValueChange={(v) => (content._active_floor = v as UUID)}
	>
		<Tabs.List class="relative">
			<div class="contents" use:sortable>
				{#each type.floors as floor, index (floor.id)}
					<Tabs.Trigger value={floor.id}>
						{#snippet child({ props })}
							<Button
								size="sm"
								data-index={index}
								{...props}
								class="data-[state=active]:bg-secondary-foreground/10 data-[state=active]:text-teal-muted"
								variant="ghost"
							>
								{floor.name}
							</Button>
						{/snippet}
					</Tabs.Trigger>
				{/each}
				<Button
					variant="ghost"
					class="left-[100%] absolute ml-1 text-teal-muted hover:text-teal-muted"
					size="sm"
					onclick={() => floor_plan_manager.add_floor(type.id)}
				>
					<PlusIcon class="size-4" />
					Add Floor
				</Button>
			</div>
		</Tabs.List>
		{#each type.floors as floor (floor.id)}
			<Tabs.Content value={floor.id}>
				<div class="grid gap-2">
					{@render Floor(floor)}
				</div>
			</Tabs.Content>
		{/each}
	</Tabs.Root>

	{#snippet Floor(floor: Floor)}
		<Card.Root>
			<Card.Content class="grid gap-6">
				<div class="grid gap-2">
					<Label for="floor-name">Floor Name</Label>
					<Input
						id="floor-name"
						bind:value={floor.name}
						placeholder="Floor Name"
						oninput={floor_plan_manager.update}
					/>
				</div>

				<Button
					class="flex h-auto gap-3 p-4"
					variant="outline"
					onclick={() => floor_plan_manager.add_plan({ type_id: type.id, floor_id: floor.id })}
				>
					{#if floor.plan}
						<figure class="grid justify-items-center gap-2">
							<img src={floor.plan.filename} alt={floor.name} class="max-h-40" />
							<figcaption class="text-muted-foreground text-xs">
								{floor.plan.alt || floor.plan.filename}
							</figcaption>
						</figure>
					{:else}
						<FloorPlanIcon class="size-8" />
						Add Plan
					{/if}
				</Button>

				{@render Dimensions()}

				{#if type.floors.length > 1}
					<Button
						class="justify-self-end"
						variant="destructive"
						onclick={() =>
							floor_plan_manager.delete_floor({ type_id: type.id, floor_id: floor.id })}
					>
						Delete Floor
					</Button>
				{/if}
			</Card.Content>
		</Card.Root>

		{#snippet Dimensions()}
			{@const [sortable] = dnd(floor.dimensions, {
				onDragEnd: floor_plan_manager.update,
				handlerSelector: '.handle',
			})}
			<Card.Root>
				<Card.Header>
					<Card.Title>Dimensions</Card.Title>
				</Card.Header>

				{#if floor.dimensions.length > 0}
					<Card.Content>
						<Accordion.Root type="multiple">
							<div use:sortable>
								{#each floor.dimensions as dimension, index (dimension.id)}
									<Accordion.Item value={dimension.id} data-index={index}>
										<div class="grid grid-cols-[auto_1fr] items-center gap-2 group">
											<GripVerticalIcon
												class="handle size-4 opacity-0 group-hover:opacity-100 transition-opacity"
											/>
											<Accordion.Trigger class="items-center">
												<div class="flex items-center gap-2 justify-between w-full">
													{dimension.name}
													<button
														class="size-9 hover:bg-destructive/10 hover:text-destructive transition-colors rounded-full flex items-center justify-center"
														onclick={() =>
															floor_plan_manager.delete_dimension({
																type_id: type.id,
																floor_id: floor.id,
																dimension_id: dimension.id,
															})}
													>
														<TrashIcon
															class="size-4 opacity-0 group-hover:opacity-100 transition-opacity"
														/>
													</button>
												</div>
											</Accordion.Trigger>
										</div>
										<Accordion.Content class="grid gap-6 py-6">
											{@render Dimension(dimension)}
										</Accordion.Content>
									</Accordion.Item>
								{/each}
							</div>
						</Accordion.Root>
					</Card.Content>

					{#snippet Dimension(dimension: Dimension)}
						<div class="grid gap-2 ml-8.5 mr-18">
							<Label for="name-{dimension.id}">Name</Label>
							<Input
								id="name-{dimension.id}"
								bind:value={dimension.name}
								placeholder="Name"
								oninput={floor_plan_manager.update}
							/>
						</div>

						<div class="grid gap-2">
							{@render Rooms(dimension)}
							<Button
								class="ml-8.5 mr-18"
								variant="outline"
								onclick={() =>
									floor_plan_manager.add_room({
										type_id: type.id,
										floor_id: floor.id,
										dimension_id: dimension.id,
									})}
							>
								<PlusIcon class="size-4" />
								Add Room
							</Button>
						</div>

						{#snippet Rooms(dimension: Dimension)}
							{@const [sortable] = dnd(dimension.rooms, {
								onDragEnd: floor_plan_manager.update,
								handlerSelector: '.handle',
							})}
							<table class="table-auto">
								<thead>
									<tr>
										<th></th>
										<th class="text-start p-1">Room Name</th>
										<th class="text-start p-1">Room Area (m)</th>
										<th class="text-start p-1">Room Area (ft)</th>
										<th></th>
									</tr>
								</thead>
								<tbody use:sortable>
									{#each dimension.rooms as room, index (room.id)}
										<tr class="group" data-index={index}>
											<td>
												<GripVerticalIcon
													class="handle size-4 opacity-0 group-hover:opacity-100 transition-opacity"
												/>
											</td>
											<td class="p-1">
												<Input
													bind:value={room.name}
													placeholder="Room Name"
													oninput={floor_plan_manager.update}
												/>
											</td>
											<td class="p-1">
												<Input
													bind:value={room.area_m}
													placeholder="Room Area (m)"
													oninput={floor_plan_manager.update}
												/>
											</td>
											<td class="p-1">
												<Input
													bind:value={room.area_ft}
													placeholder="Room Area (ft)"
													oninput={floor_plan_manager.update}
												/>
											</td>
											<td>
												<button
													class="size-9 hover:bg-destructive/10 hover:text-destructive transition-colors rounded-full flex items-center justify-center"
													onclick={() =>
														floor_plan_manager.delete_room({
															type_id: type.id,
															floor_id: floor.id,
															dimension_id: dimension.id,
															room_id: room.id,
														})}
												>
													<TrashIcon
														class="size-4 opacity-0 group-hover:opacity-100 transition-opacity"
													/>
												</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/snippet}
					{/snippet}
				{/if}

				<Card.Footer class="grid">
					<Button
						variant="outline"
						onclick={() =>
							floor_plan_manager.add_dimensions({
								type_id: type.id,
								floor_id: floor.id,
							})}
					>
						<PlusIcon class="size-4" />
						Add Dimension
					</Button>
				</Card.Footer>
			</Card.Root>
		{/snippet}
	{/snippet}
{/snippet}

{#snippet Modal()}
	{@const [sortable] = dnd(content.types, {
		onDragEnd: floor_plan_manager.update,
		handlerSelector: '.handle',
	})}

	<section class="grid gap-6 p-6">
		<h1 class="text-3xl font-semibold ml-4">Plans</h1>
		<Tabs.Root
			class="grid grid-cols-[230px_1fr] gap-12 min-h-screen"
			orientation="vertical"
			value={content._active_type}
			onValueChange={(value) => floor_plan_manager.reset(value)}
		>
			<Tabs.List class="grid gap-2 bg-transparent justify-stretch w-full">
				<div class="contents" use:sortable>
					{#each content.types as type, index (type.id)}
						<Tabs.Trigger value={type.id}>
							{#snippet child({ props })}
								<div
									class="grid grid-cols-[auto_1fr_auto] items-center gap-2 group"
									data-index={index}
								>
									<GripVerticalIcon
										class="handle size-4 opacity-0 group-hover:opacity-100 transition-opacity"
									/>
									<Button
										{...props}
										class="data-[state=active]:bg-secondary-foreground/10 data-[state=active]:text-teal-muted justify-start truncate"
										variant="ghost"
									>
										{type.name}
									</Button>
									<button
										onclick={() => floor_plan_manager.delete_type(type.id)}
										class="size-9 hover:bg-destructive/10 hover:text-destructive transition-colors rounded-full flex items-center justify-center"
									>
										<TrashIcon
											class="size-4 opacity-0 group-hover:opacity-100 transition-opacity"
										/>
									</button>
								</div>
							{/snippet}
						</Tabs.Trigger>
					{/each}
				</div>
				<Button
					variant="ghost"
					class="ml-1 text-teal-muted hover:text-teal-muted justify-start"
					onclick={floor_plan_manager.add_type}
				>
					<PlusIcon class="size-4" />
					Add Type
				</Button>
			</Tabs.List>
			{#each content.types as type (type.id)}
				<Tabs.Content value={type.id}>
					<div class="grid gap-6">
						{@render Type(type)}
						{@render Floors(type)}
					</div>
				</Tabs.Content>
			{/each}
		</Tabs.Root>
	</section>
{/snippet}

{#if floor_plan_manager.loaded}
	{#if floor_plan_manager.is_modal_open}
		{@render Modal()}
	{:else}
		<div class="grid gap-2">
			{#each content.types as type (type.id)}
				<Button variant="outline" onclick={() => floor_plan_manager.edit_type(type.id)}>
					{type.name}
				</Button>
			{/each}
			<Button class="w-full" onclick={floor_plan_manager.add_type}>Add Type</Button>
		</div>
	{/if}
{/if}
