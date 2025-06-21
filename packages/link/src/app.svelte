<script lang="ts">
	import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
	import { onMount, type Component } from 'svelte'
	import { Input, Label, Skeleton, Select } from 'shared'
	import {
		link_types,
		rel_options,
		target_options,
		type AssetLink,
		type EmailLink,
		type ExternalLink,
		type Link,
		type LinkType,
		type Rel,
		type StoryLink,
		type Target,
	} from '../types.js'
	import {
		type IconProps,
		LinkIcon,
		ExternalLinkIcon,
		MailIcon,
		ImageIcon,
		ChevronDownIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		SlidersHorizontalIcon,
		CircleXIcon,
	} from '@lucide/svelte'
	import type { ISbStories } from '@storyblok/js'
	import { format_date, format_elapse } from 'kitto'
	import PublishedIcon from './published.svelte'
	import DraftIcon from './draft.svelte'
	import { cn } from 'shared/utils'
	import Spinner from './spinner.svelte'
	import NoResults from './no_results.svelte'
	import { slide } from 'svelte/transition'

	type Plugin = FieldPluginResponse<Link | null>

	let plugin_state: Plugin | null = $state(null)

	const plugin = $derived.by(() =>
		plugin_state?.type === 'loaded' &&
		(!!plugin_state.data.token || window.location.hostname !== 'hostname')
			? plugin_state
			: null
	)

	const token = $derived.by(() => {
		return plugin?.data.token || import.meta.env.VITE_STORYBLOK_API_TOKEN
	})

	let content: Link = $state({
		type: 'internal',
	})

	let stories: ISbStories['data']['stories'] = $state([])
	let timeout: NodeJS.Timeout | null = $state(null)
	let loading = $state(false)

	// Pagination
	const per_page = 10
	let page = $state(1)
	let total = $state(0)
	const next = $derived(page < Math.ceil(total / per_page))
	const prev = $derived(page > 1)

	let filter_content_types = $state(new Set<string>(['page']))

	// generate skeleton widths once
	const skeleton_widths = Array.from({ length: 20 }, () => Math.floor(Math.random() * 100 + 10))

	const rel_checkboxes = $state(new Set<Rel>(['noopener', 'noreferrer', 'nofollow']))
	let rel = $state<Array<Rel>>([])
	let rel_open = $state(false)

	const icon_map = new Map<LinkType, Component<IconProps, {}, ''>>([
		['asset', ImageIcon],
		['external', ExternalLinkIcon],
		['email', MailIcon],
		['internal', LinkIcon],
	])

	const target_map = new Map<Target, string>([
		['_self', 'Self'],
		['_blank', 'Blank'],
		['_parent', 'Parent'],
		['_top', 'Top'],
		['_new', 'New'],
	])

	const Icon = $derived(icon_map.get(content.type))

	function title_case(str: string) {
		return str.charAt(0).toUpperCase() + str.slice(1)
	}

	function date(date?: string | null): string {
		if (!date) return 'N/A'
		return format_elapse(date) || format_date('{MMM} {D}, {YYYY} at {h}:{mm} {A}', date)
	}

	onMount(() => {
		createFieldPlugin<Link>({
			enablePortalModal: true,
			onUpdateState: (state) => {
				plugin_state = state as Plugin

				// Maintain state when rerendering after selecting a story
				if (state.data?.content && Object.keys(state.data.content).length > 1) {
					content = state.data.content
				}
			},
		})
	})

	function update() {
		if (!plugin) return
		const state = $state.snapshot(content)
		plugin.actions.setContent(state)
	}

	type GetStoriesParams = {
		search_term?: string
		page?: number
	}

	const actions = {
		clear() {
			delete content.url

			switch (content.type) {
				case 'internal':
					delete content.story
					delete content.target
					delete content.suffix
					break

				case 'asset':
					delete content.asset
					delete content.target
					break

				case 'external':
					delete content.target
					delete content.rel
					break

				case 'email':
					delete content.email
					delete content.subject
					delete content.body
					delete content.cc
					delete content.bcc
					break
			}

			update()
		},
		select_story(story: ISbStories['data']['stories'][number]) {
			if (!plugin) return

			content = {
				type: 'internal',
				text: content.text || story.name,
				url: '/' + story.full_slug,
				story: {
					name: story.name,
					published_at: story.published_at,
				},
			}

			update()
			plugin.actions.setModalOpen(false)
		},
		async search(event: Event) {
			const input = event.target as HTMLInputElement

			if (timeout) clearTimeout(timeout)

			timeout = setTimeout(async () => {
				loading = true
				await actions.get_stories({ search_term: input.value })
				loading = false
			}, 500)
		},
		async get_stories(params: GetStoriesParams = {}): Promise<void> {
			if (!plugin || !token) throw new Error('Plugin not loaded')

			const url = new URL('https://api.storyblok.com/v2/cdn/stories')

			url.searchParams.set('token', token)
			url.searchParams.set('per_page', per_page.toString())
			url.searchParams.set('version', 'draft')
			if (!params.search_term) url.searchParams.set('sort_by', 'name:asc')
			url.searchParams.set('cv', Date.now().toString())
			url.searchParams.set('page', params.page?.toString() || '1')
			url.searchParams.set(
				'filter_query[component][in]',
				Array.from(filter_content_types).join(',')
			)

			if (params.search_term) url.searchParams.set('search_term', params.search_term)

			const result = await fetch(url.toString())
			const data = (await result.json()) as ISbStories['data']

			// Update pagination state
			total = Number(result.headers.get('total'))
			if (params.page) page = params.page

			stories = data.stories
		},
		async get_content_types(): Promise<Set<string>> {
			if (!plugin || !token) throw new Error('Plugin not loaded')

			const url = new URL('https://api.storyblok.com/v2/cdn/stories')

			url.searchParams.set('token', token)
			url.searchParams.set('per_page', '-1')
			url.searchParams.set('version', 'draft')
			url.searchParams.set('cv', Date.now().toString())

			const result = await fetch(url.toString())
			const data = (await result.json()) as ISbStories['data']

			return new Set(
				data.stories.map((story) => story.content.component).filter(Boolean) as Array<string>
			)
		},
		update_email() {
			if (!plugin || content.type !== 'email') return
			if (!content.subject) delete content.subject
			if (!content.body) delete content.body
			if (!content.cc) delete content.cc
			if (!content.bcc) delete content.bcc

			if (!content.email) {
				delete content.email
				delete content.url
			}

			if (content.email) {
				const url = new URL(`mailto:${content.email}`)
				if (content.subject) url.searchParams.set('subject', content.subject)
				if (content.body) url.searchParams.set('body', content.body)
				if (content.cc) url.searchParams.set('cc', content.cc)
				if (content.bcc) url.searchParams.set('bcc', content.bcc)
				content.url = url.toString()
			}

			update()
		},
	}
