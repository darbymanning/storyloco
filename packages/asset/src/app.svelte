<script lang="ts">
	import { flip } from 'svelte/animate'
	import { fly, fade, slide } from 'svelte/transition'
	import {
		ImageIcon,
		ImageOffIcon,
		HourglassIcon,
		Trash2Icon,
		RefreshCwIcon,
		CheckCircle2Icon,
		EllipsisIcon,
		Settings2Icon,
		FocusIcon,
	} from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import { Input, Label, Skeleton as SkeletonComponent, Switch } from 'shared'
	import { AssetManager } from './app.svelte.js'
	import type { R2Item } from './app.svelte.js'

	const manager = new AssetManager()

	$inspect(manager.assets)

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

	let focus_x = $derived(manager.content.focus?.split(':')[0].split('x')[0])
	let focus_y = $derived(manager.content.focus?.split(':')[0].split('x')[1])

	function set_focus(e: MouseEvent) {
		manager.content.focus = `${e.offsetX}x${e.offsetY}:${e.offsetX + 1}x${e.offsetY + 1}`
		manager.update()
	}

	$inspect(manager.open_item)
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

{#snippet AssetPreview(asset?: R2Item)}
	{@const is_selected = manager.content?.asset?.Key === asset?.Key}

	<figure
		class={cn([
			'flex items-center justify-center [&>svg]:absolute [&>svg]:size-5 bg-muted text-muted-foreground rounded w-full aspect-video relative border',
			{ 'bg-primary [&>svg]:text-primary-foreground': asset && is_selected },
		])}
	>
		<img
			class={['rounded shrink-0 size-full absolute object-cover', { 'opacity-50': is_selected }]}
			src="https://r2.uilo.co/{encodeURIComponent(asset?.Key)}"
			alt={asset?.title}
		/>

		{#if !asset}
			<ImageIcon />
		{:else if asset.status === 'errored'}
			<ImageOffIcon />
		{:else if asset.status === 'preparing'}
			<HourglassIcon />
		{:else if is_selected}
			<CheckCircle2Icon />
		{/if}
	</figure>
{/snippet}

{#snippet AssetMeta(asset: R2Item)}
	<p class="font-medium truncate">
		{asset.meta?.title}
	</p>
	<span class="justify-between flex text-muted-foreground text-xs">
		{#if asset.status === 'errored'}
			{asset.errors?.messages}
		{:else if asset.status === 'preparing'}
			Preparing...
		{:else if asset.duration}
			<span>
				{manager.format_duration(asset.duration)}
			</span>
			<time datetime={asset.created_at}>
				{manager.date(asset.created_at)}
			</time>
		{/if}
	</span>
{/snippet}

{#if loaded}
	{#if manager.is_modal_open && !manager.open_item}
		<div class="p-8 grid gap-8">
			<div class="grid gap-6">
				<form class="flex align-center justify-center border border-white/10 rounded p-8">
					<input class="bg-white text-black p-4 inline rounded-md" type="file" />
				</form>
				{#if manager.has_vimeo}
					{#if manager.vimeo_upload_state === 'loading'}
						<p>Uploading from Vimeo...</p>
					{:else}
						<form class="grid gap-2" onsubmit={manager.add_vimeo_url}>
							<Label for="vimeo_url">Or upload from Vimeo</Label>
							<Input id="vimeo_url" placeholder="https://vimeo.com/123456789" />
						</form>
					{/if}
				{/if}
			</div>
			{#await manager.list()}
				{@render Skeleton()}
			{:then}
				{#if !manager.assets || manager.assets.length === 0}
					<p class="text-muted-foreground">No assets found</p>
				{:else}
					<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
						{#each manager.assets as asset (asset.Key)}
							{@const actions_open = manager.open_actions === asset.id}
							<li
								class="relative group size-full"
								class:active={actions_open}
								animate:flip={{ duration: 300 }}
								in:fly={{ y: 20, duration: 300, delay: 100 }}
								out:fade={{ duration: 200 }}
							>
								{#if asset.id}
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
										onclick={() => manager.toggle_actions(asset.id)}
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
														manager.set_asset(asset)
													}}
												>
													Select
												</button>
											</li>
											<li>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => manager.delete(asset.id)}
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
											manager.set_asset(asset)
											manager.plugin?.actions?.setModalOpen(false)
										}}
									>
										{@render AssetPreview(asset)}
									</button>
									<button onclick={() => manager.open_item_details(asset)}>Edit</button>
									{@render AssetMeta(asset)}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			{:catch}
				An error occurred while loading assets.
			{/await}
		</div>
	{:else if manager.open_item}
		<div class="grid grid-cols-12 h-full">
			<div class="p-8 col-span-8 flex flex-col gap-8 overflow-y-auto">
				<div class="flex justify-between">
					<div class="text-2xl">{manager.open_item.Metadata.filename}</div>
					<button class="p-0" onclick={() => (focus = false)}>
						<FocusIcon size="20" />
					</button>
				</div>
				<figure
					class="self-center my-auto bg-white/10 cursor-crosshair relative"
					onclick={set_focus}
				>
					<img
						class="w-full h-full object-contain"
						src="https://r2.uilo.co/{encodeURIComponent(manager.open_item.Key)}"
						alt="Asset"
					/>
					{#if manager.content.focus}
						<span
							class="absolute w-5 h-5 border border-black bg-primary rounded-full"
							style:top={focus_y + 'px'}
							style:left={focus_x + 'px'}
						></span>
					{/if}
				</figure>
				<div class="flex gap-6 justify-center">
					<div class="flex flex-col gap-1">
						<div class="text-stone-400">Width & Height</div>
						<div class="">
							{manager.open_item.Metadata.width} x {manager.open_item.Metadata.height}
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<div class="text-stone-400">Format</div>
						<div class="">.{manager.open_item.Metadata.format}</div>
					</div>
				</div>
			</div>
			<div class="bg-black/10 border border-white/10 flex flex-col col-span-4">
				<div class="p-8 grow-1 flex flex-col gap-5 overflow-y-auto">
					<div class="flex flex-col gap-2 mb-4">
						Asset ID
						<div class="">{manager.open_item.Key}</div>
					</div>
					<label class="flex flex-col gap-2" for="title">
						Title/Caption
						<Input bind:value={manager.content.title} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Alt text
						<Input bind:value={manager.content.alt} />
					</label>
					<label class="flex flex-col gap-2" for="copyright">
						Copyright
						<Input bind:value={manager.content.copyright} />
					</label>
					<label class="flex flex-col gap-2" for="source">
						Source
						<Input bind:value={manager.content.source} />
					</label>
				</div>
				<div class="px-8 py-4 grow-0 shrink-0 flex gap-2 border-t border-white/10 justify-end">
					<button
						class="bg-secondary text-secondary-foreground rounded py-3 px-7 border border-white/20"
						onclick={manager.close_item_details}
					>
						Cancel
					</button>
					<button
						class="bg-primary text-primary-foreground rounded py-3 px-7"
						onclick={() => {
							;(manager.update(), manager.close_item_details())
						}}
					>
						Save & Close
					</button>
				</div>
			</div>
		</div>
	{:else if manager.content?.asset}
		<div
			class="p-4 grid grid-cols-[140px_1fr] w-full border rounded hover:border-primary transition-colors bg-card text-card-foreground items-center gap-x-5 group"
		>
			{@render AssetPreview(manager.content.asset)}
			<div class="grid">{@render AssetMeta(manager.content.asset)}</div>
			<ul class={actions_menu_classes}>
				<li>
					<button
						onclick={() => manager.plugin?.actions?.setModalOpen(true)}
						title="Replace asset"
						aria-label="Replace asset"
					>
						<RefreshCwIcon size={18} />
					</button>
				</li>
				<li>
					<button
						title="Settings"
						aria-label="Settings"
						onclick={() => (manager.asset_options_open = !manager.asset_options_open)}
					>
						<Settings2Icon size={18} />
					</button>
				</li>
				<li>
					<button
						onclick={() => manager.set_asset(null)}
						title="Remove asset"
						aria-label="Remove asset"
					>
						<Trash2Icon size={18} />
					</button>
				</li>
			</ul>
		</div>
	{:else}
		<button
			class="p-4 grid grid-cols-[140px_1fr] w-full border border-input rounded hover:border-primary transition-colors bg-input-background text-card-foreground items-center justify-items-start gap-5 font-medium"
			onclick={() => manager.plugin?.actions?.setModalOpen(true)}
			title="Add asset"
			aria-label="Add asset"
		>
			{@render AssetPreview()}
			+ Add Asset
		</button>
	{/if}
{/if}

<style>
	@reference './app.css';

	mux-uploader {
		&::part(drop) {
			@apply border-input rounded-md border-1;
		}
	}

	:global {
		[data-modal-open='true'] {
			&,
			body,
			#app {
				height: 100%;
			}
		}
	}
</style>
