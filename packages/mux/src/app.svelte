<script lang="ts">
	import { flip } from 'svelte/animate'
	import { fly, fade, slide } from 'svelte/transition'
	import {
		VideoIcon,
		VideoOffIcon,
		HourglassIcon,
		Trash2Icon,
		RefreshCwIcon,
		CheckIcon,
		EllipsisIcon,
		Settings2Icon,
		UploadIcon,
		SearchIcon,
		PlusIcon,
		ExternalLinkIcon,
		XIcon,
		YoutubeIcon,
		LoaderCircleIcon,
		CircleAlertIcon,
	} from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import {
		Button,
		button_variants,
		Input,
		Label,
		Skeleton as SkeletonComponent,
		Switch,
	} from 'shared'
	import { MuxManager } from './app.svelte.js'
	import type { MuxAsset } from './app.svelte.js'
	const manager = new MuxManager()

	const loaded = $derived(manager.plugin?.type === 'loaded' && manager.mux)
	let search = $state('')
	let renaming = $state<string | null>(null)
	const select = (video: MuxAsset) => {
		manager.set_video(video)
		manager.plugin?.actions?.setModalOpen(false)
	}
	let importing = $state<'youtube' | 'vimeo' | null>(null)
	// the form stays mounted while it animates closed, so it keeps the last service's labels
	let service = $state<'youtube' | 'vimeo'>('youtube')
	const service_name = $derived(service === 'vimeo' ? 'Vimeo' : 'YouTube')
	$effect(() => {
		if (!importing) return
		service = importing
		// focus once the row has started opening
		requestAnimationFrame(() => document.getElementById(`${importing}_url`)?.focus())
	})
	let import_problem = $state<string | null>(null)
	let dragging = $state(false)
	let file_input = $state<HTMLInputElement>()

	const submit_import = (e: Event) => {
		const ok = service === 'vimeo' ? manager.add_vimeo_url(e) : manager.add_youtube_url(e)
		if (ok) importing = import_problem = null
		else import_problem = `That doesn’t look like a ${service_name} link`
	}
	const shown = $derived(
		(manager.assets ?? []).filter((video) =>
			(video.meta?.title ?? '').toLowerCase().includes(search.trim().toLowerCase())
		)
	)
	const title_of = (video?: MuxAsset) => video?.meta?.title || 'Untitled video'
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
	<ol class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4" aria-busy="true">
		{#each Array(8)}
			<li class="overflow-hidden rounded-lg border bg-card">
				<SkeletonComponent class="aspect-video w-full rounded-none" />
				<div class="grid gap-2 p-3">
					<SkeletonComponent class="h-4 w-3/4" />
					<SkeletonComponent class="h-3 w-1/2" />
				</div>
			</li>
		{/each}
	</ol>
{/snippet}

<!-- thumbnail with its duration or status on top; `selectable` adds the picker's selected state -->
{#snippet AssetPreview(video?: MuxAsset, selectable = false)}
	{@const playback_id = video?.playback_ids?.[0]?.id}
	{@const is_selected = selectable && manager.content?.mux_video?.id === video?.id}

	<figure
		class={cn(
			'bg-muted text-muted-foreground relative flex aspect-video w-full items-center justify-center overflow-hidden',
			selectable ? 'rounded-none' : 'rounded-md border'
		)}
	>
		<!-- the field's saved copy of the asset can be stale or partial, so outside the picker any
		playback id gets a thumbnail; the picker's list is always current -->
		{#if playback_id && (selectable ? video?.status === 'ready' : video?.status !== 'errored')}
			<img
				class="absolute inset-0 size-full object-cover"
				src="https://image.mux.com/{playback_id}/thumbnail.webp?width=480&height=270&fit_mode=smartcrop"
				alt=""
				loading="lazy"
			/>
			<!-- the animated preview only loads on hover, then fades in over the still -->
			<img
				class="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-300 hover:opacity-100"
				src="https://image.mux.com/{playback_id}/animated.webp?width=480&height=270&fit_mode=smartcrop"
				alt=""
				loading="lazy"
			/>
			{#if video.duration}
				<span
					class="pointer-events-none absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 text-[11px] font-medium text-white tabular-nums"
					>{manager.format_duration(video.duration)}</span
				>
			{/if}
		{:else if !video}
			<VideoIcon class="size-5" />
		{:else if video.status === 'errored'}
			<VideoOffIcon class="size-5" />
		{:else}
			<HourglassIcon class="size-5 animate-pulse" />
		{/if}
		{#if video && selectable && video.status !== 'ready'}
			<span
				class={cn(
					'absolute top-1.5 left-1.5 rounded-full px-2 text-[11px] font-medium',
					video.status === 'errored'
						? 'bg-destructive text-white'
						: 'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200'
				)}>{video.status === 'errored' ? 'Errored' : 'Processing'}</span
			>
		{/if}
		{#if is_selected}
			<span
				class="bg-primary text-primary-foreground absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full shadow"
				aria-label="Selected"><CheckIcon class="size-3.5" /></span
			>
		{/if}
	</figure>
{/snippet}

{#snippet JobRow(job: import('./app.svelte.js').Job)}
	<li
		class={cn(
			'bg-card flex items-center gap-3 rounded-lg border p-3',
			job.error && 'border-destructive/40'
		)}
		transition:slide={{ duration: 200 }}
	>
		<span
			class={cn(
				'grid size-9 shrink-0 place-items-center rounded-full',
				job.error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
			)}
		>
			{#if job.error}<CircleAlertIcon class="size-4" />{:else}<LoaderCircleIcon
					class="size-4 animate-spin"
				/>{/if}
		</span>
		<div class="grid min-w-0 flex-1 gap-1.5">
			<div class="flex items-baseline justify-between gap-3">
				<p class="truncate text-sm font-medium" title={job.name}>{job.name}</p>
				{#if !job.error && job.percent !== undefined}
					<span class="text-muted-foreground shrink-0 text-xs tabular-nums">{job.percent}%</span>
				{/if}
			</div>
			{#if job.error}
				<p class="text-destructive text-xs">{job.error}</p>
			{:else}
				<div class="bg-muted h-1 overflow-hidden rounded-full">
					<div
						class={cn(
							'bg-primary h-full rounded-full transition-[width] duration-500',
							job.percent === undefined && 'w-1/3 animate-pulse'
						)}
						style:width={job.percent === undefined ? undefined : `${job.percent}%`}
					></div>
				</div>
				<p class="text-muted-foreground text-xs">{job.label}</p>
			{/if}
		</div>
		{#if job.error}
			<button
				class="text-muted-foreground hover:text-foreground shrink-0"
				aria-label="Dismiss"
				onclick={() => manager.dismiss_job(job)}><XIcon class="size-4" /></button
			>
		{/if}
	</li>
{/snippet}

{#snippet Meta(video: MuxAsset)}
	<p class="text-muted-foreground truncate text-xs">
		{#if video.status === 'errored'}
			{video.errors?.messages?.join(' ') || 'Mux couldn’t process this video'}
		{:else if video.status === 'preparing'}
			Processing…
		{:else}
			<time datetime={video.created_at}>{manager.date(video.created_at)}</time>
		{/if}
	</p>
{/snippet}

{#snippet Setting(
	id: string,
	label: string,
	hint: string,
	key: 'autoplay' | 'playsinline' | 'muted' | 'loop'
)}
	<div class="flex items-start gap-3">
		<Switch
			{id}
			class="mt-0.5"
			checked={manager.content?.[key]}
			onCheckedChange={(value: boolean) => manager.update({ [key]: value })}
		/>
		<div class="grid gap-0.5">
			<Label for={id}>{label}</Label>
			<p class="text-muted-foreground text-xs">{hint}</p>
		</div>
	</div>
{/snippet}

{#if loaded}
	{#if manager.setup}
		<!-- this block's Mux field has no secret yet (it was added after the space connected to Mux) -->
		<div
			class="bg-card text-card-foreground flex items-start gap-3 rounded-lg border p-4 text-sm"
			role="status"
		>
			{#if manager.setup === 'working'}
				<LoaderCircleIcon class="text-primary mt-0.5 size-4 shrink-0 animate-spin" />
				<p>Setting up Mux for this block…</p>
			{:else if manager.setup === 'done'}
				<CheckIcon class="text-primary mt-0.5 size-4 shrink-0" />
				<p>
					<strong>Mux is set up for this block.</strong>
					<span class="text-muted-foreground">Reload the page to start using it.</span>
				</p>
			{:else}
				<CircleAlertIcon class="text-muted-foreground mt-0.5 size-4 shrink-0" />
				<p>
					<strong>
						{manager.setup === 'not-connected'
							? 'This space isn’t connected to Mux yet.'
							: 'Mux couldn’t be set up for this block automatically.'}
					</strong>
					<span class="text-muted-foreground">
						{manager.setup === 'not-connected'
							? 'Open Mux in the Storyblok sidebar to connect it.'
							: 'Open Mux in the Storyblok sidebar and choose Set up field.'}
					</span>
				</p>
			{/if}
		</div>
	{:else if manager.is_modal_open}
		<!-- a column with margins, not a grid gap: the collapsible rows below animate their margin away,
		which a grid gap wouldn't allow -->
		<div
			class="flex flex-col p-8"
			role="presentation"
			ondragover={(e) => {
				if (!e.dataTransfer?.types.includes('Files')) return
				e.preventDefault()
				dragging = true
			}}
			ondragleave={(e) => {
				if (!e.relatedTarget) dragging = false
			}}
			ondrop={(e) => {
				if (!dragging) return
				e.preventDefault()
				dragging = false
				manager.upload_files(e.dataTransfer?.files)
			}}
		>
			{#if dragging}
				<div
					class="border-primary bg-background/90 pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-xl border-2 border-dashed backdrop-blur-sm"
					transition:fade={{ duration: 120 }}
				>
					<div class="grid justify-items-center gap-3 text-center">
						<span class="bg-primary/10 text-primary grid size-14 place-items-center rounded-full"
							><UploadIcon class="size-6" /></span
						>
						<p class="text-lg font-semibold">Drop to upload to Mux</p>
						<p class="text-muted-foreground text-sm">Video and audio files</p>
					</div>
				</div>
			{/if}

			<header class="flex flex-wrap items-center justify-between gap-4">
				<div class="grid gap-1">
					<h1 class="text-lg font-semibold">Mux videos</h1>
					<p class="text-muted-foreground text-sm">
						Choose a video for this field, or drop files anywhere here to upload them.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						aria-expanded={importing === 'youtube'}
						onclick={() => {
							importing = importing === 'youtube' ? null : 'youtube'
							import_problem = null
						}}><YoutubeIcon class="size-4" /> From YouTube</Button
					>
					{#if manager.has_vimeo}
						<Button
							variant="secondary"
							aria-expanded={importing === 'vimeo'}
							onclick={() => {
								importing = importing === 'vimeo' ? null : 'vimeo'
								import_problem = null
							}}>From Vimeo</Button
						>
					{/if}
					<Button onclick={() => file_input?.click()}><UploadIcon class="size-4" /> Upload</Button>
					<input
						bind:this={file_input}
						type="file"
						accept="video/*,audio/*"
						multiple
						hidden
						onchange={(e) => {
							manager.upload_files(e.currentTarget.files)
							e.currentTarget.value = ''
						}}
					/>
				</div>
			</header>

			<!-- always mounted: the row animates between 1fr and 0fr together with its margin, so closing
			never snaps at the end -->
			<div
				class={cn(
					'grid transition-[grid-template-rows,margin-top] duration-200 ease-out',
					importing ? 'mt-6 grid-rows-[1fr]' : 'mt-0 grid-rows-[0fr]'
				)}
				inert={!importing}
			>
				<div class="min-h-0 overflow-hidden">
					<form class="bg-muted/40 grid gap-2 rounded-lg border p-4" onsubmit={submit_import}>
						<Label for="{service}_url">Import from {service_name}</Label>
						<div class="flex gap-2">
							<Input
								id="{service}_url"
								type="url"
								required
								placeholder={service === 'vimeo'
									? 'https://vimeo.com/123456789'
									: 'https://www.youtube.com/watch?v=…'}
								class="flex-1"
							/>
							<Button type="submit">Import</Button>
							<Button type="button" variant="ghost" onclick={() => (importing = null)}
								>Cancel</Button
							>
						</div>
						<p class={cn('text-xs', import_problem ? 'text-destructive' : 'text-muted-foreground')}>
							{import_problem ??
								`Paste a link to a public ${service_name} video. It’s copied into Mux in the background.`}
						</p>
					</form>
				</div>
			</div>

			<div
				class={cn(
					'grid transition-[grid-template-rows,margin-top] duration-200 ease-out',
					manager.jobs.length ? 'mt-6 grid-rows-[1fr]' : 'mt-0 grid-rows-[0fr]'
				)}
			>
				<ul class="grid min-h-0 gap-2 overflow-hidden" aria-live="polite">
					{#each manager.jobs as job (job.key)}{@render JobRow(job)}{/each}
				</ul>
			</div>

			{#if manager.undeletable}
				<div
					class="bg-card text-card-foreground mt-6 flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
					role="alert"
				>
					<p>
						Mux doesn’t allow deleting videos over Mux sign-in. Delete {manager.undeletable.title}
						in the
						<a
							class="text-primary inline-flex items-center gap-1 underline"
							href={manager.undeletable.url}
							target="_blank"
							rel="noreferrer">Mux dashboard <ExternalLinkIcon class="size-3" /></a
						>.
					</p>
					<button
						class="text-muted-foreground hover:text-foreground"
						aria-label="Dismiss"
						onclick={() => (manager.undeletable = null)}><XIcon class="size-4" /></button
					>
				</div>
			{/if}

			<section class="mt-6 grid gap-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<h2 class="text-sm font-semibold">
						Library
						{#if manager.assets}<span class="text-muted-foreground ml-1 font-normal tabular-nums"
								>{search
									? `${shown.length} of ${manager.assets.length}`
									: manager.assets.length}</span
							>{/if}
					</h2>
					<label class="relative w-full max-w-72">
						<span class="sr-only">Search videos</span>
						<SearchIcon
							class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
						/>
						<Input type="search" placeholder="Search by title" bind:value={search} class="pl-9" />
					</label>
				</div>

				{#await manager.list()}
					{@render Skeleton()}
				{:then}
					{#if !manager.assets?.length}
						<p
							class="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm"
						>
							No videos yet. Upload one, or drop a file here.
						</p>
					{:else if !shown.length}
						<p
							class="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm"
						>
							No videos match “{search}”.
						</p>
					{:else}
						<ol class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
							{#each shown as video (video.id)}
								{@const actions_open = manager.open_actions === video.id}
								{@const is_selected = manager.content?.mux_video?.id === video.id}
								<li
									class={cn(
										'group bg-card relative overflow-hidden rounded-lg border transition-[border-color,box-shadow] hover:shadow-md',
										is_selected ? 'border-primary ring-primary ring-1' : 'hover:border-primary/60'
									)}
									animate:flip={{ duration: 300 }}
									in:fly={{ y: 20, duration: 300, delay: 100 }}
									out:fade={{ duration: 200 }}
								>
									<button
										class="focus-visible:ring-ring grid w-full outline-none focus-visible:ring-2"
										aria-label="Select {title_of(video)}"
										onclick={() => select(video)}
									>
										{@render AssetPreview(video, true)}
									</button>
									<!-- the title swaps for a text box while renaming, so it can't live inside the select button -->
									<div class="grid gap-0.5 p-3 pr-10">
										{#if renaming === video.id}
											<input
												class="border-input bg-input-background focus-visible:border-ring -mx-1.5 h-5 rounded border px-1.5 text-sm font-medium outline-none"
												aria-label="Video title"
												value={video.meta?.title ?? ''}
												placeholder="Untitled video"
												maxlength="512"
												{@attach (el) => {
													// focus and select once it appears (autofocus only works on page load)
													el.focus()
													el.select()
												}}
												onkeydown={(e) => {
													if (e.key === 'Enter') e.currentTarget.blur()
													if (e.key === 'Escape') {
														// only cancel the rename, not close the surrounding modal
														e.preventDefault()
														e.stopPropagation()
														renaming = null
													}
												}}
												onblur={(e) => {
													if (renaming !== video.id) return
													renaming = null
													manager.rename(video.id, e.currentTarget.value)
												}}
											/>
										{:else}
											<button
												class="truncate text-start text-sm font-medium"
												title={title_of(video)}
												onclick={() => select(video)}>{title_of(video)}</button
											>
										{/if}
										{@render Meta(video)}
									</div>
									<div class="actions absolute right-1.5 bottom-2">
										<button
											class={cn(
												'text-muted-foreground hover:bg-muted hover:text-foreground grid size-7 place-items-center rounded-md transition-opacity',
												actions_open
													? 'opacity-100'
													: 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
											)}
											aria-label="More actions"
											aria-expanded={actions_open}
											onclick={() => manager.toggle_actions(video.id)}
										>
											<EllipsisIcon class="size-4" />
										</button>
										{#if actions_open}
											<ol
												class="bg-popover text-popover-foreground absolute right-0 bottom-9 z-10 min-w-36 overflow-hidden rounded-md border p-1 shadow-md"
												transition:fly={{ y: 6, duration: 150 }}
											>
												<li>
													<button
														class="hover:bg-muted w-full rounded px-3 py-2 text-start text-sm"
														onclick={() => {
															manager.set_video(video)
															manager.plugin?.actions?.setModalOpen(false)
														}}>Select</button
													>
												</li>
												<li>
													<button
														class="hover:bg-muted w-full rounded px-3 py-2 text-start text-sm"
														onclick={() => {
															manager.open_actions = null
															renaming = video.id
														}}>Rename</button
													>
												</li>
												<li>
													<button
														class="text-destructive hover:bg-destructive/10 w-full rounded px-3 py-2 text-start text-sm"
														onclick={() => {
															manager.open_actions = null
															manager.delete(video.id)
														}}>Delete</button
													>
												</li>
											</ol>
										{/if}
									</div>
								</li>
							{/each}
						</ol>
					{/if}
				{:catch}
					<p class="text-destructive rounded-md border p-4 text-sm">
						Couldn’t load the videos. Check the field’s Mux settings, then reopen this.
					</p>
				{/await}
			</section>
		</div>
	{:else if manager.content?.mux_video}
		{@const video = manager.content.mux_video}
		<div class="bg-card text-card-foreground @container grid w-full rounded-lg border">
			<!-- Storyblok's field column is narrow: thumbnail on top there, beside the title when there's room -->
			<div
				class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 p-3 @md:grid-cols-[140px_minmax(0,1fr)_auto]"
			>
				<div class="col-span-full @md:col-span-1">{@render AssetPreview(video)}</div>
				<div class="grid min-w-0 gap-0.5">
					<p class="truncate font-medium" title={manager.content.title || title_of(video)}>
						{manager.content.title || title_of(video)}
					</p>
					<p class="text-muted-foreground truncate text-xs">
						{#if video.status === 'errored'}
							{@render Meta(video)}
						{:else}
							{[
								video.duration ? manager.format_duration(video.duration) : '',
								manager.date(video.created_at),
							]
								.filter(Boolean)
								.join(' · ')}
						{/if}
					</p>
				</div>
				<div class="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon"
						title="Replace video"
						aria-label="Replace video"
						onclick={() => manager.plugin?.actions?.setModalOpen(true)}
					>
						<RefreshCwIcon class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						title="Video settings"
						aria-label="Video settings"
						aria-pressed={manager.video_options_open}
						class={manager.video_options_open ? 'bg-muted text-foreground' : ''}
						onclick={() => (manager.video_options_open = !manager.video_options_open)}
					>
						<Settings2Icon class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						title="Remove video"
						aria-label="Remove video"
						class="hover:text-destructive"
						onclick={() => manager.set_video(null)}
					>
						<Trash2Icon class="size-4" />
					</Button>
				</div>
			</div>

			{#if manager.video_options_open}
				<div class="grid gap-6 border-t p-4" transition:slide={{ duration: 250 }}>
					<div class="grid gap-2">
						<Label for="title">Title</Label>
						<Input
							id="title"
							placeholder={title_of(video)}
							value={manager.content.title}
							oninput={(event) => {
								if (!event.target || !(event.target instanceof HTMLInputElement)) return
								if (!manager.content?.mux_video) return

								manager.set_title(event.target.value, manager.content.mux_video.id)
							}}
						/>
						<p class="text-muted-foreground text-xs">Also renames the video in Mux.</p>
					</div>

					<fieldset class="grid gap-4">
						<legend class="mb-3 text-sm font-medium">Playback</legend>
						<div class="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
							{@render Setting(
								'autoplay',
								'Autoplay',
								'Starts when the page loads. Most browsers also need Muted.',
								'autoplay'
							)}
							{@render Setting('muted', 'Muted', 'Starts with the sound off.', 'muted')}
							{@render Setting('loop', 'Loop', 'Plays again from the start when it ends.', 'loop')}
							{@render Setting(
								'playsinline',
								'Play inline',
								'Plays within the page on iPhone instead of full screen.',
								'playsinline'
							)}
						</div>
					</fieldset>

					<div class="grid gap-2">
						<Label for="preload">Preload</Label>
						<select
							class="border-input bg-input-background focus-visible:border-ring min-h-11.5 w-full rounded-md border px-3 text-sm transition-colors outline-none"
							bind:value={manager.content.preload}
							onchange={(event) => {
								if (!event.target || !(event.target instanceof HTMLSelectElement)) return
								manager.update({ preload: event.target.value as 'auto' | 'metadata' | 'none' })
							}}
							id="preload"
						>
							<option disabled selected value={undefined}>Default (metadata)</option>
							<option value="auto">Auto: load the whole video</option>
							<option value="metadata">Metadata: load just the length and first frame</option>
							<option value="none">None: load nothing until played</option>
						</select>
						<p class="text-muted-foreground text-xs">Ignored when Autoplay is on.</p>
					</div>

					<div class="grid gap-2">
						<div class="flex items-center justify-between gap-3">
							<Label>Poster</Label>
							<div class="flex gap-1">
								<Button variant="secondary" size="sm" onclick={() => manager.select_poster()}>
									{manager.is_mux_poster ? 'Choose image' : 'Replace image'}
								</Button>
								{#if !manager.is_mux_poster}
									<Button variant="ghost" size="sm" onclick={() => manager.delete_poster()}>
										Use video frame
									</Button>
								{/if}
							</div>
						</div>
						<figure class="bg-muted relative overflow-hidden rounded-md border">
							{#if manager.poster}
								<img
									class="aspect-video w-full object-cover"
									src={manager.poster}
									width={558}
									height={314}
									alt=""
								/>
							{:else}
								<div class="aspect-video w-full"></div>
							{/if}
						</figure>
						<p class="text-muted-foreground text-xs">
							{manager.is_mux_poster
								? 'Shown before the video plays. This one is a frame from the video.'
								: 'Shown before the video plays.'}
						</p>
					</div>
				</div>
			{/if}
		</div>
	{:else}
		<button
			class="border-input bg-input-background hover:border-primary hover:bg-muted/40 @container grid w-full items-center rounded-lg border border-dashed p-3 text-start transition-colors"
			onclick={() => manager.plugin?.actions?.setModalOpen(true)}
		>
			<span
				class="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-4 @md:grid-cols-[140px_minmax(0,1fr)]"
			>
				<span
					class="bg-muted text-muted-foreground flex aspect-square items-center justify-center rounded-md @md:aspect-video"
					><PlusIcon class="size-5" /></span
				>
				<span class="grid gap-0.5">
					<span class="font-medium">Add a video</span>
					<span class="text-muted-foreground text-xs"
						>Upload one, import it from YouTube or choose from Mux</span
					>
				</span>
			</span>
		</button>
	{/if}
{/if}
