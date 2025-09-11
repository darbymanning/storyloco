<script lang="ts">
	import { slide } from 'svelte/transition'
	import { Button, Checkbox, Input, Label, Switch, Textarea } from 'shared'
	import {
		TrashIcon,
		GripVerticalIcon,
		Settings2Icon,
		LockKeyhole,
		LockOpenIcon,
	} from '@lucide/svelte'
	import { InputManager } from './app.svelte.js'
	import { types_map } from '../types.js'
	import { useDragAndDrop as dnd } from 'fluid-dnd/svelte'
	import { cn } from 'shared/utils'

	const input = new InputManager()
	const content = $derived(input.content)
</script>

{#snippet Options()}
	<div class="grid gap-4">
		<div class="grid gap-2">
			<Label for="name">Name</Label>
			<fieldset class="relative">
				<Input
					disabled={!input.custom_name}
					bind:value={content.name}
					oninput={input.debounced_update}
					id="name"
				/><button
					class="absolute right-2 top-1/2 -translate-y-1/2 p-2"
					onclick={() => {
						input.custom_name = !input.custom_name
						if (!input.custom_name) {
							content.name = content.label
						}
						input.update_now()
					}}
				>
					{#if input.custom_name}
						<LockOpenIcon class="size-4" />
					{:else}
						<LockKeyhole class="size-4" />
					{/if}
				</button>
			</fieldset>
		</div>

		{#if input.can_have_value(content)}
			{@const type = content.type === 'hidden' ? 'text' : content.type}
			<div class="grid gap-2">
				<Label for="value">Value</Label>
				{#if type === 'textarea'}
					<Textarea bind:value={content.value} oninput={input.debounced_update} id="value" />
				{:else}
					<Input bind:value={content.value} oninput={input.debounced_update} {type} id="value" />
				{/if}
			</div>
		{/if}

		{#if input.can_have_placeholder(content)}
			<div class="grid gap-2">
				<Label for="placeholder">Placeholder</Label>
				{#if content.type === 'textarea'}
					<Textarea
						bind:value={content.placeholder}
						oninput={input.debounced_update}
						id="placeholder"
					/>
				{:else}
					<Input
						bind:value={content.placeholder}
						oninput={input.debounced_update}
						id="placeholder"
					/>
				{/if}
			</div>
		{/if}

		{#if content.type !== 'hidden'}
			<div class="grid gap-2">
				<Label for="description">Description/help text</Label>
				<Textarea
					bind:value={content.description}
					oninput={input.debounced_update}
					id="description"
				/>
			</div>
		{/if}

		{#if content.type === 'file'}
			<div class="grid gap-2">
				<Label for="accept">Accept</Label>
				<Input bind:value={content.accept} oninput={input.debounced_update} id="accept" />
				<small class="text-muted-foreground text-xs">
					<a
						href="https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept"
						target="_blank"
						>See https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept</a
					>
				</small>
			</div>
		{/if}

		{#if content.type === 'checkbox' && typeof content.at_least_one === 'boolean'}
			<fieldset class="flex gap-2 items-center">
				<Label for="at_least_one">Require at least one selection</Label>
				<Switch
					bind:checked={content.at_least_one}
					onCheckedChange={input.update_now}
					id="at_least_one"
				/>
			</fieldset>
		{/if}

		{#if input.can_be_multiple(content) || input.can_be_required(content) || input.can_be_disabled(content)}
			<div
				class="flex gap-4 gap-y-2 items-center [&>fieldset]:flex [&>fieldset]:gap-2 [&>fieldset]:items-center flex-wrap"
			>
				{#if input.can_be_required(content)}
					<fieldset>
						<Label for="required">Required</Label>
						<Switch
							bind:checked={content.required}
							onCheckedChange={input.update_now}
							id="required"
						/>
					</fieldset>
				{/if}

				{#if input.can_be_disabled(content)}
					<fieldset>
						<Label for="disabled">Disabled</Label>
						<Switch
							bind:checked={content.disabled}
							onCheckedChange={input.update_now}
							id="disabled"
						/>
					</fieldset>
				{/if}

				{#if input.can_be_multiple(content)}
					<fieldset>
						<Label for="multiple">Multiple</Label>
						<Switch
							bind:checked={content.multiple}
							onCheckedChange={() => {
								if (input.has_options(content)) {
									const first_selected = content.options.find((option) => option.selected)
									for (const option of content.options) {
										option.selected = option.value === first_selected?.value
									}
								}

								input.update_now()
							}}
							id="multiple"
						/>
					</fieldset>
				{/if}
			</div>
		{/if}

		{#if input.has_options(content)}
			{@const [sortable, insert, remove] = dnd(content.options as any, {
				onDragEnd: input.update_now,
				handlerSelector: '.handle',
			})}
			<div class="grid gap-2">
				<Label for="options">Options</Label>
				<div
					class="border border-input rounded-md divide-y divide-input bg-input-background"
					use:sortable
				>
					{#each content.options as option, index (option.id || index)}
						{@const options_open = option.id ? input.open_options.has(option.id) : false}
						<div
							class="group relative grid grid-cols-[auto_1fr_auto] items-center py-1.5"
							data-index={index}
						>
							<button
								class={cn('handle size-9 flex items-center justify-center', {
									'opacity-0 invisible pointer-events-none': content.options.length === 1,
								})}
							>
								<GripVerticalIcon
									class="size-4 opacity-0 group-hover:opacity-100 transition-opacity"
								/>
							</button>
							<Input
								class="border-transparent group-hover:border-input/50 focus:border-input px-2 h-10"
								bind:value={
									() => option.label,
									(value) => {
										option.label = value

										if (option.id && !input.unlocked_values.has(option.id)) {
											option.value = value
										}

										input.debounced_update()
									}
								}
								oninput={input.debounced_update}
							/>
							<div class="flex items-center gap-1 px-1">
								<button
									class="size-9 hover:bg-muted/50 focus-within:bg-muted/50 outline-none focus-within:ring-muted/30 focus-within:ring hover:text-foreground transition-colors rounded-full flex justify-center items-center"
									onclick={() => input.toggle_options(index)}
									title="Option settings"
									aria-label="Option settings"
								>
									<Settings2Icon
										class="size-4 opacity-0 group-hover:opacity-100 transition-opacity group-focus-within:opacity-100"
									/>
								</button>
								<button
									class={cn(
										'size-9 hover:bg-destructive/10 focus-within:bg-destructive/10 outline-none focus-within:ring-destructive/30 focus-within:text-destructive focus-within:ring hover:text-destructive transition-colors rounded-full flex justify-center items-center',
										{
											'opacity-0 invisible pointer-events-none': content.options.length === 1,
										}
									)}
									onclick={() => {
										remove(index)
										input.update_now()
									}}
								>
									<TrashIcon
										class="size-4 opacity-0 group-hover:opacity-100 transition-opacity group-focus-within:opacity-100"
									/>
								</button>
							</div>
							{#if options_open}
								<div class="col-span-full grid gap-4 p-3" transition:slide>
									{#if input.can_have_options(content)}
										<div class="grid">
											<Label class="text-xs" for="value_{index}">Value</Label>
											<fieldset class="relative">
												<Input
													disabled={!option.id || !input.unlocked_values.has(option.id)}
													bind:value={option.value}
													oninput={input.debounced_update}
													id="value_{index}"
												/>
												<button
													class="absolute right-2 top-1/2 -translate-y-1/2 p-2"
													onclick={() => {
														if (!('value' in option)) return

														option.value = option.label

														if (option.id) {
															if (input.unlocked_values.has(option.id)) {
																input.unlocked_values.delete(option.id)
															} else {
																input.unlocked_values.add(option.id)
															}
														}

														input.update_now()
													}}
													id="derive_name_{index}"
												>
													{#if option.id && input.unlocked_values.has(option.id)}
														<LockOpenIcon class="size-4" />
													{:else}
														<LockKeyhole class="size-4" />
													{/if}
												</button>
											</fieldset>
										</div>
									{/if}
									<div class="flex gap-4 flex-wrap">
										<div class="flex gap-1">
											<Label class="text-xs" for="disabled_{index}">Disabled</Label>
											<Switch
												bind:checked={option.disabled}
												onCheckedChange={input.update_now}
												id="disabled_{index}"
											/>
										</div>
										{#if content.type === 'checkbox'}
											<div class="flex gap-1">
												<Label class="text-xs" for="required_{index}">Required</Label>
												<Switch
													bind:checked={option.required}
													onCheckedChange={input.update_now}
													id="required_{index}"
												/>
											</div>
										{/if}
										<div class="flex gap-1">
											{#if content.type === 'checkbox' || content.type === 'radio'}
												<Label class="text-xs" for="checked_{index}">Checked</Label>
												<Checkbox
													bind:checked={option.checked}
													onCheckedChange={input.update_now}
													id="checked_{index}"
												/>
											{:else if content.type === 'select'}
												<Label class="text-xs" for="selected_{index}">Selected</Label>
												{#if content.multiple}
													<Checkbox
														bind:checked={option.selected}
														onCheckedChange={input.update_now}
														id="selected_{index}"
													/>
												{:else}
													<Switch
														bind:checked={option.selected}
														onCheckedChange={(checked) => {
															content.options.forEach((opt) => {
																opt.selected = opt.id === option.id ? checked : false
															})
															input.update_now()
														}}
														id="selected_{index}"
													/>
												{/if}
											{/if}
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				<Button onclick={() => input.add_option(insert)}>Add Option</Button>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet Main()}
	<div class="@container">
		<div class="grid gap-4 @xs:grid-cols-[1fr_auto]">
			<div class="grid gap-2">
				<Label for="label">Label</Label>
				<Input
					bind:value={content.label}
					oninput={() => {
						if (!input.custom_name) {
							content.name = content.label
						}
						input.debounced_update()
					}}
					id="label"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="type">Type</Label>
				<select
					class="rounded outline-none focus-visible:border-ring border-input border bg-input-background min-h-11.5"
					onchange={input.update_now}
					bind:value={content.type}
					id="type"
				>
					{#each types_map as [value, title]}
						<option {value}>{title}</option>
					{/each}
				</select>
			</div>
		</div>
	</div>
{/snippet}

<section class="grid p-4 rounded border border-input bg-input-background/50">
	<nav class="flex gap-3 mb-5">
		<button
			class="font-semibold transition-opacity not-disabled:opacity-50"
			disabled={!input.show_options}
			onclick={() => (input.show_options = false)}
		>
			Input
		</button>
		<button
			class="font-semibold transition-opacity not-disabled:opacity-50"
			disabled={input.show_options}
			onclick={() => (input.show_options = !input.show_options)}
		>
			Options
		</button>
	</nav>
	{#if input.show_options}
		{@render Options()}
	{:else}
		{@render Main()}
	{/if}
</section>
