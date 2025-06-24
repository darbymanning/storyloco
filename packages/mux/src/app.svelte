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
	import { Input, Label, Skeleton, Switch } from 'shared'
	import type { Video } from '../types.js'

	type MuxAsset = Mux.Video.Assets.Asset
	type Plugin = FieldPluginResponse<Video | null>

	let content: Video | null = $state(null)
	let plugin: Plugin | null = $state(null)
	let assets: Array<MuxAsset> | null = $state(null)
	let open_actions: string | null = $state(null)
	let timeout: NodeJS.Timeout | null = $state(null)
	let video_options_open = $state(false)

	const is_mux_poster = $derived.by(() => content?.poster?.startsWith('https://image.mux.com/'))
	const poster = $derived.by(() => {
		if (is_mux_poster) return `${content?.poster}?width=558&height=314&fit_mode=smartcrop`
		if (content?.poster?.endsWith('.svg')) return content.poster
		return `${content?.poster}/m/558x314/smart`
	})

	onMount(() => {
		createFieldPlugin<Video>({
			enablePortalModal: true,
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

	function get_poster(video: MuxAsset) {
		const playback_id = video.playback_ids?.[0]?.id
		return playback_id ? `https://image.mux.com/${playback_id}/thumbnail.jpg` : undefined
	}

	const actions = {
		update(c?: Partial<Video>) {
			if (plugin?.type !== 'loaded') return
			const state = $state.snapshot({ ...content, ...c })
			plugin.actions.setContent(state)
		},
		set_video(video: MuxAsset | null) {
			if (!video) {
				content = null
				actions.update()
				return
			}

			const playback_id = video.playback_ids?.[0]?.id

			content = {
				...content,
				playback_id,
				title: video.meta?.title,
				m3u8_url: playback_id ? `https://stream.mux.com/${playback_id}.m3u8` : undefined,
				poster: get_poster(video),
				mux_video: video,
			}

			actions.update()
		},
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
			if (content?.mux_video?.id === id) actions.set_video(null)

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
		async set_title(title: string, id: string) {
			if (timeout) clearTimeout(timeout)

			actions.update({ title })

			timeout = setTimeout(async () => {
				if (!mux) return
				await mux.video.assets.update(id, {
					meta: {
						title,
					},
				})
			}, 1000)
		},
		async select_poster() {
			if (!content?.mux_video) return
			const asset = await plugin?.actions?.selectAsset()

			if (!asset) actions.update({ poster: get_poster(content.mux_video) })
			else actions.update({ poster: asset.filename })
		},
		async delete_poster() {
			if (!content?.mux_video) return
			actions.update({ poster: get_poster(content.mux_video) })
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
		return format_elapse(d) || format_date('{MMM} {D}, {YYYY}', d)
	}

	const is_modal_open = $derived.by(() => plugin?.type === 'loaded' && plugin.data.isModalOpen)

	$effect(() => {
		document.documentElement.setAttribute('data-modal-open', is_modal_open ? 'true' : 'false')
	})

	const actions_menu_classes = `
      absolute
      right-4
      top-4
      flex
      items-center
      bg-card
      text-card-foreground
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
      [&_button]:hover:bg-muted
      [&_button]:outline-none
      [&_button]:focus:bg-muted

      group-hover:opacity-100
      group-hover:pointer-events-auto
      group-hover:translate-y-0

      group-focus-within:opacity-100
      group-focus-within:pointer-events-auto
      group-focus-within:translate-y-0
   `
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

{#snippet asset_preview(video?: MuxAsset)}
	{@const playback_id = video?.playback_ids?.[0]?.id}
	{@const is_selected = content?.mux_video?.id === video?.id}

	<figure
		class={cn([
			'flex items-center justify-center [&>svg]:absolute [&>svg]:size-5 bg-muted text-muted-foreground rounded w-full aspect-video relative border',
			{ 'bg-primary [&>svg]:text-primary-foreground': video && is_selected },
		])}
	>
		{#if playback_id && video.status === 'ready'}
			<img
				class={['rounded shrink-0 size-full absolute cover', { 'opacity-50': is_selected }]}
				src="https://image.mux.com/{playback_id}/thumbnail.jpg?width=240&height=135&fit_mode=smartcrop"
				alt={video.meta?.title}
			/>
			<img
				class="rounded shrink-0 size-full absolute cover hover:opacity-100 transition-opacity opacity-0"
				src="https://image.mux.com/{playback_id}/animated.gif?width=240&height=135&fit_mode=smartcrop"
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

{#snippet asset_meta()}
	<p class="font-medium truncate">
		{content?.title}
	</p>
	<span class="justify-between flex text-muted-foreground text-xs">
		{#if content?.mux_video?.status === 'errored'}
			{content.mux_video.errors?.messages}
		{:else if content?.mux_video?.status === 'preparing'}
			Preparing...
		{:else if content?.mux_video?.duration}
			<span>
				{format_duration(content.mux_video.duration)}
			</span>
			<time datetime={content.mux_video.created_at}>
				{date(content.mux_video.created_at)}
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
					<p class="text-muted-foreground">No videos found</p>
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
								{#if video.id}
									<button
										class="
                                 absolute
                                 top-6
                                 right-6
                                 bg-muted
                                 text-muted-foreground
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
											class="absolute top-14 w-full bg-card text-card-foreground rounded shadow-md z-10 border"
											transition:fly={{ y: 20, duration: 300, delay: 100 }}
										>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => {
														plugin?.actions?.setModalOpen(false)
														actions.set_video(video)
													}}
												>
													Select
												</button>
											</li>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => actions.delete(video.id)}
												>
													Delete
												</button>
											</li>
										</ol>
									{/if}
								{/if}
								<div class="grid gap-1 rounded hover:bg-muted transition-colors p-3 w-full">
									<button
										onclick={() => {
											actions.set_video(video)
											plugin?.actions?.setModalOpen(false)
										}}
									>
										{@render asset_preview(video)}
									</button>
									{@render asset_meta()}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			{:catch}
				An error occurred while loading videos.
			{/await}
		</div>
	{:else if content?.mux_video}
		<div
			class="p-4 grid grid-cols-[140px_1fr] w-full border border rounded hover:border-primary transition-colors bg-card text-card-foreground items-center gap-x-5 group"
		>
			{@render asset_preview(content.mux_video)}
			<div class="grid">{@render asset_meta()}</div>
			<ul class={actions_menu_classes}>
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
						onclick={() => actions.set_video(null)}
						title="Remove video"
						aria-label="Remove video"
					>
						<Trash2Icon size={18} />
					</button>
				</li>
			</ul>
			{#if video_options_open}
				<div class="grid gap-5 mt-5 col-span-full" transition:slide={{ duration: 300 }}>
					<div class="grid gap-2">
						<Label for="title">Title</Label>
						<Input
							id="title"
							placeholder="Video title…"
							value={content.mux_video.meta?.title}
							oninput={(event) => {
								if (!event.target || !(event.target instanceof HTMLInputElement)) return
								if (!content?.mux_video) return

								actions.set_title(event.target.value, content.mux_video.id)
							}}
						/>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="autoplay"
							checked={content.autoplay}
							onCheckedChange={(autoplay) => actions.update({ autoplay })}
						/>
						<Label for="autoplay">Autoplay</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="playsinline"
							checked={content.playsinline}
							onCheckedChange={(playsinline) => actions.update({ playsinline })}
						/>
						<Label for="playsinline">Playsinline</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="muted"
							checked={content.muted}
							onCheckedChange={(muted) => actions.update({ muted })}
						/>
						<Label for="muted">Muted</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="loop"
							checked={content.loop}
							onCheckedChange={(loop) => actions.update({ loop })}
						/>
						<Label for="loop">Loop</Label>
					</div>
					<div class="grid gap-2">
						<Label for="preload">Preload</Label>
						<select
							class="bg-background border rounded min-h-11.5 outline-none focus-visible:border-ring transition-colors w-full"
							bind:value={content.preload}
							onchange={(event) => {
								if (!event.target || !(event.target instanceof HTMLSelectElement)) return
								actions.update({ preload: event.target.value as 'auto' | 'metadata' | 'none' })
							}}
							id="preload"
						>
							<option disabled selected value={undefined}>Select preload…</option>
							<option value="auto">Auto</option>
							<option value="metadata">Metadata (default)</option>
							<option value="none">None</option>
						</select>
						<p class="text-muted-foreground text-xs">
							Note: The preload attribute is ignored if autoplay is present.
						</p>
					</div>
					<div class="grid gap-2">
						<Label for="poster">Poster</Label>
						<figure class="relative rounded overflow-hidden border">
							<ul class={actions_menu_classes}>
								<li>
									<button
										onclick={actions.select_poster}
										title="Select poster"
										aria-label="Select poster"
									>
										<RefreshCwIcon size={18} />
									</button>
								</li>
								{#if !is_mux_poster}
									<li>
										<button
											onclick={actions.delete_poster}
											title="Delete poster"
											aria-label="Delete poster"
										>
											<Trash2Icon size={18} />
										</button>
									</li>
								{/if}
							</ul>
							<img
								class="shrink-0 aspect-video object-contain"
								src={poster}
								width={558}
								height={314}
								alt={content.mux_video.meta?.title}
							/>
							{#if is_mux_poster}
								<figcaption
									class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-4 h-20 flex items-end text-muted-foreground text-xs"
								>
									Auto-generated poster from video source
								</figcaption>
							{/if}
						</figure>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<button
			class="p-4 grid grid-cols-[140px_1fr] w-full border border-input rounded hover:border-primary transition-colors bg-input-background text-card-foreground items-center justify-items-start gap-5 font-medium"
			onclick={() => plugin?.actions?.setModalOpen(true)}
			title="Add video"
			aria-label="Add video"
		>
			{@render asset_preview()}
			+ Add Video
		</button>
	{/if}
{/if}
