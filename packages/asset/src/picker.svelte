<script lang="ts">
	// The file browser in Storyblok's modal, laid out like Storyblok's own Assets and the R2 Assets space plugin:
	// places and folders on the left, one bar for search, type and sort, and a grid that picks, selects or opens.
	import {
		CheckIcon,
		ChevronRightIcon,
		CloudUploadIcon,
		EllipsisIcon,
		FileTextIcon,
		FolderIcon,
		FolderInputIcon,
		FolderOpenIcon,
		FolderPlusIcon,
		ImageOffIcon,
		ImagesIcon,
		InfoIcon,
		Link2Icon,
		LoaderCircleIcon,
		PencilIcon,
		RotateCcwIcon,
		SearchIcon,
		Trash2Icon,
		TriangleAlertIcon,
		XIcon,
	} from '@lucide/svelte'
	import { SvelteSet } from 'svelte/reactivity'
	import { Button, Dialog, DropdownMenu } from 'shared'
	import type { R2Asset, R2FolderTree } from '../r2.js'
	import {
		describe,
		focus_of,
		is_image,
		label,
		may_be_clear,
		thumb,
		type AssetManager,
		type Kind,
	} from './app.svelte.js'

	let { manager }: { manager: AssetManager } = $props()

	const expanded = new SvelteSet<string>()
	let file_input = $state<HTMLInputElement>()
	let search_input = $state<HTMLInputElement>()
	let dropping = $state(false)
	let naming = $state<
		| { mode: 'new'; parent: string | null; value: string }
		| { mode: 'rename'; folder: R2FolderTree; value: string }
		| null
	>(null)
	let moving = $state<{ ids: Array<string> } | { folder: R2FolderTree } | null>(null)
	let move_to = $state<string | null>(null)

	const in_trash = $derived(manager.view.kind === 'trash')
	const selecting = $derived(manager.selected.size > 0)
	const replacing = $derived(manager.replace_index !== null)
	const title = $derived(
		in_trash
			? 'Deleted files'
			: manager.view.kind === 'unused'
				? 'Unused assets'
				: (manager.folder?.name ?? 'All assets')
	)
	const kinds: Array<[Kind, string]> = [
		['', 'All types'],
		['image', 'Images'],
		['video', 'Videos'],
		['audio', 'Audio'],
		['document', 'Documents'],
	]
	const sorts = [
		['-created_at', 'Newest first'],
		['created_at', 'Oldest first'],
		['filename', 'Name A–Z'],
		['-filename', 'Name Z–A'],
		['-size_bytes', 'Largest first'],
		['size_bytes', 'Smallest first'],
	]

	// a card click picks the file for the field; in a list field, or once choosing has started, it selects instead
	const activate = (asset: R2Asset, e: MouseEvent) => {
		if (in_trash) return manager.open_details(asset)
		if (selecting || e.shiftKey || e.metaKey || e.ctrlKey || (manager.multiple && !replacing))
			manager.toggle(asset, e.shiftKey)
		else manager.pick(asset)
	}

	const save_name = () => {
		const value = naming?.value.trim()
		if (!naming || !value) return (naming = null)
		if (naming.mode === 'new') {
			if (naming.parent) expanded.add(naming.parent)
			manager.create_folder(value, naming.parent)
		} else if (value !== naming.folder.name) manager.rename_folder(naming.folder, value)
		naming = null
	}

	const start_move = (what: { ids: Array<string> } | { folder: R2FolderTree }) => {
		moving = what
		move_to = 'folder' in what ? (what.folder.parent_id ?? null) : (manager.folder?.id ?? null)
	}
	const finish_move = async () => {
		if (!moving) return
		if ('ids' in moving) await manager.move(moving.ids, move_to)
		else await manager.move_folder(moving.folder, move_to)
		if (move_to) expanded.add(move_to)
		moving = null
	}
	const inside = (folder: R2FolderTree, id: string): boolean =>
		folder.id === id || folder.children.some((c) => inside(c, id))

	const keys = (e: KeyboardEvent) => {
		if (moving) return
		const typing = (e.target as HTMLElement).closest('input, textarea, select')
		if (e.key === '/' && !typing) {
			e.preventDefault()
			search_input?.focus()
		} else if (e.key === 'Escape' && selecting) {
			e.preventDefault()
			manager.selected.clear()
		} else if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !typing && manager.assets?.length) {
			e.preventDefault()
			manager.select_all()
		}
	}

	const infinite = (node: HTMLElement) => {
		const io = new IntersectionObserver(([entry]) => entry.isIntersecting && manager.next_page(), {
			rootMargin: '600px',
		})
		io.observe(node)
		return { destroy: () => io.disconnect() }
	}
