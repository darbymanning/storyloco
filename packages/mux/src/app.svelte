<script lang="ts">
	import { flip } from 'svelte/animate'
	import { fly, fade, slide } from 'svelte/transition'
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
	import { Input, Label, Skeleton as SkeletonComponent, Switch } from 'shared'
	import { MuxManager } from './app.svelte.js'
	import type { MuxAsset } from './app.svelte.js'

	const manager = new MuxManager()

	const loaded = $derived(manager.plugin?.type === 'loaded' && manager.mux)

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

		manager.open_actions = null
	}}
/>

{#snippet Skeleton()}
	<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
		{#each Array(12)}
			<li>
				<div class="p-3 grid gap-2">
					<SkeletonComponent class="aspect-video size-full" />
					<div class="flex gap-2 justify-between">
						<SkeletonComponent class="w-24 h-4" />
						<SkeletonComponent class="w-16 h-4" />
					</div>
				</div>
			</li>
		{/each}
	</ol>
{/snippet}

{#snippet AssetPreview(video?: MuxAsset)}
	{@const playback_id = video?.playback_ids?.[0]?.id}
	{@const is_selected = manager.content?.mux_video?.id === video?.id}

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

{#snippet AssetMeta()}
	<p class="font-medium truncate">
		{manager.content?.title}
	</p>
	<span class="justify-between flex text-muted-foreground text-xs">
		{#if manager.content?.mux_video?.status === 'errored'}
			{manager.content.mux_video.errors?.messages}
		{:else if manager.content?.mux_video?.status === 'preparing'}
			Preparing...
		{:else if manager.content?.mux_video?.duration}
			<span>
				{manager.format_duration(manager.content.mux_video.duration)}
			</span>
			<time datetime={manager.content.mux_video.created_at}>
				{manager.date(manager.content.mux_video.created_at)}
			</time>
		{/if}
	</span>
{/snippet}

{#if loaded}
	{#if manager.is_modal_open}
		<div class="p-8 grid gap-8">
			<mux-uploader onsuccess={manager.list} endpoint={manager.get_upload_endpoint}></mux-uploader>
			{#await manager.list()}
				{@render Skeleton()}
			{:then}
				{#if !manager.assets || manager.assets.length === 0}
					<p class="text-muted-foreground">No videos found</p>
				{:else}
					<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
						{#each manager.assets as video (video.id)}
							{@const actions_open = manager.open_actions === video.id}
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
										onclick={() => manager.toggle_actions(video.id)}
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
														manager.plugin?.actions?.setModalOpen(false)
														manager.set_video(video)
													}}
												>
													Select
												</button>
											</li>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => manager.delete(video.id)}
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
											manager.set_video(video)
											manager.plugin?.actions?.setModalOpen(false)
										}}
									>
										{@render AssetPreview(video)}
									</button>
									{@render AssetMeta()}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			{:catch}
				An error occurred while loading videos.
			{/await}
		</div>
	{:else if manager.content?.mux_video}
		<div
			class="p-4 grid grid-cols-[140px_1fr] w-full border border rounded hover:border-primary transition-colors bg-card text-card-foreground items-center gap-x-5 group"
		>
			{@render AssetPreview(manager.content.mux_video)}
			<div class="grid">{@render AssetMeta()}</div>
			<ul class={actions_menu_classes}>
				<li>
					<button
						onclick={() => manager.plugin?.actions?.setModalOpen(true)}
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
						onclick={() => (manager.video_options_open = !manager.video_options_open)}
					>
						<Settings2Icon size={18} />
					</button>
				</li>
				<li>
					<button
						onclick={() => manager.set_video(null)}
						title="Remove video"
						aria-label="Remove video"
					>
						<Trash2Icon size={18} />
					</button>
				</li>
			</ul>
			{#if manager.video_options_open}
				<div class="grid gap-5 mt-5 col-span-full" transition:slide={{ duration: 300 }}>
					<div class="grid gap-2">
						<Label for="title">Title</Label>
						<Input
							id="title"
							placeholder="Video title…"
							value={manager.content.mux_video.meta?.title}
							oninput={(event) => {
								if (!event.target || !(event.target instanceof HTMLInputElement)) return
								if (!manager.content?.mux_video) return

								manager.set_title(event.target.value, manager.content.mux_video.id)
							}}
						/>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="autoplay"
							checked={manager.content.autoplay}
							onCheckedChange={(autoplay) => manager.update({ autoplay })}
						/>
						<Label for="autoplay">Autoplay</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="playsinline"
							checked={manager.content.playsinline}
							onCheckedChange={(playsinline) => manager.update({ playsinline })}
						/>
						<Label for="playsinline">Playsinline</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="muted"
							checked={manager.content.muted}
							onCheckedChange={(muted) => manager.update({ muted })}
						/>
						<Label for="muted">Muted</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Switch
							id="loop"
							checked={manager.content.loop}
							onCheckedChange={(loop) => manager.update({ loop })}
						/>
						<Label for="loop">Loop</Label>
					</div>
					<div class="grid gap-2">
						<Label for="preload">Preload</Label>
						<select
							class="bg-background border rounded min-h-11.5 outline-none focus-visible:border-ring transition-colors w-full"
							bind:value={manager.content.preload}
							onchange={(event) => {
								if (!event.target || !(event.target instanceof HTMLSelectElement)) return
								manager.update({ preload: event.target.value as 'auto' | 'metadata' | 'none' })
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
										onclick={manager.select_poster}
										title="Select poster"
										aria-label="Select poster"
									>
										<RefreshCwIcon size={18} />
									</button>
								</li>
								{#if !manager.is_mux_poster}
									<li>
										<button
											onclick={manager.delete_poster}
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
								src={manager.poster}
								width={558}
								height={314}
								alt={manager.content.mux_video.meta?.title}
							/>
							{#if manager.is_mux_poster}
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
			onclick={() => manager.plugin?.actions?.setModalOpen(true)}
			title="Add video"
			aria-label="Add video"
		>
			{@render AssetPreview()}
			+ Add Video
		</button>
	{/if}
{/if}
