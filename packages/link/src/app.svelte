<script lang="ts">
	import { Input, Label, Select, Skeleton as SkeletonUI } from 'shared'
	import {
		link_types,
		target_options,
		type AssetLink,
		type EmailLink,
		type ExternalLink,
		type Link,
		type LinkType,
		type Rel,
		type StoryLink,
	} from '../types.js'
	import {
		ChevronDownIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		SlidersHorizontalIcon,
		CircleXIcon,
	} from '@lucide/svelte'
	import PublishedIcon from './published.svelte'
	import DraftIcon from './draft.svelte'
	import { cn } from 'shared/utils'
	import Spinner from './spinner.svelte'
	import NoResults from './no_results.svelte'
	import { slide } from 'svelte/transition'
	import { LinkManager } from './app.svelte.js'
	import { AssetManager } from '../../asset/src/app.svelte.js'

	const manager = new LinkManager()

	// generate skeleton widths once
	const skeleton_widths = Array.from({ length: 20 }, () => Math.floor(Math.random() * 60 + 10))

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

{#snippet THead()}
	<thead>
		<tr class="[&>th]:text-start [&>th]:py-2 [&>th]:px-4">
			<th class="w-full">Name</th>
			<th class="min-w-52">Type</th>
			<th class="min-w-52">Published</th>
			<th class="min-w-52">Updated</th>
		</tr>
	</thead>
{/snippet}

{#snippet Skeleton()}
	{@const rows = 4}
	{@const columns = 4}

	{#snippet Column(index: number)}
		<td style="--width: {skeleton_widths[index]}%">
			<SkeletonUI class="dark:bg-muted-foreground w-(--width) min-w-7 h-7" />
		</td>
	{/snippet}

	<table class="w-full table-auto border-collapse">
		{@render THead()}
		<tbody>
			{#each Array(rows) as _row, row_index}
				<tr class="[&>td]:py-2 [&>td]:px-4 [&>td]:border-b">
					{#each Array(columns) as _column, column_index}
						{@render Column(row_index * columns + column_index)}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

{#snippet StoryWithStatus(story: { name: string; published_at: string | null })}
	{@const StatusIcon = story.published_at ? PublishedIcon : DraftIcon}
	<div class="flex items-center gap-1">
		<StatusIcon
			class={cn(['size-[1.8em] text-muted-foreground', { 'text-primary': story.published_at }])}
		/>
		{story.name}
	</div>
{/snippet}

{#snippet StorySelect(content: StoryLink)}
	<button
		class={cn('w-full text-start', { 'text-muted-foreground': !content.story?.name })}
		onclick={() => {
			manager.set_modal_open(true)
		}}
	>
		{#if content.story?.name}
			{@render StoryWithStatus(content.story)}
		{:else}
			Select a story…
		{/if}
	</button>
	{#if content.story?.name}
		<button
			aria-label="Unassign story"
			title="Unassign story"
			class="text-muted-foreground"
			onclick={manager.clear}
		>
			<CircleXIcon size={18} />
		</button>
	{/if}
{/snippet}

{#snippet AssetSelect(content: AssetLink)}
	<button
		class={cn('w-full text-start grid', { 'text-muted-foreground': !content.asset?.filename })}
		onclick={actions.open_picker}
	>
		{#if content.asset}
			<span class="truncate">{content.asset.name || content.asset.filename.split('/').pop()}</span>
		{:else}
			Select an asset…
		{/if}
	</button>
	{#if content.asset}
		<button
			aria-label="Unassign asset"
			title="Unassign asset"
			class="text-muted-foreground"
			onclick={manager.clear}
		>
			<CircleXIcon size={18} />
		</button>
	{/if}
{/snippet}

{#snippet TargetSelect(content: Link)}
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
		class="w-full outline-none"
		bind:value={content.url}
		oninput={manager.update}
		placeholder="https://example.com"
		type="url"
	/>
{/snippet}

{#snippet EmailInput(content: EmailLink)}
	<input
		class="w-full outline-none"
		bind:value={content.email}
		oninput={manager.update_email}
		placeholder="example@example.com"
		type="email"
	/>
{/snippet}

{#snippet Modal()}
	<div class="p-8 grid gap-4">
		<header class="flex items-center gap-2">
			<Input oninput={manager.search} id="search" type="search" placeholder="Search for a story…" />
			<Select.Root
				type="multiple"
				bind:value={
					() => Array.from(manager.filter_content_types),
					(v) => (manager.filter_content_types = new Set(v))
				}
			>
				<Select.Trigger title="Filter by content type" aria-label="Filter by content type">
					<SlidersHorizontalIcon size={16} />
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Label>Content Types</Select.Label>
						{#await manager.get_content_types()}
							<Spinner class="mx-auto my-4" />
						{:then content_types}
							{#each content_types as content_type}
								<Select.Item value={content_type}>{manager.title_case(content_type)}</Select.Item>
							{/each}
						{/await}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</header>

		{#await manager.get_stories()}
			{@render Skeleton()}
		{:then}
			{#if manager.loading}
				{@render Skeleton()}
			{/if}
			{#if manager.stories.length}
				<table class="w-full table-auto border-collapse">
					{@render THead()}
					<tbody>
						{#each manager.stories as story}
							<tr class="[&>td]:py-2 [&>td]:px-4 [&>td]:border-b">
								<td class="pl-0!">
									<button
										class="grid text-start gap-1 transition-colors hover:bg-muted-foreground/10 w-full outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-2 focus-visible:bg-muted-foreground/10 relative"
										onclick={() => manager.select_story(story)}
									>
										{@render StoryWithStatus(story)}
										<code class="text-xs text-muted-foreground">/{story.full_slug}</code>
									</button>
								</td>
								<td>
									<code class="text-muted-foreground">{story.content.component}</code>
								</td>
								<td>
									{#if story.published_at}
										<time datetime={story.published_at}>{manager.date(story.published_at)}</time>
									{:else}
										<span class="text-muted-foreground">N/A</span>
									{/if}
								</td>
								<td>
									{#if story.updated_at}
										<time datetime={story.updated_at}>{manager.date(story.updated_at)}</time>
									{:else}
										<span class="text-muted-foreground">N/A</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<div class="flex flex-col items-center justify-center h-full gap-4 my-4">
					<NoResults class="size-32" />
					<p class="text-muted-foreground">No stories found</p>
				</div>
			{/if}
		{/await}

		{#if manager.total > manager.per_page}
			<nav class="flex gap-2 justify-between">
				<button
					class="disabled:opacity-20 disabled:cursor-not-allowed flex items-center gap-1 p-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-70 pr-2"
					disabled={!manager.prev}
					onclick={() => manager.get_stories({ page: manager.page - 1 })}
				>
					<ChevronLeftIcon size={20} />
					Previous
				</button>
				{#if manager.total > manager.per_page}
					<div class="text-muted-foreground">
						{manager.page} of {Math.ceil(manager.total / manager.per_page)}
					</div>
				{/if}
				<button
					class="disabled:opacity-20 disabled:cursor-not-allowed flex items-center gap-1 p-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-70 pl-2"
					disabled={!manager.next}
					onclick={() => manager.get_stories({ page: manager.page + 1 })}
				>
					Next
					<ChevronRightIcon size={20} />
				</button>
			</nav>
		{/if}
	</div>
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
	{:else if ['asset', 'external'].includes(manager.content.type)}
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
				class="field-sizing-content p-3 border border-input rounded bg-input-background min-h-11.5 text-start outline-none focus-visible:border-ring resize-none hover:border-primary transition-colors"
				bind:value={manager.content.body}
				oninput={manager.update_email}
				id="body"
				placeholder="Body to use on the email"
			></textarea>
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
	<section class="grid p-4 rounded border border-input bg-input-background/50">
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
			<div class="grid gap-2">
				<Label for="link">Link</Label>
				<div
					class="flex gap-2 items-center border rounded border-input bg-input-background focus-within:border-ring h-11.5 px-3 py-1 hover:border-primary transition-colors"
				>
					<div class="relative flex items-center gap-1">
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
								manager.update()
							}}
							id="type"
						>
							{#each link_types as type}
								<option value={type}>{manager.title_case(type)}</option>
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
					{/if}
				</div>
			</div>
		{/if}
	</section>
{/snippet}

{#if manager.loaded}
	{#if manager.is_modal_open}
		{@render Modal()}
	{:else}
		{@render Fields()}
	{/if}
{:else}
	<p>Unable to load plugin. Please assign a space to the plugin.</p>
{/if}
