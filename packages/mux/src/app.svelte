<script lang="ts">
	import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
	import { onMount } from 'svelte'
	import { flip } from 'svelte/animate'
	import { fly, fade, slide } from 'svelte/transition'
	import Mux from '@mux/mux-node'
	import { format_date, format_elapse } from 'kitto'
	import {
		VideoIcon,
		VideoOffIcon,
		HourglassIcon,
		Trash2Icon,
		RefreshCwIcon,
		CheckCircle2Icon,
		EllipsisIcon,
		Settings2Icon,
	} from '@lucide/svelte'
	import '@mux/mux-uploader'
	import { cn } from 'shared/utils'
	import Skeleton from './skeleton.svelte'

	type Video = Mux.Video.Assets.Asset | null
	type Plugin = FieldPluginResponse<Video | null>

	let plugin: Plugin | null = $state(null)
	let assets: Array<Mux.Video.Assets.Asset> | null = $state(null)
	let open_actions: string | null = $state(null)
	let timeout: NodeJS.Timeout | null = $state(null)
	let video_options_open = $state(false)

	onMount(() => {
		createFieldPlugin({
			enablePortalModal: true,
			validateContent: (content) => {
				if (typeof content !== 'object' || content === null) {
					return { content: null }
				}

				return { content }
			},
			onUpdateState: (state) => {
				plugin = state as Plugin
			},
		})
	})

	const mux = $derived.by(() => {
		if (plugin?.type !== 'loaded' || !plugin.data.options.MOXY_SECRET_ID) return null

		return new Mux({
			baseURL: 'https://moxy.admin-54b.workers.dev/api/',
			tokenId: '',
			tokenSecret: '',
			defaultHeaders: {
				authorization: `Bearer ${plugin.data.options.MOXY_SECRET_ID}`,
			},
		})
	})

	const actions = {
		async list() {
			if (!mux) throw new Error('Mux not initialised')

			assets = (await mux.video.assets.list()).data
		},
		async delete(id: string) {
			if (plugin?.type !== 'loaded' || !plugin.data.options.MOXY_SECRET_ID || !mux)
				throw new Error('Mux not initialised')

			const confirm = window.confirm('Are you sure you want to delete this video?')

			if (!confirm) return

			// Update local state, for smooth transition
			if (assets?.length) assets = assets.filter((asset) => asset.id !== id)

			// Delete the video
			await mux.video.assets.delete(id)

			// Update content if the deleted video was the current one
			if (plugin?.data.content?.id === id) plugin.actions.setContent(null)

			// Refresh the list
			await actions.list()
		},
		async get_upload_endpoint() {
			if (!mux) throw new Error('Mux not initialised')

			return (
				await mux.video.uploads.create({
					cors_origin: 'https://storyblok.com',
					new_asset_settings: {
						playback_policy: ['public'],
						encoding_tier: 'baseline',
					},
				})
			).url
		},
		toggle_actions(id: string) {
			open_actions = open_actions === id ? null : id
		},
	}

	function format_duration(seconds: number): string {
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		const remaining_seconds = Math.floor(seconds % 60)

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${remaining_seconds.toString().padStart(2, '0')}`
		}

		return `${minutes}:${remaining_seconds.toString().padStart(2, '0')}`
	}

	function date(date: string): string {
		const d = new Date(Number(date) * 1000)
		return format_elapse(d) || format_date('{MMM} {d}, {YYYY}', d)
	}

	async function update_title(title: string, video: NonNullable<Video>) {
		if (timeout) clearTimeout(timeout)

		timeout = setTimeout(async () => {
			await mux!.video.assets.update(video.id, {
				meta: {
					title,
				},
			})
		}, 1000)
	}

	$inspect(video_options_open)
</script>

<svelte:window
	onclick={(event) => {
		if (!(event.target instanceof HTMLElement)) return

		// reset target when we click outside of actions
		if (event.target.closest('.actions')) return

		open_actions = null
	}}
/>

{#snippet skeleton()}
	<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
		{#each Array(12)}
			<li>
				<div class="p-3 grid gap-2">
					<Skeleton class="aspect-video size-full" />
					<div class="flex gap-2 justify-between">
						<Skeleton class="w-24 h-4" />
						<Skeleton class="w-16 h-4" />
					</div>
				</div>
			</li>
		{/each}
	</ol>
{/snippet}

{#snippet asset_preview(video?: NonNullable<Video>)}
	{@const playback_id = video?.playback_ids?.[0]?.id}
	{@const is_selected = plugin?.data?.content?.id === video?.id}

	<figure
		class={cn([
			'flex items-center justify-center [&>svg]:absolute [&>svg]:text-secondary [&>svg]:size-5 bg-gray-50 rounded w-full aspect-video relative',
			{ 'bg-primary [&>svg]:text-white': video && is_selected },
		])}
	>
		{#if playback_id && video.status === 'ready'}
			<img
				class={['rounded shrink-0 size-full absolute cover', { 'opacity-50': is_selected }]}
				src="https://image.mux.com/{playback_id}/thumbnail.jpg?width=240&height=135&fit_mode=smartcrop"
				alt={video.meta?.title}
			/>
		{/if}
		{#if !video}
			<VideoIcon />
		{:else if video.status === 'errored'}
			<VideoOffIcon />
		{:else if video.status === 'preparing'}
			<HourglassIcon />
		{:else if is_selected}
			<CheckCircle2Icon />
		{/if}
	</figure>
{/snippet}

{#snippet asset_meta(video: NonNullable<Video>)}
	<input
		class="font-medium truncate text-dark-blue-950 focus:px-2 transition-[padding] placeholder:font-normal"
		placeholder="Video title…"
		value={video.meta?.title}
		oninput={(event) => {
			if (!event.target || !(event.target instanceof HTMLInputElement)) return

			update_title(event.target.value, video)
		}}
	/>
	<span class="justify-between flex text-dark-blue-500 text-xs">
		{#if video.status === 'errored'}
			{video.errors?.messages}
		{:else if video.status === 'preparing'}
			Preparing...
		{:else if video.duration}
			<span>
				{format_duration(video.duration)}
			</span>
			<time datetime={video.created_at}>
				{date(video.created_at)}
			</time>
		{/if}
	</span>
{/snippet}

{#if plugin?.type === 'loaded' && mux}
	{#if plugin.data.isModalOpen}
		<div class="p-8 grid gap-8">
			<mux-uploader onsuccess={actions.list} endpoint={actions.get_upload_endpoint}></mux-uploader>
			{#await actions.list()}
				{@render skeleton()}
			{:then}
				{#if !assets || assets.length === 0}
					<p class="text-muted">No videos found</p>
				{:else}
					<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
						{#each assets as video (video.id)}
							{@const actions_open = open_actions === video.id}
							<li
								class="relative group size-full"
								class:active={actions_open}
								animate:flip={{ duration: 300 }}
								in:fly={{ y: 20, duration: 300, delay: 100 }}
								out:fade={{ duration: 200 }}
							>
								{#if video.status === 'ready'}
									<button
										class="
                      absolute
                      top-6
                      right-6
                      bg-gray-100
                      rounded
                      p-1
                      z-10

                      opacity-0
                      pointer-events-none
                      -translate-y-10
                      transition-[translate,opacity]

                      group-hover:opacity-100
                      group-hover:pointer-events-auto
                      group-hover:translate-y-0

                      group-focus-within:opacity-100
                      group-focus-within:pointer-events-auto
                      group-focus-within:translate-y-0
                    "
										onclick={() => actions.toggle_actions(video.id)}
									>
										<EllipsisIcon size={18} />
									</button>
									{#if actions_open}
										<ol
											class="absolute top-14 w-full bg-card rounded shadow-md z-10"
											transition:fly={{ y: 20, duration: 300, delay: 100 }}
										>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-gray-50 transition-colors"
													onclick={() => {
														plugin?.actions?.setModalOpen(false)
														plugin?.actions?.setContent($state.snapshot(video))
													}}
												>
													Select
												</button>
											</li>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-gray-50 transition-colors"
													onclick={() => actions.delete(video.id)}
												>
													Delete
												</button>
											</li>
										</ol>
									{/if}
								{/if}
								<div
									class="grid gap-1 rounded hover:bg-gray-50 transition-colors p-3 w-full"
									class:selected={video.id === plugin.data.content?.id}
								>
									<button
										onclick={() => {
											plugin?.actions?.setModalOpen(false)
											plugin?.actions?.setContent($state.snapshot(video))
										}}
									>
										{@render asset_preview(video)}
									</button>
									{@render asset_meta(video)}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			{:catch}
				An error occurred while loading videos.
			{/await}
		</div>
	{:else if plugin.data.content}
		<div
			class="p-4 grid grid-cols-[140px_1fr] w-full border border-border-gray rounded hover:border-primary transition-colors bg-card items-center gap-x-5 font-medium group"
		>
			{@render asset_preview(plugin.data.content)}
			<div>{@render asset_meta(plugin.data.content)}</div>
			<ul
				class="
          absolute
          right-4
          top-4
          flex
          items-center
          bg-card
          border
          rounded
          divide-x
          opacity-0
          pointer-events-none
          -translate-y-10
          transition-[translate,opacity]
          overflow-hidden

          [&>li]:flex
          [&_button]:p-2
          [&_button]:hover:bg-gray-50
          [&_button]:outline-none
          [&_button]:focus:bg-gray-50

          group-hover:opacity-100
          group-hover:pointer-events-auto
          group-hover:translate-y-0

          group-focus-within:opacity-100
          group-focus-within:pointer-events-auto
          group-focus-within:translate-y-0
        "
			>
				<li>
					<button
						onclick={() => plugin?.actions?.setModalOpen(true)}
						title="Replace video"
						aria-label="Replace video"
					>
						<RefreshCwIcon size={18} />
					</button>
				</li>
				<li>
					<button
						title="Settings"
						aria-label="Settings"
						onclick={() => (video_options_open = !video_options_open)}
					>
						<Settings2Icon size={18} />
					</button>
				</li>
				<li>
					<button
						onclick={() => plugin?.actions?.setContent(null)}
						title="Remove video"
						aria-label="Remove video"
					>
						<Trash2Icon size={18} />
					</button>
				</li>
			</ul>
			{#if video_options_open}
				<div class="grid gap-2 mt-5" transition:slide={{ duration: 300 }}>
					<h2 class="text-lg font-medium">Video settings</h2>
					<label class="flex items-center gap-2">
						<input type="checkbox" />
						Autoplay
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" />
						Playsinline
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" />
						Muted
					</label>
					<label class="flex items-center gap-2">
						<input type="checkbox" />
						Loop
					</label>
				</div>
			{/if}
		</div>
	{:else}
		<button
			class="p-4 grid grid-cols-[140px_1fr] w-full border border-border-gray rounded hover:border-primary transition-colors bg-card items-center justify-items-start gap-5 font-medium"
			onclick={() => plugin?.actions?.setModalOpen(true)}
			title="Add video"
			aria-label="Add video"
		>
			{@render asset_preview()}
			+ Add Video
		</button>
	{/if}
{/if}
