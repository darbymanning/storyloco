<script lang="ts">
	import { filesize } from 'filesize'
	import { flip } from 'svelte/animate'
	import { fly, fade, scale } from 'svelte/transition'
	import {
		ImageIcon,
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
		FileTextIcon,
		Trash2Icon,
		RefreshCwIcon,
		UndoDotIcon,
		LoaderCircleIcon,
	} from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import { Input, Skeleton as SkeletonComponent, Checkbox, Button, button_variants } from 'shared'
	import { AssetManager } from './app.svelte.js'
	import type { R2Asset } from 'moxyloco/r2'

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
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Roboto:wght@100..900&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:window
	onclick={(event) => {
		if (!(event.target instanceof HTMLElement)) return

		// reset target when we click outside of actions
		if (event.target.closest('.actions')) return

		manager.open_actions = null
	}}
/>

{#snippet Skeleton()}
	<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 pt-14">
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

{#snippet AssetPreview(asset?: R2Asset)}
	{@const is_selected = manager.content?.id === asset?.id}

	<figure
		class={cn(
			'flex items-center justify-center [&>svg]:absolute [&>svg]:size-5 bg-muted text-muted-foreground rounded w-full aspect-video relative border min-h-20',
			{ 'opacity-50 bg-destructive': manager.show_deleted }
		)}
	>
		{#if asset?.attributes.content_type}
			{#if asset.attributes.content_type.startsWith('image/')}
				<img
					class={[
						'rounded shrink-0 size-full absolute object-cover',
						{ 'opacity-50': is_selected },
					]}
					src={asset.links?.self}
					alt={asset.attributes?.alt}
				/>
			{:else}
				<FileTextIcon />
			{/if}
		{:else}
			<ImageIcon />
		{/if}
	</figure>
{/snippet}

{#snippet AssetMeta(asset: R2Asset)}
	<p class="font-medium truncate">{asset.attributes.title || asset.attributes.filename}</p>
	<span class="justify-between flex text-muted-foreground text-xs">{asset.attributes.format}</span>
{/snippet}

{#if loaded}
	{#if manager.is_modal_open && !manager.open_item}
		<div class="grid grid-cols-5 grid-rows-[auto_1fr_auto] px-16 gap-x-12 h-full">
			<header class="flex items-center gap-4 pb-4 pt-8 col-span-5">
				<div class="text-2xl font-medium mr-auto">Assets Pro</div>
				<Button onclick={() => (manager.folder_modal = true)} size="lg" variant="secondary">
					<FolderIcon />
					Create folder
				</Button>
				<div class={button_variants({ size: 'lg' })}>
					<CloudUploadIcon size={18} />
					Upload files
					<input
						class="opacity-0 absolute inset-0 cursor-pointer"
						type="file"
						multiple
						onchange={manager.upload}
					/>
				</div>
			</header>

			<aside class="py-4 col-span-1 flex flex-col gap-4">
				<Button
					variant="ghost"
					class={[
						'text-start justify-start -mx-3',
						{ '!text-tertiary': manager.active_folder === null && !manager.show_deleted },
					]}
					onclick={() => {
						manager.show_deleted = false
						manager.select_folder(null)
						manager.list_assets(1)
					}}
				>
					<ImageIcon />
					All Assets
				</Button>
				<Button
					variant="ghost"
					class={['text-start justify-start -mx-3', { '!text-tertiary': manager.show_deleted }]}
					onclick={() => {
						manager.show_deleted = true
						manager.select_folder(null)
						manager.list_assets(1)
					}}
				>
					<TrashIcon />
					Deleted Assets
				</Button>
				{#await manager.list_folders()}
					<LoaderCircleIcon class="animate-spin" />
				{:then}
					{#if manager.folders?.length}
						<div>Folders</div>
						<!-- TODO: add search folders -->
						<!-- <Input class="w-full rounded-lg border border-white" placeholder="Search folders..." /> -->
						<div class="flex flex-col">
							{#each manager.folders as folder, i}
								<div
									class="flex items-center gap-2 pl-2 hover:bg-zinc-600 rounded-md"
									class:pl-8={i !== 5}
								>
									{#if i === 5}
										<button
											onclick={() => (manager.expanded_folders[i] = !manager.expanded_folders[i])}
										>
											<ChevronDownIcon
												size={18}
												class={cn({ 'rotate-270': !manager.expanded_folders[i] })}
											/>
										</button>
									{/if}
									<button
										class={cn('flex items-center gap-3 w-full py-2 text-start', {
											'text-tertiary': manager.active_folder === folder.attributes.name,
										})}
										onclick={() => {
											manager.show_deleted = false
											manager.select_folder(folder.attributes.name)
											manager.list_assets(1)
										}}
									>
										<FolderIcon class="shrink-0" size={18} strokeWidth={1.5} />
										{folder.attributes.name}
									</button>
								</div>
								<!-- TODO: add subfolders -->
								<!-- {#if i === 5 && folders[i]}
							<div class="flex flex-col" transition:slide>
								{#each Array(3), i}soft_delete_asset
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
					{/if}
				{/await}
			</aside>

			<main class="pt-4 col-span-4">
				<Input
					class="w-full rounded-lg border border-white"
					placeholder="Search assets..."
					bind:value={manager.search_query}
					onkeyup={manager.search_keyup}
				/>
				{#if manager.loading_assets}
					{@render Skeleton()}
				{:else if !manager.assets || manager.assets.length === 0}
					<div class="flex flex-col gap-4 items-center justify-center h-full">
						<div class="text-4xl">🙈</div>
						<p class="text-lg text-muted-foreground">No assets found</p>
					</div>
				{:else}
					<div class="relative pt-14">
						{#if manager.selected.length > 0}
							<div
								class="bg-zinc-700 rounded-md p-3 py-1.5 flex gap-4 items-center absolute z-10 top-2 left-0 w-full"
								transition:scale={{ start: 0.99 }}
							>
								<div class="text-sm">
									{manager.selected.length}
									{manager.selected.length === 1 ? 'item' : 'items'} selected
								</div>
								<Button
									size="sm"
									variant="ghost"
									onclick={() =>
										(manager.selected = manager.assets?.map((asset) => asset.id) || [])}
									>Select All</Button
								>
								<Button size="sm" variant="ghost" onclick={() => (manager.selected = [])}
									>Clear</Button
								>
								{#if manager.show_deleted}
									<div class="ml-auto">
										<Button
											variant="ghost"
											size="sm"
											onclick={() => manager.restore_many_assets(manager.selected)}
										>
											<UndoDotIcon size={18} />
											Restore
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onclick={() => manager.hard_delete_many_assets(manager.selected)}
										>
											<TrashIcon size={18} />
											Delete Permanently
										</Button>
									</div>
								{:else}
									<Button size="icon" variant="ghost" class="ml-auto rounded-full">
										<FolderIcon size={18} />
									</Button>
									<Button
										size="icon"
										class="mr-2 rounded-full"
										variant="ghost"
										onclick={() => manager.soft_delete_many_assets(manager.selected)}
									>
										<TrashIcon size={18} />
									</Button>
								{/if}
							</div>
						{/if}
						<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
							{#each manager.assets as asset, i (i + asset.id)}
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
															manager.open_item_details(asset)
															manager.back = true
														}}
													>
														View Details
													</button>
												</li>
												<li>
													{#if manager.show_deleted}
														<button
															class="p-3 w-full text-start hover:bg-muted transition-colors"
															onclick={() => manager.restore(asset)}
														>
															Restore
														</button>
														<button
															class="p-3 w-full text-start hover:bg-muted transition-colors"
															onclick={() => manager.hard_delete_asset(asset)}
														>
															Delete Permanently
														</button>
													{:else}
														<button
															class="p-3 w-full text-start hover:bg-muted transition-colors"
															onclick={() => manager.soft_delete_asset(asset)}
														>
															Delete
														</button>
													{/if}
												</li>
											</ol>
										{/if}
									{/if}
									<div class="grid gap-1 rounded hover:bg-muted transition-colors p-3 w-ful">
										<button
											class="peer/ellipsis"
											onclick={() => {
												manager.select_asset(asset)
												manager.plugin?.actions?.setModalOpen(false)
											}}
										>
											{@render AssetPreview(asset)}
										</button>
										<Checkbox
											class="absolute top-6 left-6 opacity-0 pointer-events-none translate-y-1 transition-[translate,opacity] peer-hover/ellipsis:opacity-100 peer-hover/ellipsis:pointer-events-auto peer-hover/ellipsis:translate-y-0 duration-400 hover:opacity-100 hover:pointer-events-auto hover:translate-y-0 aria-checked:opacity-100 aria-checked:pointer-events-auto aria-checked:translate-y-0"
											onCheckedChange={() =>
												manager.selected.includes(asset.id)
													? manager.selected.splice(manager.selected.indexOf(asset.id), 1)
													: manager.selected.push(asset.id)}
											checked={manager.selected.includes(asset.id)}
										/>
										<button
											class="
                                    absolute
                                    top-6
                                    right-6
                                    bg-secondary
                                    border
                                    text-muted-foreground
                                    rounded
                                    p-1
                                    z-10

                                    opacity-0
                                    pointer-events-none
                                    translate-y-1
                                    transition-[translate,opacity]

                                    group-hover:opacity-100
                                    group-hover:pointer-events-auto
                                    group-hover:translate-y-0

                                    group-focus-within:opacity-100
                                    group-focus-within:pointer-events-auto
                                    group-focus-within:translate-y-0
                                 "
											onclick={() => manager.toggle_actions(asset.id)}
											><EllipsisIcon size="20" /></button
										>
										{@render AssetMeta(asset)}
									</div>
								</li>
							{/each}
						</ol>
					</div>
				{/if}
			</main>
			{#if manager.meta?.total}
				<footer
					class="flex items-center col-start-2 col-span-4 py-1 border-t-[0.5px] border-white/50"
				>
					<div class="grow-1">
						{manager.meta.page}-{manager.meta.total} of {manager.meta.total} items
					</div>
					{#if manager.meta.total > manager.limit}
						<div class="shrink-0 flex items-center gap-2 p-3 border-l-[0.5px] border-white/50">
							<select
								bind:value={manager.meta.page}
								onchange={(event) =>
									manager.go_to_page(Number((event.target as HTMLSelectElement).value))}
							>
								{#each Array(manager.meta.total_pages), i}
									<option value={i + 1}>Page {i + 1}</option>
								{/each}
							</select>
							of {manager.meta.total_pages}
						</div>
						<button
							class="p-3 border-l-[0.5px] border-white/50 disabled:pointer-events-none disabled:opacity-25"
							disabled={manager.meta.page === 1}
							onclick={manager.previous_page}
						>
							<ChevronLeftIcon size={18} />
						</button>
						<button
							class="p-3 border-l-[0.5px] border-white/50 disabled:pointer-events-none disabled:opacity-25"
							disabled={manager.meta.page === manager.meta.total_pages}
							onclick={manager.next_page}
						>
							<ChevronRightIcon size={18} />
						</button>
					{/if}
				</footer>
			{/if}
		</div>
		{#if manager.folder_modal}
			<button
				class="fixed inset-0 bg-white/10 z-10"
				onclick={() => (manager.folder_modal = false)}
				aria-label="Close modal"
				transition:fade
			></button>
			<div
				class="flex flex-col gap-4 fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-800 z-20 rounded-lg border border-white/10 p-8 min-w-[600px] shadow-xl"
				transition:fly={{ y: 20 }}
			>
				<div class="flex justify-between gap-4">
					<h2 class="text-xl font-medium">Create New Folder</h2>
					<button onclick={() => (manager.folder_modal = false)}>
						<XIcon size={18} />
					</button>
				</div>
				<div class="flex flex-col gap-4 pb-8">
					<label class="flex flex-col gap-2">
						New name
						<Input
							class="w-full rounded-lg border border-white"
							placeholder="e.g. Icons, Videos, Landing pages"
							bind:value={manager.folder_name}
						/>
					</label>
					<!-- TODO: add search folders -->
					<!-- <Input class="w-full rounded-lg border border-white" placeholder="Search folders..." /> -->
					<div>
						{#each manager.folders || [] as folder, i}
							<div
								class="flex items-center gap-2 pl-2 hover:bg-zinc-600 rounded-md"
								class:pl-8={i !== 5}
							>
								{#if i === 5}
									<button
										onclick={() => (manager.expanded_folders[i] = !manager.expanded_folders[i])}
									>
										<ChevronDownIcon
											size={18}
											class={cn({ 'rotate-270': !manager.expanded_folders[i] })}
										/>
									</button>
								{/if}
								<button class="flex items-center gap-3 w-full py-2">
									<FolderIcon class="shrink-0" size={18} strokeWidth={1.5} />
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
					<Button
						variant="secondary"
						onclick={() => {
							manager.folder_modal = false
							manager.folder_name = ''
						}}>Cancel</Button
					>
					<Button
						disabled={manager.folder_name === '' || manager.loading}
						onclick={async () => {
							manager.loading = true
							await manager.create_folder(manager.folder_name)
							manager.loading = false
							manager.folder_modal = false
						}}>{manager.loading ? 'Creating' : 'Create'}</Button
					>
				</div>
			</div>
		{/if}
	{:else if manager.open_item}
		<div class="grid grid-cols-12 h-full">
			<div class="p-8 col-span-8 flex flex-col gap-8 overflow-y-auto">
				<div class="flex justify-between">
					{#if manager.back}
						<button
							onclick={() => {
								manager.back = false
								manager.close_item_details()
								manager.plugin?.actions?.setModalOpen(true)
							}}
						>
							<ArrowLeftIcon size="20" />
						</button>
					{/if}
					<div class="text-2xl">{manager.open_item.attributes.filename}</div>
					{#if manager.is_image}
						<button class="p-0" onclick={manager.set_focus}>
							<FocusIcon size="20" />
						</button>
					{/if}
				</div>
				{#if manager.is_image}
					<button
						class="self-center my-auto bg-white/10 cursor-crosshair relative"
						onclick={manager.set_focus}
					>
						<img
							class="size-full object-contain"
							src={manager.open_item.links?.self}
							alt={manager.open_item.attributes.alt}
							title={manager.open_item.attributes.title}
						/>
						{#if manager.content?.focus}
							<span
								class="absolute size-5 border border-black bg-primary rounded-full"
								style:top={manager.focus_y + 'px'}
								style:left={manager.focus_x + 'px'}
							></span>
						{/if}
					</button>
				{:else}
					<figure class="size-full flex items-center justify-center">
						<FileTextIcon size="48" />
					</figure>
				{/if}
				<div class="flex gap-6 justify-center">
					{#if manager.open_item.attributes.width && manager.open_item.attributes.height}
						<div class="flex flex-col gap-1">
							<div class="text-zinc-400">Width & Height</div>
							<div>
								{manager.open_item.attributes.width} x {manager.open_item.attributes.height}
							</div>
						</div>
					{:else if manager.open_item.attributes.size_bytes}
						<div class="flex flex-col gap-1">
							<div class="text-zinc-400">Size</div>
							<div>
								{filesize(manager.open_item.attributes.size_bytes, { standard: 'jedec' })}
							</div>
						</div>
					{/if}
					<div class="flex flex-col gap-1">
						<div class="text-zinc-400">Format</div>
						<div>.{manager.open_item.attributes.format}</div>
					</div>
				</div>
			</div>
			<div class="bg-black/10 border border-white/10 flex flex-col col-span-4">
				<div class="p-8 grow-1 flex flex-col gap-5 overflow-y-auto">
					<div class="flex flex-col gap-2 mb-4">
						Asset ID
						<pre class="overflow-auto">{manager.open_item.id}</pre>
					</div>
					<div class="flex flex-col gap-2 mb-4">
						Asset URL
						<pre class="overflow-auto">{manager.open_item.links?.self}</pre>
					</div>
					<label class="flex flex-col gap-2" for="title">
						Title/Caption
						<Input bind:value={manager.open_item.attributes.title} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Alt text
						<Input bind:value={manager.open_item.attributes.alt} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Name
						<Input bind:value={manager.open_item.attributes.name} />
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
					<Button variant="secondary" onclick={manager.close_item_details}>Cancel</Button>
					<Button onclick={manager.save_and_close}>Save & Close</Button>
				</div>
			</div>
		</div>
	{:else if manager.content?._data}
		<div
			class="p-4 grid grid-cols-[106px_1fr] w-full border rounded hover:border-primary transition-colors bg-card text-card-foreground items-center gap-x-5 group"
		>
			{@render AssetPreview(manager.content._data)}
			<div class="grid">{@render AssetMeta(manager.content._data)}</div>
			<ul class={actions_menu_classes}>
				<li>
					<button
						onclick={manager.open_asset_picker}
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
						onclick={() => manager.open_item_details(manager.content!._data)}
					>
						<Settings2Icon size={18} />
					</button>
				</li>
				<li>
					<button
						onclick={() => manager.select_asset(null)}
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
			class="p-4 grid grid-cols-[106px_1fr] w-full border border-input rounded hover:border-primary transition-colors bg-input-background text-card-foreground items-center justify-items-start gap-5 font-medium"
			onclick={manager.open_asset_picker}
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
