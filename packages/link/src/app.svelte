<script lang="ts">
	import { Clipped, Input, Label } from 'shared'
	import {
		target_options,
		type AssetLink,
		type EmailLink,
		type ExternalLink,
		type FormLink,
		type Link,
		type LinkType,
		type Rel,
		type StoryLink,
	} from '../types.js'
	import FormList from '../../hubspot_form/src/form_list.svelte'
	import StoryList from './story_list.svelte'
	import { looks_like_email } from './email.js'
	import { ChevronDownIcon, XIcon, CircleAlertIcon } from '@lucide/svelte'
	import PublishedIcon from './published.svelte'
	import DraftIcon from './draft.svelte'
	import { cn } from 'shared/utils'
	import { slide } from 'svelte/transition'
	import { LinkManager } from './app.svelte.js'
	import { AssetManager } from '../../asset/src/app.svelte.js'

	const manager = new LinkManager()

	// the form picker opens in place, under the field, rather than in Storyblok's modal
	let picking = $state(false)

	// an address is checked once the field's been left, then again as it's put right
	let email_left = $state(false)
	const email_wrong = $derived(
		manager.content.type === 'email' &&
			email_left &&
			!!manager.content.email?.trim() &&
			!looks_like_email(manager.content.email)
	)

	$effect(() => {
		if (manager.is_modal_open && manager.content.type === 'asset') actions.select_asset()
	})

	const actions = {
		async open_picker(): Promise<void> {
			if (!manager.plugin) return
			if (!manager.plugin.data?.isModalOpen) await manager.plugin.actions?.setModalOpen(true)
		},

		async select_asset(): Promise<void> {
			const asset = await AssetManager.select_asset(manager.plugin)
			if (!asset) return
			manager.select_asset(asset)
		},
	}
</script>

{#snippet StoryWithStatus(story: { name: string; published_at: string | null })}
	{@const StatusIcon = story.published_at ? PublishedIcon : DraftIcon}
	<span class="flex min-w-0 items-center gap-1">
		<StatusIcon
			class={cn([
				'size-[1.8em] shrink-0 text-muted-foreground',
				{ 'text-primary': story.published_at },
			])}
		/>
		<Clipped text={story.name} />
	</span>
{/snippet}

{#snippet Clear(label: string)}
	<button
		type="button"
		aria-label={label}
		title={label}
		class="-mr-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		onclick={() => {
			picking = false
			manager.clear()
		}}
	>
		<XIcon size={16} />
	</button>
{/snippet}

