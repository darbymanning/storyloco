<!--
	@component
	A space's stories to pick from, searched as you type, narrowed by content type and chosen by
	pointer or keys: the arrows move through them, Enter picks, Escape closes. In the page's flow
	rather than Storyblok's modal, like the form list beside it.
-->
<script lang="ts">
	import type { ISbStories } from '@storyblok/js'
	import { untrack } from 'svelte'
	import { format_date, format_elapse } from 'kitto'
	import Check from '@lucide/svelte/icons/check'
	import Search from '@lucide/svelte/icons/search'
	import CircleAlert from '@lucide/svelte/icons/circle-alert'
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
	import PublishedIcon from './published.svelte'
	import DraftIcon from './draft.svelte'

	type Story = ISbStories['data']['stories'][number]

	interface Props {
		/** The space's preview token, for its draft stories */
		token: string
		/** The chosen story's uuid */
		value?: string
		onchoose: (story: Story) => void
		/** Escape, to put the list away without choosing */
		onclose?: () => void
	}

	let { token, value, onchoose, onclose }: Props = $props()

	const API = 'https://api.storyblok.com/v2/cdn/stories'
	const PER_PAGE = 25

	const id = $props.id()
	let query = $state('')
	// every content type until some are picked
	let kinds = $state(new Set<string>())
	let filtering = $state(false)
	let known = $state<Array<string> | null>(null)

	let stories = $state<Array<Story>>([])
	let total = $state(0)
	let page = $state(0)
	let loading = $state(true)
	let failed = $state(false)
	// only the latest search's answer counts, however the replies come back
	let request = 0
	let typing: ReturnType<typeof setTimeout> | undefined

	function url(params: Record<string, string>) {
		const url = new URL(API)
		url.searchParams.set('token', token)
		url.searchParams.set('version', 'draft')
		url.searchParams.set('cv', Date.now().toString())
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
		return url
	}

	async function load(more = false) {
		const ticket = ++request
		loading = true
		const params: Record<string, string> = {
			per_page: String(PER_PAGE),
			page: String(more ? page + 1 : 1),
		}
		if (query.trim()) params.search_term = query.trim()
		else params.sort_by = 'name:asc'
		if (kinds.size) params['filter_query[component][in]'] = [...kinds].join(',')
		try {
			const response = await fetch(url(params))
			if (!response.ok) throw new Error(String(response.status))
			const data = (await response.json()) as ISbStories['data']
			if (ticket !== request) return
			stories = more ? [...stories, ...data.stories] : data.stories
			total = Number(response.headers.get('total') || 0)
			page = more ? page + 1 : 1
			failed = false
		} catch {
			if (ticket === request) failed = true
		} finally {
			if (ticket === request) loading = false
		}
	}

	untrack(() => load())

	function search() {
		clearTimeout(typing)
		typing = setTimeout(() => load(), 250)
	}

	function toggle(kind: string) {
		kinds = new Set(kinds.has(kind) ? [...kinds].filter((k) => k !== kind) : [...kinds, kind])
		load()
	}

	// the content types in use, from the first stories, which is plenty to find them without
	// reading the whole of a big space
	async function discover() {
		filtering = !filtering
		if (known) return
		const found = new Set<string>()
		for (let at = 1; at <= 5; at++) {
			const response = await fetch(url({ per_page: '100', page: String(at) })).catch(() => null)
			if (!response?.ok) break
			const { stories } = (await response.json()) as ISbStories['data']
			for (const story of stories) if (story.content?.component) found.add(story.content.component)
			if (stories.length < 100) break
		}
		known = [...found].sort()
	}

	// the chosen story starts highlighted; the arrows and the pointer move it from there
	let active = $derived.by(() => {
		const at = stories.findIndex((story) => story.uuid === value)
		return at === -1 ? 0 : at
	})

	function move(by: number) {
		if (!stories.length) return
		active = (active + by + stories.length) % stories.length
		scroll()
	}

	// only on opening and as the arrows go: showing more mustn't jump back to the top
	const scroll = () =>
		document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })

	function keydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') move(1)
		else if (event.key === 'ArrowUp') move(-1)
		else if (event.key === 'Enter' && stories[active]) onchoose(stories[active])
		else if (event.key === 'Escape') onclose?.()
		else return
		event.preventDefault()
	}

	// how long ago when it's lately, else the day; `format_elapse` gives up after a while
	const ago = (date?: string | null) =>
		date ? format_elapse(date) || format_date('{D} {MMM} {YYYY}', date) : ''
</script>

<div
	class="overflow-hidden rounded-lg border border-input bg-input-background shadow-sm animate-in fade-in-0 slide-in-from-top-1 duration-150"
