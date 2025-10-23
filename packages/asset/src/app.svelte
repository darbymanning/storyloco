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
		CloudUploadIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		FileTextIcon,
		Trash2Icon,
		RefreshCwIcon,
		UndoDotIcon,
		LoaderCircleIcon,
		HouseIcon,
	} from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import {
		Accordion,
		Input,
		Skeleton as SkeletonComponent,
		Checkbox,
		Button,
		DropdownMenu,
		Dialog,
		button_variants,
		ScrollArea,
		Label,
		Toaster,
	} from 'shared'
	import { AssetManager } from './app.svelte.js'
	import type { R2Asset, R2FolderTree } from 'moxyloco/r2'

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

{#snippet AssetPreview(asset?: R2Asset, show_selected = true)}
	{@const is_selected = show_selected && manager.content?.id === asset?.id}

	<figure
		class={cn(
			'flex items-center justify-center [&>svg]:absolute [&>svg]:size-5 bg-muted text-muted-foreground rounded w-full aspect-video relative border min-h-20',
			{ 'opacity-70 bg-destructive text-foreground': manager.show_deleted }
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

{#snippet Folder(props: {
	folder: R2FolderTree
	active: (id: string) => boolean
	onclick: (id: string) => void
	show_menu?: boolean
})}
	{@const { folder, show_menu, onclick } = props}
	{@const active = props.active(props.folder.id)}
	<Accordion.Item value={folder.id} class="border-none">
		<Accordion.Trigger>
			{#snippet child({ props })}
				<div
					class={cn(button_variants({ variant: 'ghost' }), 'w-full justify-start px-1 group', {
						'bg-accent dark:bg-secondary-foreground/10': active,
					})}
				>
					<Button
						{...props}
						class={cn('rounded-full size-7', {
							'opacity-0': !folder.children.length,
						})}
						variant="ghost"
						size="icon"
					>
						<ChevronRightIcon
							class={cn('rotate-0 transition-transform duration-200', {
								'rotate-90': props['data-state'] === 'open',
							})}
						/>
					</Button>
					<button
						class={cn('grow text-start py-1 flex items-center gap-2', {
							'text-tertiary': active,
						})}
						onclick={() => onclick(folder.id)}
					>
						<FolderIcon size={18} />
						{folder.name}
						{#if folder.asset_count > 0}
							<span class="text-xs text-muted-foreground">({folder.asset_count})</span>
						{/if}
					</button>
					{#if show_menu}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										class="rounded-full size-7 opacity-0 group-hover:opacity-100 transition-opacity data-[state=open]:opacity-100"
										variant="ghost"
										size="icon"
									>
										<EllipsisIcon class="size-4" />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content>
								<DropdownMenu.Group>
									<DropdownMenu.Item onclick={() => manager.open_create_folder_modal(folder.id)}>
										Create new folder
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item onclick={() => manager.open_rename_folder_modal(folder)}>
										Rename
									</DropdownMenu.Item>
									<DropdownMenu.Item onclick={() => manager.open_move_folder_modal(folder)}>
										Move
									</DropdownMenu.Item>
									<DropdownMenu.Item
										class="text-destructive data-highlighted:text-destructive data-highlighted:bg-destructive/10"
										onclick={() => manager.delete_folder(folder.id)}
									>
										Delete
									</DropdownMenu.Item>
								</DropdownMenu.Group>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}
				</div>
			{/snippet}
		</Accordion.Trigger>
		{#if folder.children.length}
			<Accordion.Content class="pl-2">
				<Accordion.Root type="multiple">
					{#each folder.children as child}
						{@render Folder({ ...props, folder: child })}
					{/each}
				</Accordion.Root>
			</Accordion.Content>
		{/if}
	</Accordion.Item>
{/snippet}

<Toaster />

<Dialog.Root bind:open={manager.rename_folder_modal}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rename Folder</Dialog.Title>
			<Dialog.Description>Please enter the new folder name in the field below.</Dialog.Description>
		</Dialog.Header>
		<Label class="flex flex-col gap-2 items-start">
			Folder name
			<Input bind:value={manager.folder_name} />
		</Label>
		<Dialog.Footer>
			<Button variant="secondary" onclick={manager.close_rename_folder_modal}>Cancel</Button>
			<Button
				disabled={manager.folder_name === '' || manager.loading}
				onclick={manager.update_folder}
			>
				{manager.loading ? 'Saving' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={manager.move_folder_modal}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Move Folder</Dialog.Title>
			<Dialog.Description
				>Please select the new parent folder for the selected folder.</Dialog.Description
			>
		</Dialog.Header>
		<ScrollArea class="max-h-[calc(100dvh-20rem)]">
			<Button
				variant="ghost"
				class={cn('w-full justify-start', {
					'text-tertiary!': manager.parent_folder_id === null,
				})}
				onclick={() => {
					manager.parent_folder_id = null
				}}
			>
				<HouseIcon />
				Root
			</Button>
			<Accordion.Root type="multiple">
				{#each manager.folders || [] as folder}
					{@render Folder({
						folder,
						active: (id) => manager.parent_folder_id === id,
						onclick: (id: string) => (manager.parent_folder_id = id),
						show_menu: false,
					})}
				{/each}
			</Accordion.Root>
		</ScrollArea>
		<Dialog.Footer>
			<Button variant="secondary" onclick={manager.close_create_folder_modal}>Cancel</Button>
			<Button disabled={manager.loading} onclick={manager.update_folder}>
				{manager.loading ? 'Moving' : 'Move'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={manager.move_asset_modal}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title
				>Move
				{#if manager.selected.length}
					{manager.selected.length} assets
				{:else}
					{manager.active_asset?.attributes.title || manager.active_asset?.attributes.filename}
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				Please select the new parent folder for the selected assets.
			</Dialog.Description>
		</Dialog.Header>
		<ScrollArea class="max-h-[calc(100dvh-20rem)]">
			<Button
				variant="ghost"
				class={cn('w-full justify-start', {
					'text-tertiary!': manager.parent_folder_id === null,
				})}
				onclick={() => {
					manager.parent_folder_id = null
				}}
			>
				<HouseIcon />
				Root
			</Button>
			<Accordion.Root type="multiple">
				{#each manager.folders || [] as folder}
					{@render Folder({
						folder,
						active: (id) => manager.parent_folder_id === id,
						onclick: (id: string) => (manager.parent_folder_id = id),
						show_menu: false,
					})}
				{/each}
			</Accordion.Root>
		</ScrollArea>
		<Dialog.Footer>
			<Button variant="secondary" onclick={manager.close_create_folder_modal}>Cancel</Button>
			<Button disabled={manager.loading} onclick={manager.update_asset}>
				{manager.loading ? 'Moving' : 'Move'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={manager.create_folder_modal}>
	<Dialog.Content>
		<Dialog.Title>Create New Folder</Dialog.Title>
		<Label class="flex flex-col gap-2 items-start">
			New name
			<Input placeholder="e.g. Icons, Videos, Landing pages" bind:value={manager.folder_name} />
		</Label>
		<!-- <Input class="w-full rounded-lg border border-white" placeholder="Search folders..." /> -->
		<ScrollArea class="max-h-[calc(100dvh-20rem)]">
			<Button
				variant="ghost"
				class={cn('w-full justify-start', {
					'text-tertiary!': manager.parent_folder_id === null,
				})}
				onclick={() => {
					manager.parent_folder_id = null
				}}
			>
				<HouseIcon />
				Root
			</Button>
			<Accordion.Root type="multiple">
				{#each manager.folders || [] as folder}
					{@render Folder({
						folder,
						active: (id) => manager.parent_folder_id === id,
						onclick: (id: string) => (manager.parent_folder_id = id),
						show_menu: false,
					})}
				{/each}
			</Accordion.Root>
		</ScrollArea>
		<Dialog.Footer>
			<Button variant="secondary" onclick={manager.close_create_folder_modal}>Cancel</Button>
			<Button
				disabled={manager.folder_name === '' || manager.loading}
				onclick={manager.create_folder}
			>
				{manager.loading ? 'Creating' : 'Create'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if loaded}
	{#if manager.is_modal_open && !manager.active_asset}
		<div class="grid grid-cols-5 grid-rows-[auto_1fr_auto] px-16 gap-x-12 h-full">
			<header class="flex items-center gap-4 pb-4 pt-8 col-span-5">
				<div class="text-2xl font-medium mr-auto">Assets Pro</div>
				<Button onclick={() => manager.open_create_folder_modal()} size="lg" variant="secondary">
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
						{ 'text-tertiary!': manager.active_folder === null && !manager.show_deleted },
					]}
					onclick={() => {
						sessionStorage.removeItem('active_folder')
						manager.active_folder = null
						manager.show_deleted = false
						manager.list_assets(1)
					}}
				>
					<ImageIcon />
					All Assets
				</Button>
				<Button
					variant="ghost"
					class={['text-start justify-start -mx-3', { 'text-tertiary!': manager.show_deleted }]}
					onclick={() => {
						sessionStorage.removeItem('active_folder')
						manager.active_folder = null
						manager.show_deleted = true
						manager.list_assets(1)
					}}
				>
					<Trash2Icon />
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
							<Accordion.Root type="multiple">
								{#each manager.folders as folder}
									{@render Folder({
										folder,
										active: (id) => manager.active_folder === id,
										onclick: manager.view_folder,
										show_menu: true,
									})}
								{/each}
							</Accordion.Root>
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
											<Trash2Icon size={18} />
											Delete Permanently
										</Button>
									</div>
								{:else}
									<Button
										size="icon"
										variant="ghost"
										class="ml-auto rounded-full"
										onclick={() => manager.open_move_asset_modal(manager.selected)}
									>
										<FolderIcon size={18} />
									</Button>
									<Button
										size="icon"
										class="mr-2 rounded-full"
										variant="ghost"
										onclick={() => manager.soft_delete_many_assets(manager.selected)}
									>
										<Trash2Icon size={18} />
									</Button>
								{/if}
							</div>
						{/if}
						<ol class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
							{#each manager.assets as asset, i (i + asset.id)}
								<li
									class="relative group size-full"
									animate:flip={{ duration: 300 }}
									in:fly={{ y: 20, duration: 300, delay: 100 }}
									out:fade={{ duration: 200 }}
								>
									<div
										class={cn(
											'grid gap-1 rounded hover:bg-muted transition-colors p-3 w-full border border-transparent',
											{
												'bg-primary/20 hover:bg-primary/30 border-primary/50 hover:border-primary/70':
													manager.content?.id === asset.id,
											}
										)}
									>
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
										<DropdownMenu.Root>
											<DropdownMenu.Trigger>
												{#snippet child({ props })}
													<Button
														variant="secondary"
														size="icon"
														{...props}
														class={cn(props.class as never, 'absolute top-6 right-6')}
													>
														<EllipsisIcon size={18} />
													</Button>
												{/snippet}
											</DropdownMenu.Trigger>
											<DropdownMenu.Content>
												<DropdownMenu.Item onclick={() => manager.active_asset_details(asset)}>
													View Details
												</DropdownMenu.Item>
												{#if manager.show_deleted}
													<DropdownMenu.Item onclick={() => manager.restore(asset)}>
														Restore
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => manager.hard_delete_asset(asset)}>
														Delete Permanently
													</DropdownMenu.Item>
												{:else}
													<DropdownMenu.Item onclick={() => manager.soft_delete_asset(asset)}>
														Delete
													</DropdownMenu.Item>
													<DropdownMenu.Item onclick={() => manager.open_move_asset_modal(asset)}>
														Move to folder
													</DropdownMenu.Item>
												{/if}
											</DropdownMenu.Content>
										</DropdownMenu.Root>
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
					<div class="grow">
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
	{:else if manager.active_asset}
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
					<div class="text-2xl">{manager.active_asset.attributes.filename}</div>
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
							src={manager.active_asset.links?.self}
							alt={manager.active_asset.attributes.alt}
							title={manager.active_asset.attributes.title}
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
					{#if manager.active_asset.attributes.width && manager.active_asset.attributes.height}
						<div class="flex flex-col gap-1">
							<div class="text-zinc-400">Width & Height</div>
							<div>
								{manager.active_asset.attributes.width} x {manager.active_asset.attributes.height}
							</div>
						</div>
					{:else if manager.active_asset.attributes.size_bytes}
						<div class="flex flex-col gap-1">
							<div class="text-zinc-400">Size</div>
							<div>
								{filesize(manager.active_asset.attributes.size_bytes, { standard: 'jedec' })}
							</div>
						</div>
					{/if}
					<div class="flex flex-col gap-1">
						<div class="text-zinc-400">Format</div>
						<div>.{manager.active_asset.attributes.format}</div>
					</div>
				</div>
			</div>
			<div class="bg-black/10 border border-white/10 flex flex-col col-span-4">
				<div class="p-8 grow-1 flex flex-col gap-5 overflow-y-auto">
					<div class="flex flex-col gap-2 mb-4">
						Asset ID
						<pre class="overflow-auto">{manager.active_asset.id}</pre>
					</div>
					<div class="flex flex-col gap-2 mb-4">
						Asset URL
						<pre class="overflow-auto">{manager.active_asset.links?.self}</pre>
					</div>
					<label class="flex flex-col gap-2" for="title">
						Title/Caption
						<Input bind:value={manager.active_asset.attributes.title} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Alt text
						<Input bind:value={manager.active_asset.attributes.alt} />
					</label>
					<label class="flex flex-col gap-2" for="alt">
						Name
						<Input bind:value={manager.active_asset.attributes.name} />
					</label>
					<label class="flex flex-col gap-2" for="copyright">
						Copyright
						<Input bind:value={manager.active_asset.attributes.copyright} />
					</label>
					<label class="flex flex-col gap-2" for="source">
						Source
						<Input bind:value={manager.active_asset.attributes.source} />
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
			{@render AssetPreview(manager.content._data, false)}
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
						onclick={() => manager.active_asset_details(manager.content!._data)}
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
