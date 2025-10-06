<script lang="ts">
	import { flip } from 'svelte/animate'
	import { fly, fade, slide, scale } from 'svelte/transition'
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
		ArrowLeftIcon,
		FolderIcon,
		TrashIcon,
		CloudUploadIcon,
		ChevronDownIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		XIcon,
	} from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import { Input, Label, Skeleton as SkeletonComponent, Switch, Checkbox } from 'shared'
	import { AssetManager } from './app.svelte.js'
	import type { R2Item } from './app.svelte.js'

	const manager = new AssetManager()
	const loaded = $derived(manager.plugin?.type === 'loaded')
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
	let back = $state(false)
	let selected = $state([])
	let folders = $state([])
	let folder_modal = $state(false)
	let folder_name = $state('')
	let loading = $state(false)

	function set_focus(e: MouseEvent) {
		manager.content.focus = e
			? `${e.offsetX}x${e.offsetY}:${e.offsetX + 1}x${e.offsetY + 1}`
			: undefined
		manager.update()
	}

	async function upload(e) {
		const res = await manager.upload(e.target.files[0])
		if (res === true) manager.list()
	}
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
	{@const is_selected = manager.content?.asset?.id === asset?.id}

	<figure
		class={cn([
			'flex items-center justify-center [&>svg]:absolute [&>svg]:size-5 bg-muted text-muted-foreground rounded w-full aspect-video relative border',
			{ 'bg-primary [&>svg]:text-primary-foreground': asset && is_selected },
		])}
	>
		{#if asset}
			<img
				class={['rounded shrink-0 size-full absolute object-cover', { 'opacity-50': is_selected }]}
				src={asset.links.self}
				alt={asset?.title}
			/>
		{:else if !asset}
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
	<p class="font-medium truncate">{asset.attributes.title || asset.attributes.original_filename}</p>
	<span class="justify-between flex text-muted-foreground text-xs">{asset.attributes.format}</span>
{/snippet}

{#if loaded}
	{#if manager.is_modal_open && !manager.open_item}
		<div class="grid grid-cols-5 grid-rows-[auto_1fr_auto] px-16 gap-x-12 h-full">
			<header class="flex items-center gap-4 pb-4 pt-8 col-span-5">
				<div class="text-2xl font-medium mr-auto">Assets Pro</div>
				<button
					class="bg-secondary border border-white/10 rounded-lg px-4 py-2 relative flex gap-2 items-center active:scale-95"
					onclick={() => (folder_modal = true)}
				>
					<FolderIcon size={18} />
					Create folder
				</button>
				<div
					class="bg-primary text-primary-foreground border border-primary rounded-lg px-4 py-2 relative flex gap-2 items-center active:scale-95"
				>
					<CloudUploadIcon size={18} />
					Upload files
					<input class="opacity-0 absolute inset-0" type="file" onchange={upload} />
				</div>
			</header>

			<aside class="py-4 col-span-1 flex flex-col gap-4">
				<button class="w-full flex items-center gap-2" class:text-primary={true}>
					<ImageIcon size={18} />
					All Assets
				</button>
				<button class="w-full flex items-center gap-2">
					<TrashIcon size={18} />
					Deleted Assets
				</button>
				<div class="">Folders</div>
				<Input class="w-full rounded-lg border border-white" placeholder="Search folders..." />
				<div class="flex flex-col">
					{#each manager.folders as folder, i}
						<div
							class="flex items-center gap-2 pl-2 hover:bg-zinc-600 rounded-md"
							class:pl-8={i !== 5}
						>
							{#if i === 5}
								<button onclick={() => (folders[i] = !folders[i])}>
									<ChevronDownIcon size={18} class={cn({ 'rotate-270': !folders[i] })} />
								</button>
							{/if}
							<button class="flex items-center gap-3 w-full py-2">
								<FolderIcon size={18} strokeWidth={1.5} />
								{folder.attributes.name}
							</button>
						</div>
						<!-- TODO: add subfolders -->
						<!-- {#if i === 5 && folders[i]}
							<div class="flex flex-col" transition:slide>
								{#each Array(3), i}
									<button
										class="w-full flex items-center gap-3 py-2 hover:bg-zinc-600 rounded-md pl-12"
									>
										<FolderIcon size={18} strokeWidth={1.5} />
										Folder {i + 1}
									</button>
								{/each}
							</div>
						{/if} -->
					{/each}
				</div>
			</aside>

			<main class="pt-4 col-span-4">
				{#await manager.list()}
					{@render Skeleton()}
				{:then}
					<Input class="w-full rounded-lg border border-white" placeholder="Search assets..." />
					{#if !manager.assets || manager.assets.length === 0}
						<div class="flex flex-col gap-4 items-center justify-center h-full">
							<div class="text-4xl">🙈</div>
							<p class="text-lg text-muted-foreground">No assets found</p>
						</div>
					{:else}
						<div class="relative pt-14">
							{#if selected.length > 0}
								<div
									class="bg-zinc-700 rounded-md p-3 flex gap-4 items-center absolute z-10 top-2 left-0 w-full"
									transition:scale={{ start: 0.99 }}
								>
									<div class="text-sm">{selected.length} items selected</div>
									<button
										class="text-sm"
										onclick={() => (selected = manager.assets.map((asset) => asset.id))}
										>Select All</button
									>
									<button class="text-sm" onclick={() => (selected = [])}>Clear</button>
									<button class="text-sm ml-auto p-0">
										<FolderIcon size={18} />
									</button>
									<button
										class="text-sm p-0 mr-2"
										onclick={() => manager.delete_multiple(selected)}
									>
										<TrashIcon size={18} />
									</button>
								</div>
							{/if}
							<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
								{#each manager.assets as asset (asset.id)}
									{@const actions_open = manager.open_actions === asset.id}
									<li
										class="relative group size-full"
										class:active={actions_open}
										animate:flip={{ duration: 300 }}
										in:fly={{ y: 20, duration: 300, delay: 100 }}
										out:fade={{ duration: 200 }}
									>
										{#if asset.id}
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
															onclick={() => manager.delete(asset)}
														>
															Delete
														</button>
													</li>
												</ol>
											{/if}
										{/if}
										<div class="grid gap-1 rounded hover:bg-muted transition-colors p-3 w-ful">
											<button
												class="peer/ellipsis"
												onclick={() => {
													manager.set_asset(asset)
													manager.plugin?.actions?.setModalOpen(false)
												}}
											>
												{@render AssetPreview(asset)}
												<div class="text-start mt-2">{asset.attributes.original_filenam}</div>
											</button>
											<Checkbox
												class="absolute top-6 left-6 opacity-0 pointer-events-none translate-y-1 scale-95 transition-[translate,opacity] peer-hover/ellipsis:opacity-100 peer-hover/ellipsis:pointer-events-auto peer-hover/ellipsis:translate-y-0 peer-hover/ellipsis:scale-100 duration-400 hover:opacity-100 hover:pointer-events-auto hover:translate-y-0 hover:scale-100 aria-checked:opacity-100 aria-checked:pointer-events-auto aria-checked:translate-y-0 aria-checked:scale-100 !bg-zinc-800"
												onCheckedChange={() =>
													selected.includes(asset.id)
														? selected.splice(selected.indexOf(asset.id), 1)
														: selected.push(asset.id)}
												checked={selected.includes(asset.id)}
											/>
											<button
												class="absolute top-6 right-6 bg-zinc-800 rounded-md p-1 border border-white/10 opacity-0 pointer-events-none translate-y-1 scale-95 transition-[translate,opacity] peer-hover/ellipsis:opacity-100 peer-hover/ellipsis:pointer-events-auto peer-hover/ellipsis:translate-y-0 peer-hover/ellipsis:scale-100 duration-400 peer/context hover:pointer-events-auto hover:translate-y-0 hover:scale-100"
												onclick={() => manager.open_item_details(asset)}
												><EllipsisIcon size="20" /></button
											>
											<div
												class="absolute top-6 right-0 bg-zinc-800 rounded-md p-1 border border-white/10 opacity-0 pointer-events-none translate-y-1 scale-95 transition-[translate,opacity] peer-hover/context:opacity-100 peer-hover/context:pointer-events-auto peer-hover/context:translate-y-0 peer-hover/context:scale-100 duration-400 hover:opacity-100 hover:pointer-events-auto hover:translate-y-0 hover:scale-100"
											>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => {
														;(manager.open_item_details(asset), (back = true))
													}}
												>
													View Details
												</button>
												<button
													class="p-3 w-full text-start hover:bg-muted transition-colors"
													onclick={() => manager.delete(asset)}
												>
													Delete
												</button>
											</div>
											{@render AssetMeta(asset)}
										</div>
									</li>
								{/each}
							</ol>
						</div>
					{/if}
				{:catch}
					An error occurred while loading assets.
				{/await}
			</main>
			<footer
				class="flex items-center col-start-2 col-span-4 py-1 border-t-[0.5px] border-white/50"
			>
				<div class="grow-1">
					1-{manager.assets?.meta?.total} of {manager.assets?.meta?.total} items
				</div>
				<div class="shrink-0 flex items-center gap-2 p-3 border-l-[0.5px] border-white/50">
					{#if manager.assets?.meta?.total}
						{@const pages = Math.floor(manager.assets.meta.total / 96)}
						<select>
							{#each Array(pages), i}
								<option value={i}>Page {i}</option>
							{/each}
						</select>
						of {pages}
					{/if}
				</div>
				<button class="p-3 border-l-[0.5px] border-white/50"><ChevronLeftIcon size={18} /></button>
				<button class="p-3 border-l-[0.5px] border-white/50"><ChevronRightIcon size={18} /></button>
			</footer>
		</div>
		{#if folder_modal}
			<button
				class="fixed inset-0 bg-white/10 z-10"
				onclick={() => (folder_modal = false)}
				aria-label="Close modal"
				transition:fade
			></button>
			<div
				class="flex flex-col gap-4 fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-800 z-20 rounded-lg border border-white/10 p-8 min-w-[600px] shadow-xl"
				transition:fly={{ y: 20 }}
			>
				<div class="flex justify-between gap-4">
					<h2 class="text-xl font-medium">Create New Folder</h2>
					<button class="" onclick={() => (folder_modal = false)}>
						<XIcon size={18} />
					</button>
				</div>
				<div class="flex flex-col gap-4 pb-8">
					<label class="flex flex-col gap-2">
						New name
						<Input
							class="w-full rounded-lg border border-white"
							placeholder="e.g. Icons, Videos, Landing pages"
							bind:value={folder_name}
						/>
					</label>
					<Input class="w-full rounded-lg border border-white" placeholder="Search folders..." />
					<div>
						{#each manager.folders as folder, i}
							<div
								class="flex items-center gap-2 pl-2 hover:bg-zinc-600 rounded-md"
								class:pl-8={i !== 5}
							>
								{#if i === 5}
									<button onclick={() => (folders[i] = !folders[i])}>
										<ChevronDownIcon size={18} class={cn({ 'rotate-270': !folders[i] })} />
									</button>
								{/if}
								<button class="flex items-center gap-3 w-full py-2">
									<FolderIcon size={18} strokeWidth={1.5} />
									{folder.attributes.name}
								</button>
							</div>
							<!-- TODO: add subfolders -->
							<!-- {#if i === 5 && folders[i]}
								<div class="flex flex-col" transition:slide>
									{#each Array(3), i}
										<button
											class="w-full flex items-center gap-3 py-2 hover:bg-zinc-600 rounded-md pl-12"
										>
											<FolderIcon size={18} strokeWidth={1.5} />
											Folder {i + 1}
										</button>
									{/each}
								</div>
							{/if} -->
						{/each}
					</div>
				</div>
				<div class="flex gap-4 justify-end bg-white/5 rounded-b-lg px-8 py-4 -m-8">
					<button
						class="bg-secondary border border-white/10 rounded-lg px-6 py-2 relative flex gap-2 items-center"
						onclick={() => {
							;((folder_modal = false), (folder_name = ''))
						}}>Cancel</button
					>
					<button
						class="bg-primary text-primary-foreground border border-primary rounded-lg px-6 py-2 relative flex gap-2 items-center"
						disabled={folder_name === ''}
						onclick={async () => {
							loading = true
							await manager.create_folder(folder_name)
							loading = false
							folder_modal = false
						}}>{loading ? 'Creating' : 'Create'}</button
					>
				</div>
			</div>
		{/if}
	{:else if manager.open_item}
		<div class="grid grid-cols-12 h-full">
			<div class="p-8 col-span-8 flex flex-col gap-8 overflow-y-auto">
				<div class="flex justify-between">
					{#if back}
						<button
							class=""
							onclick={() => {
								back = !back
								manager.open_item_details(false)
								manager.plugin?.actions?.setModalOpen(true)
							}}
						>
							<ArrowLeftIcon size="20" />
						</button>
					{/if}
					<div class="text-2xl">{manager.open_item.attributes.filename}</div>
					<button class="p-0" onclick={() => set_focus()}>
						<FocusIcon size="20" />
					</button>
				</div>
				<figure
					class="self-center my-auto bg-white/10 cursor-crosshair relative"
					onclick={set_focus}
				>
					<img
						class="w-full h-full object-contain"
						src={manager.open_item.links.self}
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
						<div class="text-zinc-400">Width & Height</div>
						<div class="">
							{manager.open_item.attributes.width} x {manager.open_item.attributes.height}
						</div>
					</div>
					<div class="flex flex-col gap-1">
						<div class="text-zinc-400">Format</div>
						<div class="">.{manager.open_item.attributes.format}</div>
					</div>
				</div>
			</div>
			<div class="bg-black/10 border border-white/10 flex flex-col col-span-4">
				<div class="p-8 grow-1 flex flex-col gap-5 overflow-y-auto">
					<div class="flex flex-col gap-2 mb-4">
						Asset ID
						<div class="">{manager.open_item.id}</div>
					</div>
					<label class="flex flex-col gap-2" for="title">
						Title/Caption
						<Input bind:value={manager.open_item.attributes.title} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Alt text
						<Input bind:value={manager.open_item.attributes.alt} />
					</label>
					<label class="flex flex-col gap-2" for="copyright">
						Copyright
						<Input bind:value={manager.open_item.attributes.copyright} />
					</label>
					<label class="flex flex-col gap-2" for="source">
						Source
						<Input bind:value={manager.open_item.attributes.source} />
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
							// ;(manager.update(), manager.close_item_details())
							manager.update()
							manager.update_asset()
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