>
	<div class="flex h-10 items-center gap-2 border-b border-input pl-3 pr-1.5">
		<Search class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
		<input
			{@attach (input) => input.focus()}
			bind:value={query}
			oninput={search}
			onkeydown={keydown}
			class="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
			type="text"
			role="combobox"
			aria-expanded="true"
			aria-controls="{id}-stories"
			aria-activedescendant={stories[active] ? `${id}-${active}` : undefined}
			aria-label="Search stories"
			placeholder="Search stories…"
			autocomplete="off"
			spellcheck="false"
		/>
		<button
			type="button"
			class="relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
			aria-pressed={filtering}
			aria-label="Filter by content type"
			title="Filter by content type"
			onclick={discover}
		>
			<SlidersHorizontal class="size-4" />
			{#if kinds.size}
				<span class="absolute top-1 right-1 size-1.5 rounded-full bg-primary"></span>
			{/if}
		</button>
	</div>

	{#if filtering}
		<div
			class="flex flex-wrap gap-1.5 border-b border-input px-3 py-2 animate-in fade-in-0 duration-150"
			role="group"
			aria-label="Content types"
		>
			{#if known}
				{#each known as kind (kind)}
					<button
						type="button"
						aria-pressed={kinds.has(kind)}
						class="cursor-pointer rounded-full border border-input px-2.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:text-foreground"
						onclick={() => toggle(kind)}>{kind}</button
					>
				{:else}
					<span class="text-xs text-muted-foreground">No content types found</span>
				{/each}
			{:else}
				{#each [48, 64, 40] as width (width)}
					<span
						class="h-5 animate-pulse rounded-full bg-muted-foreground/20"
						style:width="{width}px"
					></span>
				{/each}
			{/if}
		</div>
	{/if}

	{#if failed}
		<p class="flex items-start gap-2 p-3 text-sm text-destructive">
			<CircleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			Couldn’t load stories. Check your connection and try again.
		</p>
	{:else if loading && !stories.length}
		<div class="grid gap-px p-1" aria-busy="true">
			{#each [64, 48, 72, 56] as width (width)}
				<div class="grid h-12 content-center gap-1.5 px-3">
					<div
						class="h-3 animate-pulse rounded bg-muted-foreground/20"
						style:width="{width}%"
					></div>
					<div
						class="h-2.5 animate-pulse rounded bg-muted-foreground/10"
						style:width="{width - 20}%"
					></div>
				</div>
			{/each}
		</div>
	{:else}
		<!-- the chosen story in view on opening -->
		<div
			{@attach () => untrack(scroll)}
			id="{id}-stories"
			role="listbox"
			aria-label="Stories"
			aria-busy={loading}
			class="grid max-h-80 gap-px overflow-y-auto overscroll-contain p-1 transition-opacity {loading
				? 'opacity-60'
				: ''}"
		>
			{#each stories as story, index (story.uuid)}
				{@const selected = story.uuid === value}
				{@const Status = story.published_at ? PublishedIcon : DraftIcon}
				<button
					id="{id}-{index}"
					type="button"
					role="option"
					aria-selected={selected}
					tabindex="-1"
					class="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors {index ===
					active
						? 'bg-accent text-accent-foreground'
						: ''}"
					onpointermove={() => (active = index)}
					onclick={() => onchoose(story)}
				>
					<Status
						class="size-5 shrink-0 {story.published_at ? 'text-primary' : 'text-muted-foreground'}"
					/>
					<span class="grid min-w-0 flex-1">
						<span class="truncate {selected ? 'font-medium text-primary' : ''}">{story.name}</span>
						<span class="truncate font-mono text-xs text-muted-foreground">/{story.full_slug}</span>
					</span>
					<span class="hidden shrink-0 text-right text-xs text-muted-foreground min-[28rem]:grid">
						<span class="font-mono">{story.content?.component}</span>
						<span>{ago(story.updated_at ?? story.published_at)}</span>
					</span>
					{#if selected}
						<Check class="size-4 shrink-0 text-primary" aria-hidden="true" />
					{/if}
				</button>
			{:else}
				<p class="px-3 py-6 text-center text-sm text-muted-foreground">
					{query.trim() ? `No stories match “${query.trim()}”` : 'No stories here yet'}
				</p>
			{/each}
			{#if stories.length < total}
				<button
					type="button"
					class="mt-1 h-9 cursor-pointer rounded-md text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait"
					disabled={loading}
					onclick={() => load(true)}
				>
					{loading ? 'Loading…' : `Show more (${total - stories.length} left)`}
				</button>
			{/if}
		</div>
	{/if}
</div>
