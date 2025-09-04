<script lang="ts">
	import { Button, Checkbox, Input, Label, Switch, Textarea } from 'shared'
	import { TrashIcon, GripVerticalIcon } from '@lucide/svelte'
	import { InputManager } from './app.svelte.js'
	import { types_map } from '../types.js'
	import { useDragAndDrop as dnd } from 'fluid-dnd/svelte'
	import { cn } from 'shared/utils'

	const input = new InputManager()
	const content = $derived(input.content)
</script>

{#snippet Options()}
	<div class="grid gap-4">
		{#if input.can_have_value(content)}
			{@const type = content.type === 'hidden' ? 'text' : content.type}
			<div class="grid gap-2">
				<Label for="value">Value</Label>
				{#if type === 'textarea'}
					<Textarea bind:value={content.value} oninput={input.update} id="value" />
				{:else}
					<Input bind:value={content.value} oninput={input.update} {type} id="value" />
				{/if}
			</div>
		{/if}

		{#if input.can_have_placeholder(content)}
			<div class="grid gap-2">
				<Label for="placeholder">Placeholder</Label>
				{#if content.type === 'textarea'}
					<Textarea bind:value={content.placeholder} oninput={input.update} id="placeholder" />
				{:else}
					<Input
						bind:value={content.placeholder}
						type={content.type}
						oninput={input.update}
						id="placeholder"
					/>
				{/if}
			</div>
		{/if}

		{#if content.type === 'file'}
			<div class="grid gap-2">
				<Label for="accept">Accept</Label>
				<Input bind:value={content.accept} oninput={input.update} id="accept" />
				<small class="text-muted-foreground text-xs">
					<a
						href="https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept"
						target="_blank"
						>See https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept</a
					>
				</small>
			</div>
		{/if}

		{#if input.can_be_multiple(content) || input.can_be_required(content) || input.can_be_disabled(content)}
			<div
				class="flex gap-4 gap-y-2 items-center [&>fieldset]:flex [&>fieldset]:gap-2 [&>fieldset]:items-center flex-wrap"
			>
				{#if input.can_be_required(content)}
					<fieldset>
						<Label for="required">Required</Label>
						<Switch bind:checked={content.required} onCheckedChange={input.update} id="required" />
					</fieldset>
				{/if}

				{#if input.can_be_disabled(content)}
					<fieldset>
						<Label for="disabled">Disabled</Label>
						<Switch bind:checked={content.disabled} onCheckedChange={input.update} id="disabled" />
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

									content.options = content.options.map((option) => ({
										...option,
										selected: option.value === first_selected?.value,
									}))
								}

								input.update()
							}}
							id="multiple"
						/>
					</fieldset>
				{/if}
			</div>
		{/if}

		{#if input.has_options(content)}
			{@const [sortable, insert, remove] = dnd(content.options, {
				onDragEnd: input.update,
				handlerSelector: '.handle',
			})}
			<div class="grid gap-2">
				<Label for="options">Options</Label>
				<div
					class="border border-input rounded-md divide-y divide-input bg-input-background"
					use:sortable
				>
					{#each content.options as _, index (index)}
						<div
							class="group relative grid grid-cols-[auto_1fr_auto] items-center py-1.5 gap-y-2"
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
								bind:value={content.options[index].value}
								oninput={input.update}
								id="options"
							/>
							<button
								class={cn(
									'size-9 hover:bg-destructive/10 focus-within:bg-destructive/10 outline-none focus-within:ring-destructive/30 focus-within:text-destructive focus-within:ring hover:text-destructive transition-colors rounded-full flex justify-center items-center mx-2',
									{
										'opacity-0 invisible pointer-events-none': content.options.length === 1,
									}
								)}
								onclick={() => {
									remove(index)
									input.update()
								}}
							>
								<TrashIcon
									class="size-4 opacity-0 group-hover:opacity-100 transition-opacity group-focus-within:opacity-100"
								/>
							</button>
							<fieldset
								class="col-start-2 flex items-center gap-4 [&>div]:flex [&>div]:gap-1 [&>div]:justify-items-center mr-2"
							>
								<div>
									<Label class="text-xs" for="disabled_{index}">Disabled</Label>
									<Switch
										bind:checked={content.options[index].disabled}
										onCheckedChange={input.update}
										id="disabled_{index}"
									/>
								</div>
								{#if content.type === 'checkbox'}
									<div>
										<Label class="text-xs" for="required_{index}">Required</Label>
										<Switch
											bind:checked={content.options[index].required}
											onCheckedChange={input.update}
											id="required_{index}"
										/>
									</div>
								{/if}
								<div>
									{#if content.type === 'checkbox' || content.type === 'radio'}
										<Label class="text-xs" for="checked_{index}">Checked</Label>
										<Checkbox
											bind:checked={content.options[index].checked}
											onCheckedChange={input.update}
											id="checked_{index}"
										/>
									{:else if content.type === 'select'}
										<Label class="text-xs" for="selected_{index}">Selected</Label>
										{#if content.multiple}
											<Checkbox
												bind:checked={content.options[index].selected}
												onCheckedChange={input.update}
												id="selected_{index}"
											/>
										{:else}
											<Switch
												bind:checked={content.options[index].selected}
												onCheckedChange={() => {
													content.options = content.options.map((option, i) => ({
														...option,
														selected: i === index,
													}))

													input.update()
												}}
												id="selected_{index}"
											/>
										{/if}
									{/if}
								</div>
							</fieldset>
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
				<Label for="name">Name</Label>
				<Input bind:value={content.name} oninput={input.update} id="name" />
			</div>
			<div class="grid gap-2">
				<Label for="type">Type</Label>
				<select
					class="rounded outline-none focus-visible:border-ring border-input border bg-input-background min-h-11.5"
					onchange={input.update}
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