</script>

{#snippet thead()}
	<thead>
		<tr class="[&>th]:text-start [&>th]:py-2 [&>th]:px-4">
			<th class="w-full">Name</th>
			<th class="min-w-44">Type</th>
			<th class="min-w-44">Published</th>
			<th class="min-w-44">Updated</th>
		</tr>
	</thead>
{/snippet}

{#snippet skeleton()}
	{@const rows = 4}
	{@const columns = 4}

	{#snippet column(index: number)}
		<td style="--width: {skeleton_widths[index]}%">
			<Skeleton class="dark:bg-muted-foreground w-[var(--width)] min-w-7 h-4" />
		</td>
	{/snippet}

	<table class="w-full table-auto border-collapse text-xs">
		{@render thead()}
		<tbody>
			{#each Array(rows) as _row, row_index}
				<tr class="[&>td]:py-2 [&>td]:px-4 [&>td]:border-b">
					{#each Array(columns) as _column, column_index}
						{@render column(row_index * columns + column_index)}
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

{#snippet story_with_status(story: { name: string; published_at: string | null })}
	{@const StatusIcon = story.published_at ? PublishedIcon : DraftIcon}
	<div class="flex items-center gap-1">
		<StatusIcon
			class={cn(['size-[1.8em] text-muted-foreground', { 'text-primary': story.published_at }])}
		/>
		{story.name}
	</div>
{/snippet}

{#snippet story_select(content: StoryLink)}
	<button
		class={cn('w-full text-start', { 'text-muted-foreground': !content.story?.name })}
		onclick={() => {
			plugin?.actions.setModalOpen(true, { height: '400px', width: '800px' })
		}}
	>
		{#if content.story?.name}
			{@render story_with_status(content.story)}
		{:else}
			Select a story…
		{/if}
	</button>
	{#if content.story?.name}
		<button
			aria-label="Unassign story"
			title="Unassign story"
			class="text-muted-foreground"
			onclick={actions.clear}
		>
			<CircleXIcon size={18} />
		</button>
	{/if}
{/snippet}

{#snippet asset_select(content: AssetLink)}
	<button
		class={cn('w-full text-start', { 'text-muted-foreground': !content.asset?.name })}
		onclick={async () => {
			const asset = await plugin?.actions.selectAsset()

			if (!asset) return

			content.url = asset.filename
			content.asset = asset
			update()
		}}
	>
		{#if content.asset}
			{content.asset.name || content.asset.filename.split('/').pop()}
		{:else}
			Select an asset…
		{/if}
	</button>
	{#if content.asset}
		<button
			aria-label="Unassign asset"
			title="Unassign asset"
			class="text-muted-foreground"
			onclick={actions.clear}
		>
			<CircleXIcon size={18} />
		</button>
	{/if}
{/snippet}

{#snippet target_select(content: Link)}
	<div class="grid gap-2">
		<Label for="target">Target</Label>
		<select
			bind:value={content.target}
			onchange={update}
			id="target"
			class="rounded outline-none focus-visible:border-ring border-input bg-white border dark:bg-input/30 min-h-11.5"
		>
			<option disabled selected value={undefined}>Select target…</option>
			{#each target_options as target}
				<option value={target}>{target_map.get(target)}</option>
			{/each}
		</select>
	</div>
{/snippet}

{#snippet external_input(content: ExternalLink)}
	<input
		class="w-full outline-none"
		bind:value={content.url}
		oninput={update}
		placeholder="https://example.com"
		type="url"
	/>
{/snippet}

{#snippet email_input(content: EmailLink)}
	<input
		class="w-full outline-none"
		bind:value={content.email}
		oninput={actions.update_email}
		placeholder="example@example.com"
		type="email"
	/>
{/snippet}

{#if plugin}
	{#if plugin.data.isModalOpen}
		<div class="p-8 grid gap-4">
			<header class="flex items-center gap-2">
				<Input
					oninput={actions.search}
					id="search"
					type="search"
					placeholder="Search for a story…"
				/>
				<Select.Root
					type="multiple"
					bind:value={
						() => Array.from(filter_content_types), (v) => (filter_content_types = new Set(v))
					}
				>
					<Select.Trigger title="Filter by content type" aria-label="Filter by content type">
						<SlidersHorizontalIcon size={16} />
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							<Select.Label>Content Types</Select.Label>
							{#await actions.get_content_types()}
								<Spinner class="mx-auto my-4" />
							{:then content_types}
								{#each content_types as content_type}
									<Select.Item value={content_type}>{title_case(content_type)}</Select.Item>
								{/each}
							{/await}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</header>

			{#await actions.get_stories()}
				{@render skeleton()}
			{:then}
				{#if loading}
					{@render skeleton()}
				{/if}
				{#if stories.length}
					<table class="w-full table-auto border-collapse text-xs">
						{@render thead()}
						<tbody>
							{#each stories as story}
								<tr class="[&>td]:py-2 [&>td]:px-4 [&>td]:border-b">
									<td class="pl-0!">
										<button
											class="flex items-center gap-2 transition-colors hover:bg-muted-foreground/10 w-full outline-none focus-visible:ring-2 focus-visible:ring-ring rounded p-2 focus-visible:bg-muted-foreground/10 relative"
											onclick={() => actions.select_story(story)}
										>
											{@render story_with_status(story)}
											<code class="text-[10px] text-muted-foreground">/{story.full_slug}</code>
										</button>
									</td>
									<td>
										<code class="text-xs text-muted-foreground">{story.content.component}</code>
									</td>
									<td>
										{#if story.published_at}
											<time datetime={story.published_at}>{date(story.published_at)}</time>
										{:else}
											<span class="text-muted-foreground">N/A</span>
										{/if}
									</td>
									<td>
										{#if story.updated_at}
											<time datetime={story.updated_at}>{date(story.updated_at)}</time>
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

			{#if total > per_page}
				<nav class="flex gap-2 justify-between text-xs">
					<button
						class="disabled:opacity-20 disabled:cursor-not-allowed flex items-center gap-1 p-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-70 pr-2"
						disabled={!prev}
						onclick={() => actions.get_stories({ page: page - 1 })}
					>
						<ChevronLeftIcon size={20} />
						Previous
					</button>
					{#if total > per_page}
						<div class="text-muted-foreground">
							{page} of {Math.ceil(total / per_page)}
						</div>
					{/if}
					<button
						class="disabled:opacity-20 disabled:cursor-not-allowed flex items-center gap-1 p-1 py-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity hover:opacity-70 pl-2"
						disabled={!next}
						onclick={() => actions.get_stories({ page: page + 1 })}
					>
						Next
						<ChevronRightIcon size={20} />
					</button>
				</nav>
			{/if}
		</div>
	{:else}
		<fieldset class="grid gap-5">
			<div class="grid gap-2">
				<Label for="text">Text</Label>
				<Input bind:value={content.text} oninput={update} id="text" />
			</div>
			<div class="grid gap-2">
				<Label for="link">Link</Label>
				<div
					class="flex gap-2 items-center border rounded border-input bg-white dark:bg-input/30 focus-within:border-ring h-11.5 px-3 py-1"
				>
					<div class="relative flex items-center gap-1">
						<select
							title="Select link type…"
							class="absolute inset-0 opacity-0 cursor-pointer peer"
							bind:value={content.type}
							oninput={(event) => {
								if (!event.target || !(event.target instanceof HTMLSelectElement)) return
								actions.clear()
								content.type = event.target.value as LinkType
								update()
							}}
							id="type"
						>
							{#each link_types as type}
								<option value={type}>{title_case(type)}</option>
							{/each}
						</select>
						<figure class="peer-hover:opacity-50 pointer-events-none">
							<Icon size={16} />
						</figure>
						<ChevronDownIcon size={16} />
					</div>

					{#if content.type === 'internal'}
						{@render story_select(content)}
					{:else if content.type === 'asset'}
						{@render asset_select(content)}
					{:else if content.type === 'external'}
						{@render external_input(content)}
					{:else if content.type === 'email'}
						{@render email_input(content)}
					{/if}
				</div>
			</div>
			{#if content.type === 'internal'}
				<div class="grid gap-2">
					<Label for="suffix">Suffix</Label>
					<Input
						bind:value={
							() => content.type === 'internal' && content.suffix,
							(v) => content.type === 'internal' && (content.suffix = v || undefined)
						}
						oninput={update}
						id="suffix"
						placeholder="e.g. ?search=value"
					/>
				</div>
				{@render target_select(content)}
			{:else if ['asset', 'external'].includes(content.type)}
				{@render target_select(content)}
			{:else if content.type === 'email'}
				<div class="grid gap-2">
					<Label for="subject">Subject</Label>
					<Input
						bind:value={content.subject}
						oninput={actions.update_email}
						id="subject"
						placeholder="Subject to use on the email"
					/>
				</div>
				<div class="grid gap-2">
					<Label for="body">Body</Label>
					<textarea
						class="field-sizing-content p-3 border border-input rounded bg-white dark:bg-input/30 min-h-11.5 text-start outline-none focus-visible:border-ring resize-none"
						bind:value={content.body}
						oninput={actions.update_email}
						id="body"
						placeholder="Body to use on the email"
					></textarea>
				</div>
				<div class="grid gap-2">
					<Label for="cc">CC</Label>
					<Input bind:value={content.cc} oninput={actions.update_email} id="cc" />
				</div>
				<div class="grid gap-2">
					<Label for="bcc">BCC</Label>
					<Input bind:value={content.bcc} oninput={actions.update_email} id="bcc" />
				</div>
			{/if}
			{#if content.type === 'external'}
				<div class="grid gap-2">
					<Label for="rel">Rel</Label>
					<div class="grid">
						<button
							class="border border-input rounded p-1 px-3.5 bg-white dark:bg-input/30 min-h-11.5 text-start outline-none focus-visible:border-ring flex items-center justify-between"
							onclick={() => (rel_open = !rel_open)}
						>
							<span class:text-muted-foreground={!content.rel}>{content.rel || 'Select rel…'}</span>
							<ChevronDownIcon
								size={16}
								class={cn({ 'rotate-180': rel_open }, 'transition-transform')}
							/>
						</button>
						{#if rel_open}
							<ol
								class="bg-white dark:bg-input/30 border border-input rounded grid text-xs divide-y mt-1 overflow-hidden"
								transition:slide
							>
								{#each rel_checkboxes as rel_option}
									<li class="flex items-center gap-2 p-3 relative">
										<input
											type="checkbox"
											id="rel-{rel_option}"
											value={rel_option}
											bind:group={rel}
											onchange={() => {
												if (content.type !== 'external') return
												content.rel = rel.join(' ') as Rel
												if (!rel.length) delete content.rel
												update()
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
		</fieldset>
	{/if}
{:else}
	<p>Unable to load plugin. Please assign a space to the plugin.</p>
{/if}