</script>

<svelte:window onkeydown={keys} />

{#snippet name_input(placeholder: string)}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		class="min-w-0 flex-1 rounded-md border border-input bg-input-background px-2 py-1 text-sm outline-none focus:border-primary"
		{placeholder}
		aria-label={placeholder}
		autofocus
		bind:value={naming!.value}
		onblur={save_name}
		onkeydown={(e) => {
			if (e.key === 'Enter') save_name()
			if (e.key === 'Escape') naming = null
		}}
	/>
{/snippet}

{#snippet folder_row(folder: R2FolderTree, depth: number)}
	{@const active = manager.view.kind === 'folder' && manager.view.id === folder.id}
	{@const open = expanded.has(folder.id)}
	<li>
		<div class="row group" class:active style:padding-left="{4 + depth * 16}px">
			<button
				class="grid size-5 shrink-0 place-items-center text-muted-foreground"
				class:invisible={!folder.children.length}
				aria-label={open ? 'Collapse' : 'Expand'}
				onclick={() => (open ? expanded.delete(folder.id) : expanded.add(folder.id))}
			>
				<ChevronRightIcon class="size-3.5 transition-transform {open ? 'rotate-90' : ''}" />
			</button>
			{#if naming?.mode === 'rename' && naming.folder.id === folder.id}
				{@render name_input('Folder name')}
			{:else}
				<button class="place" onclick={() => manager.go({ kind: 'folder', id: folder.id })}>
					{#if active}<FolderOpenIcon class="size-4 shrink-0" />{:else}<FolderIcon
							class="size-4 shrink-0"
						/>{/if}
					<span class="flex-1 truncate">{folder.name}</span>
					<span class="text-xs font-normal text-muted-foreground tabular-nums"
						>{folder.asset_count}</span
					>
				</button>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted data-[state=open]:opacity-100"
								aria-label="Folder actions"><EllipsisIcon class="size-4" /></button
							>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						<DropdownMenu.Item
							onclick={() => (naming = { mode: 'new', parent: folder.id, value: '' })}
						>
							<FolderPlusIcon /> New folder inside
						</DropdownMenu.Item>
						<DropdownMenu.Item
							onclick={() => (naming = { mode: 'rename', folder, value: folder.name })}
						>
							<PencilIcon /> Rename
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={() => start_move({ folder })}
							><FolderInputIcon /> Move to…</DropdownMenu.Item
						>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							class="text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
							onclick={() => {
								if (
									confirm(
										`Delete “${folder.name}”? Its files stay in the library, and folders inside it move up a level.`
									)
								)
									manager.delete_folder(folder)
							}}
						>
							<Trash2Icon /> Delete folder
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
		{#if naming?.mode === 'new' && naming.parent === folder.id}
			<div class="row" style:padding-left="{24 + (depth + 1) * 16}px">
				{@render name_input('New folder')}
			</div>
		{/if}
		{#if folder.children.length && open}
			<ul class="grid gap-px">
				{#each folder.children as child (child.id)}{@render folder_row(child, depth + 1)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#snippet usage_tag(asset: R2Asset)}
	{@const used = manager.usage[asset.id]}
	{#if manager.in_field.has(asset.id)}
		<span class="tag bg-primary/15 text-primary">In this field</span>
	{:else if in_trash || !manager.indexed}{:else if used === undefined}
		<span class="tag bg-muted text-muted-foreground opacity-60">Checking</span>
	{:else if used.length}
		<span class="tag bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
			>Used in {used.length}</span
		>
	{:else}
		<span class="tag bg-amber-500/15 text-amber-700 dark:text-amber-300">Unused</span>
	{/if}
{/snippet}

<div class="grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-background text-foreground">
	<header class="flex flex-wrap items-center gap-3 px-8 pt-7 pb-5">
		<div class="mr-auto">
			<h1 class="text-2xl font-bold tracking-tight">
				{replacing ? 'Replace asset' : manager.multiple ? 'Add assets' : 'Choose an asset'}
			</h1>
			<p class="text-sm text-muted-foreground">
				{replacing
					? 'Pick the file to use instead.'
					: manager.multiple
						? 'Select files, then add them. Shift-click selects a range.'
						: 'Click a file to use it.'}
			</p>
		</div>
		<Button
			variant="outline"
			onclick={() => (naming = { mode: 'new', parent: manager.folder?.id ?? null, value: '' })}
		>
			<FolderPlusIcon /> Create folder
		</Button>
		<input
			bind:this={file_input}
			class="sr-only"
			type="file"
			multiple
			aria-label="Upload files"
			onchange={(e) => {
				const input = e.currentTarget
				manager.upload(input.files).then(() => (input.value = ''))
			}}
		/>
		<Button onclick={() => file_input?.click()}><CloudUploadIcon /> Upload files</Button>
		<button
			class="ml-1 grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Close"
			title="Close"
			onclick={manager.close_modal}
		>
			<XIcon class="size-5" />
		</button>
	</header>

	<div class="grid min-h-0 grid-cols-[232px_minmax(0,1fr)] gap-8 px-8">
		<nav class="grid content-start gap-1 overflow-y-auto pb-8" aria-label="Library">
			<button
				class="row place px-2.5"
				class:active={manager.view.kind === 'all'}
				onclick={() => manager.go({ kind: 'all' })}
			>
				<ImagesIcon class="size-4" /><span class="flex-1 truncate">All assets</span>
				{#if manager.all_total !== null}<span
						class="text-xs font-normal text-muted-foreground tabular-nums"
						>{manager.all_total.toLocaleString()}</span
					>{/if}
			</button>
			{#if manager.indexed}
				<button
					class="row place px-2.5"
					class:active={manager.view.kind === 'unused'}
					onclick={() => manager.go({ kind: 'unused' })}
					title="Files no story uses, drafts included"
				>
					<ImageOffIcon class="size-4" /><span class="flex-1 truncate">Unused assets</span>
					{#if manager.unused_total !== null}<span
							class="text-xs font-normal text-muted-foreground tabular-nums"
							>{manager.unused_total.toLocaleString()}</span
						>{/if}
				</button>
			{/if}
			<button
				class="row place px-2.5"
				class:active={in_trash}
				onclick={() => manager.go({ kind: 'trash' })}
			>
				<Trash2Icon class="size-4" /><span class="flex-1 truncate">Deleted files</span>
			</button>

			<div class="mt-5 flex items-center justify-between pl-2.5 pr-1">
				<h2 class="text-sm font-semibold">Folders</h2>
				<button
					class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
					title="New folder"
					aria-label="New folder"
					onclick={() => (naming = { mode: 'new', parent: null, value: '' })}
				>
					<FolderPlusIcon class="size-4" />
				</button>
			</div>
			<ul class="grid gap-px">
				{#if naming?.mode === 'new' && naming.parent === null}
					<li><div class="row pl-6">{@render name_input('New folder')}</div></li>
				{/if}
				{#each manager.folders as folder (folder.id)}{@render folder_row(folder, 0)}{/each}
				{#if !manager.folders.length && !naming}<li
						class="px-2.5 py-1.5 text-sm text-muted-foreground"
					>
						No folders yet
					</li>{/if}
			</ul>
		</nav>

		<section
			class="relative min-h-0 overflow-y-auto pb-24"
			aria-label={title}
			ondragover={(e) => {
				if (in_trash || !e.dataTransfer?.types.includes('Files')) return
				e.preventDefault()
				dropping = true
			}}
			ondragleave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (dropping = false)}
			ondrop={(e) => {
				if (!e.dataTransfer?.types.includes('Files')) return
				e.preventDefault()
				dropping = false
				if (!in_trash) manager.upload(e.dataTransfer.files)
			}}
		>
			<div class="sticky top-0 z-10 bg-background pb-3">
				<div
					class="flex items-stretch rounded-lg border border-input bg-input-background transition-shadow focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20"
				>
					<label class="flex flex-1 items-center gap-2.5 pl-3.5 text-muted-foreground">
						<SearchIcon class="size-4" />
						<span class="sr-only">Search</span>
						<input
							bind:this={search_input}
							type="search"
							class="min-w-0 flex-1 bg-transparent py-2.5 pr-2 text-foreground outline-none placeholder:text-muted-foreground"
							placeholder="Search in {title}"
							bind:value={manager.search}
							oninput={manager.search_changed}
						/>
						<kbd
							class="mr-2 rounded border border-input px-1.5 font-mono text-[11px] peer-focus:hidden"
							>/</kbd
						>
					</label>
					<label class="flex border-l border-input">
						<span class="sr-only">File type</span>
						<select
							class="cursor-pointer bg-transparent px-3 text-sm font-medium outline-none"
							bind:value={manager.kind}
							onchange={() => manager.run(() => manager.list(), { quiet: true })}
						>
							{#each kinds as [value, text] (value)}<option {value}>{text}</option>{/each}
						</select>
					</label>
					<label class="flex border-l border-input">
						<span class="sr-only">Sort</span>
						<select
							class="cursor-pointer bg-transparent px-3 text-sm font-medium outline-none"
							value={manager.sort}
							onchange={(e) => manager.set_sort(e.currentTarget.value)}
						>
							{#each sorts as [value, text] (value)}<option {value}>{text}</option>{/each}
						</select>
					</label>
				</div>
				<div class="mt-4 flex items-baseline gap-3">
					<h2 class="flex-1 truncate text-base font-semibold">
						{title}
						{#if manager.assets}<span class="ml-2 text-sm font-normal text-muted-foreground"
								>{manager.total.toLocaleString()} {manager.total === 1 ? 'file' : 'files'}</span
							>{/if}
					</h2>
					{#if manager.assets?.length && (manager.multiple || selecting)}
						<button
							class="text-sm font-medium text-primary hover:underline"
							onclick={() =>
								manager.selected.size === manager.assets?.length
									? manager.selected.clear()
									: manager.select_all()}
						>
							{manager.selected.size && manager.selected.size === manager.assets.length
								? 'Select none'
								: 'Select all'}
						</button>
					{/if}
				</div>
				{#if in_trash}
					<p class="mt-1 text-sm text-muted-foreground">
						Deleted files stay here until you delete them for good. Open one to restore it.
					</p>
				{:else if manager.view.kind === 'unused'}
					<p class="mt-1 text-sm text-muted-foreground">Files no story uses, drafts included.</p>
				{/if}
			</div>

			{#if !manager.assets}
				<ul
					class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3.5 gap-y-5"
					aria-busy="true"
					aria-label="Loading"
				>
					{#each Array(15) as _, i (i)}
						<li class="grid gap-2 p-1.5">
							<span class="aspect-4/3 animate-pulse rounded-lg bg-muted"></span><span
								class="h-3 w-4/5 animate-pulse rounded bg-muted"
							></span>
						</li>
					{/each}
				</ul>
			{:else if !manager.assets.length}
				<div
					class="grid justify-items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-input px-4 py-16 text-center"
				>
					<span
						class="mb-2 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
					>
						{#if in_trash}<Trash2Icon class="size-6" />{:else}<ImagesIcon class="size-6" />{/if}
					</span>
					<p class="font-semibold">
						{manager.search || manager.kind
							? 'No files match'
							: in_trash
								? 'Nothing in the trash'
								: manager.view.kind === 'unused'
									? 'Every file is in use'
									: 'No files here yet'}
					</p>
					<p class="text-sm text-muted-foreground">
						{manager.search || manager.kind
							? 'Try another search or file type.'
							: in_trash
								? 'Files you delete show up here.'
								: manager.view.kind === 'unused'
									? 'Every file is used by at least one story.'
									: 'Drop files anywhere here, or use Upload files.'}
					</p>
				</div>
			{:else}
				<ul class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-3.5 gap-y-5">
					{#each manager.assets as asset (asset.id)}
						{@const chosen = manager.selected.has(asset.id)}
						{@const focus = focus_of(asset)}
						<li
							class="tile group relative grid gap-2 rounded-xl p-1.5 transition-colors hover:bg-muted"
							class:chosen
						>
							<button
								class="block w-full rounded-lg text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
								onclick={(e) => activate(asset, e)}
								aria-label="{selecting || manager.multiple ? 'Select' : 'Use'} {label(asset)}"
							>
								<span
									class="thumb grid aspect-4/3 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
									class:checker={may_be_clear(asset)}
								>
									{#if is_image(asset)}
										<img
											src={thumb(asset, 400)}
											alt={asset.attributes.alt ?? ''}
											loading="lazy"
											draggable="false"
											class="size-full transition-transform duration-300 group-hover:scale-[1.03] {may_be_clear(
												asset
											)
												? 'object-contain'
												: 'object-cover'}"
											style:object-position={focus ? `${focus.x}% ${focus.y}%` : 'center'}
										/>
									{:else}
										<span
											class="grid justify-items-center gap-1.5 font-mono text-xs font-semibold uppercase"
											><FileTextIcon class="size-6" strokeWidth={1.5} />.{asset.attributes.format ??
												'file'}</span
										>
									{/if}
								</span>
							</button>
							{#if !in_trash}
								<button
									class="check absolute top-3.5 left-3.5 grid size-5.5 place-items-center rounded-md border-[1.5px] border-black/25 bg-white/90 text-transparent transition-opacity"
									class:visible={selecting || manager.multiple || chosen}
									role="checkbox"
									aria-checked={chosen}
									aria-label="Select {label(asset)}"
									onclick={(e) => manager.toggle(asset, e.shiftKey)}
								>
									<CheckIcon class="size-3.5" strokeWidth={3} />
								</button>
							{/if}
							<div
								class="absolute top-3.5 right-3.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
							>
								{#if asset.links?.self && !in_trash}
									<button
										class="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur hover:bg-black/75"
										title="Copy link"
										aria-label="Copy link"
										onclick={() => manager.copy(asset.links!.self!)}
										><Link2Icon class="size-3.5" /></button
									>
								{/if}
								<button
									class="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur hover:bg-black/75"
									title="Details"
									aria-label="Details"
									onclick={() => manager.open_details(asset)}><InfoIcon class="size-3.5" /></button
								>
							</div>
							<div class="grid gap-0.5 px-1 pb-0.5">
								<p
									class="truncate text-sm font-semibold"
									title={asset.attributes.name || asset.attributes.filename}
								>
									{label(asset)}
								</p>
								<div class="flex min-h-5 items-center justify-between gap-2 text-xs">
									<span class="truncate text-muted-foreground tabular-nums">{describe(asset)}</span>
									{@render usage_tag(asset)}
								</div>
							</div>
						</li>
					{/each}
				</ul>
				{#if manager.more}
					<div
						class="flex items-center justify-center gap-2 pt-7 text-sm text-muted-foreground"
						use:infinite
					>
						{#if manager.loading_more}<LoaderCircleIcon class="size-4 animate-spin" />{/if}
						Showing {manager.assets.length.toLocaleString()} of {manager.total.toLocaleString()}
					</div>
				{/if}
			{/if}

			{#if dropping}
				<div
					class="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-1.5 rounded-xl border-2 border-dashed border-primary bg-background/85 text-primary backdrop-blur-[2px]"
				>
					<CloudUploadIcon class="size-8" />
					<strong>Drop to upload</strong>
					<span class="text-sm">to {manager.folder ? manager.folder.name : 'All assets'}</span>
				</div>
			{/if}
		</section>
	</div>
</div>

{#if selecting}
	<div
		class="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-input bg-card py-2 pr-2 pl-4 shadow-2xl"
	>
		<strong class="mr-2 whitespace-nowrap tabular-nums"
			>{manager.selected.size.toLocaleString()} selected</strong
		>
		{#if in_trash}
			<Button
				variant="outline"
				size="sm"
				onclick={() => manager.restore([...manager.selected.keys()])}
				><RotateCcwIcon /> Restore</Button
			>
			<Button
				variant="destructive"
				size="sm"
				onclick={() =>
					confirm(
						`Delete ${manager.selected.size === 1 ? 'this file' : `these ${manager.selected.size} files`} for good? This can’t be undone.`
					) && manager.destroy([...manager.selected.keys()])}><Trash2Icon /> Delete for good</Button
			>
		{:else}
			{#if manager.multiple && !replacing}
				<Button size="sm" onclick={manager.insert_selected}
					><CheckIcon /> Add {manager.selected.size === 1
						? 'file'
						: `${manager.selected.size} files`}</Button
				>
			{/if}
			<Button
				variant="outline"
				size="sm"
				onclick={() => start_move({ ids: [...manager.selected.keys()] })}
				><FolderInputIcon /> Move</Button
			>
			<Button
				variant="outline"
				size="sm"
				class="text-destructive"
				onclick={() => manager.trash([...manager.selected.keys()])}><Trash2Icon /> Delete</Button
			>
		{/if}
		<button
			class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Clear selection (Esc)"
			title="Clear selection (Esc)"
			onclick={() => manager.selected.clear()}><XIcon class="size-4" /></button
		>
	</div>
{/if}

{#if manager.uploads.length}
	{@const failed = manager.uploads.filter((u) => u.status === 'failed').length}
	{@const busy = manager.uploads.some((u) => u.status === 'uploading')}
	<div
		class="fixed right-5 bottom-5 z-30 max-h-[50dvh] w-80 overflow-auto rounded-xl border border-input bg-card shadow-2xl"
		role="status"
	>
		<header class="flex items-center justify-between border-b border-input py-2.5 pr-2.5 pl-3.5">
			<strong class="text-sm">
				{#if busy}Uploading {manager.uploads.filter((u) => u.status !== 'uploading').length + 1} of {manager
						.uploads.length}{:else if failed}{failed} upload{failed === 1 ? '' : 's'} failed{:else}Uploaded{/if}
			</strong>
			{#if !busy}<button
					class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted"
					aria-label="Dismiss"
					onclick={() => (manager.uploads = [])}><XIcon class="size-4" /></button
				>{/if}
		</header>
		<ul class="grid py-1.5">
			{#each manager.uploads as upload, i (i)}
				<li
					class="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 px-3.5 py-1.5 text-sm"
					class:text-emerald-600={upload.status === 'done'}
					class:text-destructive={upload.status === 'failed'}
				>
					<span class="truncate text-foreground" title={upload.error ?? upload.name}
						>{upload.name}</span
					>
					{#if upload.status === 'done'}<CheckIcon
							class="size-4"
						/>{:else if upload.status === 'failed'}<TriangleAlertIcon class="size-4" />{/if}
					<span class="col-span-2 h-1 overflow-hidden rounded-full bg-muted"
						><span
							class="block h-full transition-all {upload.status === 'uploading'
								? 'bg-primary'
								: 'bg-current'}"
							style:width="{upload.progress * 100}%"
						></span></span
					>
					{#if upload.error}<span class="col-span-2 text-xs">{upload.error}</span>{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<Dialog.Root open={!!moving} onOpenChange={(open) => !open && (moving = null)}>
	<Dialog.Content class="sm:max-w-md">
		{#if moving}
			<Dialog.Header>
				<Dialog.Title
					>Move {'ids' in moving
						? moving.ids.length === 1
							? '1 file'
							: `${moving.ids.length} files`
						: `“${moving.folder.name}”`}</Dialog.Title
				>
				<Dialog.Description
					>Choose where {'ids' in moving && moving.ids.length > 1
						? 'they go'
						: 'it goes'}.</Dialog.Description
				>
			</Dialog.Header>
			<ul class="grid max-h-[50dvh] overflow-auto rounded-lg border border-input p-1">
				<li>
					<button class="move-row" class:active={move_to === null} onclick={() => (move_to = null)}
						><ImagesIcon class="size-4" />{'ids' in moving ? 'No folder' : 'Top level'}</button
					>
				</li>
				{#each manager.flat as { folder, depth } (folder.id)}
					<li>
						<button
							class="move-row"
							class:active={move_to === folder.id}
							disabled={'folder' in moving && inside(moving.folder, folder.id)}
							style:padding-left="{12 + depth * 16}px"
							onclick={() => (move_to = folder.id)}
						>
							<FolderIcon class="size-4" />{folder.name}
						</button>
					</li>
				{/each}
			</ul>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (moving = null)}>Cancel</Button>
				<Button disabled={manager.busy} onclick={finish_move}>Move here</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<style>
	.row {
		align-items: center;
		border-radius: 8px;
		display: flex;
		gap: 2px;
		min-height: 34px;
		padding-right: 4px;
		transition: background 0.12s;

		&:hover {
			background: var(--muted);
		}

		&.active {
			background: color-mix(in oklab, var(--primary) 14%, transparent);
			color: var(--tertiary);
		}
	}

	.place {
		align-items: center;
		cursor: pointer;
		display: flex;
		flex: 1;
		font-weight: 500;
		gap: 10px;
		min-width: 0;
		padding: 7px 6px;
		text-align: left;
	}

	button.row.place {
		padding-left: 10px;
	}

	.tag {
		border-radius: 999px;
		flex: none;
		font-size: 11px;
		font-weight: 500;
		padding: 1px 8px;
		white-space: nowrap;
	}

	.check {
		cursor: pointer;
		opacity: 0;

		.tile:hover &,
		&.visible,
		&:focus-visible {
			opacity: 1;
		}

		&[aria-checked='true'] {
			background: var(--primary);
			border-color: var(--primary);
			color: #fff;
		}
	}

	.tile.chosen {
		background: color-mix(in oklab, var(--primary) 12%, transparent);

		& .thumb {
			outline: 2px solid var(--primary);
			outline-offset: 2px;
		}
	}

	.checker {
		background: repeating-conic-gradient(var(--muted) 0 25%, var(--card) 0 50%) 0 0 / 14px 14px;
	}

	.move-row {
		align-items: center;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		gap: 10px;
		padding: 8px 12px;
		text-align: left;
		width: 100%;

		&:hover:not(:disabled) {
			background: var(--muted);
		}

		&.active {
			background: color-mix(in oklab, var(--primary) 14%, transparent);
			color: var(--tertiary);
			font-weight: 500;
		}

		&:disabled {
			cursor: not-allowed;
			opacity: 0.4;
		}
	}
</style>