{#snippet StorySelect(content: StoryLink)}
	<button
		class={cn(
			'flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-start outline-none',
			{ 'text-muted-foreground': !content.story?.name }
		)}
		aria-expanded={picking}
		onclick={() => (picking = !picking)}
	>
		<span class="flex min-w-0 flex-1 items-center">
			{#if content.story?.name}
				{@render StoryWithStatus(content.story)}
			{:else}
				Select a story…
			{/if}
		</span>
		<ChevronDownIcon
			size={16}
			class={cn('shrink-0 text-muted-foreground transition-transform duration-200', {
				'rotate-180': picking,
			})}
		/>
	</button>
	{#if content.story?.name}
		{@render Clear('Unassign story')}
	{/if}
{/snippet}

{#snippet AssetSelect(content: AssetLink)}
	<button
		class={cn(
			'flex min-w-0 flex-1 cursor-pointer items-center self-stretch text-start outline-none',
			{
				'text-muted-foreground': !content.asset?.filename,
			}
		)}
		onclick={actions.open_picker}
	>
		{#if content.asset}
			<Clipped text={content.asset.name || content.asset.filename.split('/').pop() || ''} />
		{:else}
			Select an asset…
		{/if}
	</button>
	{#if content.asset}
		{@render Clear('Unassign asset')}
	{/if}
{/snippet}

{#snippet FormSelect(content: FormLink)}
	<button
		class={cn(
			'flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch text-start outline-none',
			{ 'text-muted-foreground': !content.form }
		)}
		aria-expanded={picking}
		onclick={() => (picking = !picking)}
	>
		{#if content.form}
			<Clipped text={content.form.name} class="flex-1" />
		{:else}
			<span class="flex-1">Select a form…</span>
		{/if}
		<ChevronDownIcon
			size={16}
			class={cn('shrink-0 text-muted-foreground transition-transform duration-200', {
				'rotate-180': picking,
			})}
		/>
	</button>
	{#if content.form}
		{@render Clear('Unassign form')}
	{/if}
{/snippet}

{#snippet TargetSelect(content: Exclude<Link, FormLink>)}
	<div class="grid gap-2">
		<Label for="target">Target</Label>
		<select
			bind:value={content.target}
			onchange={manager.update}
			id="target"
			class={cn(
				'rounded outline-none focus-visible:border-ring border-input bg-input-background border min-h-11.5 hover:border-primary transition-colors',
				{
					'text-muted-foreground': !content.target,
				}
			)}
		>
			<option disabled selected value={undefined}>Select target…</option>
			{#each target_options as target}
				<option value={target}>{manager.target_map.get(target)}</option>
			{/each}
		</select>
	</div>
{/snippet}

{#snippet ExternalInput(content: ExternalLink)}
	<input
		class="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
		bind:value={content.url}
		oninput={manager.update}
		placeholder="https://example.com"
		type="url"
	/>
{/snippet}

{#snippet EmailInput(content: EmailLink)}
	<input
		class="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
		bind:value={content.email}
		oninput={manager.update_email}
		onblur={() => (email_left = true)}
		placeholder="name@example.com"
		type="email"
		autocomplete="off"
		spellcheck="false"
		aria-invalid={email_wrong}
		aria-describedby={email_wrong ? 'email-wrong' : undefined}
	/>
	{#if email_wrong}
		<CircleAlertIcon size={16} class="shrink-0 text-destructive" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet Options()}
	<div class="grid gap-2">
		<Label for="text">Text</Label>
		<Input bind:value={manager.content.text} oninput={manager.update} id="text" />
	</div>
	{#if manager.content.type === 'internal'}
		<div class="grid gap-2">
			<Label for="suffix">Suffix</Label>
			<Input
				bind:value={
					() => manager.content.type === 'internal' && manager.content.suffix,
					(v) => manager.content.type === 'internal' && (manager.content.suffix = v || undefined)
				}
				oninput={manager.update}
				id="suffix"
				placeholder="e.g. ?search=value"
			/>
		</div>
		{@render TargetSelect(manager.content)}
	{:else if manager.content.type === 'asset' || manager.content.type === 'external'}
		{@render TargetSelect(manager.content)}
	{:else if manager.content.type === 'email'}
		<div class="grid gap-2">
			<Label for="subject">Subject</Label>
			<Input
				bind:value={manager.content.subject}
				oninput={manager.update_email}
				id="subject"
				placeholder="Subject to use on the email"
			/>
		</div>
		<div class="grid gap-2">
			<Label for="body">Body</Label>
			<textarea
				class="field-sizing-content min-h-28 max-h-80 w-full resize-y rounded-lg border border-input bg-input-background px-3 py-2.5 leading-relaxed outline-none transition-colors placeholder:text-muted-foreground hover:border-primary focus-visible:border-ring"
				rows="4"
				bind:value={manager.content.body}
				oninput={manager.update_email}
				id="body"
				placeholder="What the email starts with"></textarea>
		</div>
		<div class="grid gap-2">
			<Label for="cc">CC</Label>
			<Input bind:value={manager.content.cc} oninput={manager.update_email} id="cc" />
		</div>
		<div class="grid gap-2">
			<Label for="bcc">BCC</Label>
			<Input bind:value={manager.content.bcc} oninput={manager.update_email} id="bcc" />
		</div>
	{/if}
	{#if manager.content.type === 'external'}
		<div class="grid gap-2">
			<Label for="rel">Rel</Label>
			<div class="grid">
				<button
					class="border border-input rounded p-1 px-3.5 bg-input-background min-h-11.5 text-start outline-none focus-visible:border-ring flex items-center justify-between hover:border-primary transition-colors"
					onclick={() => (manager.rel_open = !manager.rel_open)}
				>
					<span class:text-muted-foreground={!manager.content.rel}
						>{manager.content.rel || 'Select rel…'}</span
					>
					<ChevronDownIcon
						size={16}
						class={cn({ 'rotate-180': manager.rel_open }, 'transition-transform')}
					/>
				</button>
				{#if manager.rel_open}
					<ol
						class="bg-input-background border border-input rounded grid divide-y mt-1 overflow-hidden"
						transition:slide
					>
						{#each manager.rel_checkboxes as rel_option}
							<li class="flex items-center gap-2 p-3 relative">
								<input
									type="checkbox"
									id="rel-{rel_option}"
									value={rel_option}
									bind:group={manager.rel}
									onchange={() => {
										if (manager.content.type !== 'external') return
										manager.content.rel = manager.rel.join(' ') as Rel
										if (!manager.rel.length) delete manager.content.rel
										manager.update()
									}}
								/>
								<label
									class="inset-0 absolute cursor-pointer flex items-center pl-8 hover:bg-muted-foreground/10"
									for="rel-{rel_option}"
								>
									{rel_option}
								</label>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet Fields()}
	<section class="grid grid-cols-1 p-4 rounded-lg border border-input bg-input-background/50">
		<nav class="flex gap-3 mb-5">
			<button
				class="font-semibold transition-opacity not-disabled:opacity-50"
				disabled={!manager.show_options}
				onclick={() => (manager.show_options = false)}
			>
				Link
			</button>
			<button
				class="font-semibold transition-opacity not-disabled:opacity-50"
				disabled={manager.show_options}
				onclick={() => (manager.show_options = !manager.show_options)}
			>
				Options
			</button>
		</nav>

		{#if manager.show_options}
			<div transition:slide class="grid gap-5">
				{@render Options()}
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2">
				<Label for="link">Link</Label>
				<div
					class={cn(
						'relative flex gap-2 items-center border rounded-lg bg-input-background focus-within:border-ring h-11.5 px-3 py-1 hover:border-primary transition-colors',
						email_wrong
							? 'border-destructive hover:border-destructive focus-within:border-destructive'
							: picking
								? 'border-ring'
								: 'border-input'
					)}
				>
					<div class="relative flex shrink-0 items-center gap-1 pr-1">
						<select
							title="Select link type…"
							class="absolute inset-0 opacity-0 cursor-pointer peer"
							bind:value={manager.content.type}
							onchange={(event) => {
								if (!event.target || !(event.target instanceof HTMLSelectElement)) return
								manager.content = {
									type: event.target.value as LinkType,
									text: manager.content.text || '',
								}
								// a form link's list opens straight away: there's nothing else to do with it
								picking = manager.content.type === 'form' || manager.content.type === 'internal'
								email_left = false
								manager.update()
							}}
							id="type"
						>
							{#each manager.types as type}
								<option value={type}>{manager.type_label(type)}</option>
							{/each}
						</select>
						<figure class="peer-hover:opacity-50 pointer-events-none transition-opacity">
							<manager.Icon size={16} />
						</figure>
						<ChevronDownIcon size={16} />
					</div>

					{#if manager.content.type === 'internal'}
						{@render StorySelect(manager.content)}
					{:else if manager.content.type === 'asset'}
						{@render AssetSelect(manager.content)}
					{:else if manager.content.type === 'external'}
						{@render ExternalInput(manager.content)}
					{:else if manager.content.type === 'email'}
						{@render EmailInput(manager.content)}
					{:else if manager.content.type === 'form'}
						{@render FormSelect(manager.content)}
					{/if}
				</div>
				{#if email_wrong}
					<p
						id="email-wrong"
						class="text-sm text-destructive animate-in fade-in-0 slide-in-from-top-1 duration-150"
					>
						That doesn’t look like an email address, e.g. name@example.com
					</p>
				{/if}
				{#if picking && manager.content.type === 'internal' && manager.token}
					<StoryList
						token={manager.token}
						value={manager.content.story?.uuid}
						onchoose={(story) => {
							picking = false
							manager.select_story(story)
						}}
						onclose={() => (picking = false)}
					/>
				{/if}
				{#if picking && manager.content.type === 'form'}
					<FormList
						hubspot={manager.hubspot}
						value={manager.content.form}
						onchoose={(form) => {
							picking = false
							manager.select_form(form)
						}}
						onclose={() => (picking = false)}
					/>
				{/if}
			</div>
		{/if}
	</section>
{/snippet}

{#if manager.loaded}
	<!-- Storyblok's modal is only for the asset picker now, which shows itself in it -->
	{#if !manager.is_modal_open}
		{@render Fields()}
	{/if}
{:else}
	<p>Unable to load plugin. Please assign a space to the plugin.</p>
{/if}
