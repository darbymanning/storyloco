<script lang="ts">
	// The field as it sits in the story: the chosen file (or a sortable list of them), or somewhere to add some.
	// Files dropped onto it are uploaded and used straight away.
	import {
		CloudUploadIcon,
		FileTextIcon,
		GripVerticalIcon,
		ImagePlusIcon,
		PencilIcon,
		PlusIcon,
		RefreshCwIcon,
		TriangleAlertIcon,
		XIcon,
	} from '@lucide/svelte'
	import { Button } from 'shared'
	import { useDragAndDrop as dnd } from 'fluid-dnd/svelte'
	import type { Asset } from '../types.js'
	import {
		describe,
		focus_of,
		is_image,
		label,
		may_be_clear,
		thumb,
		type AssetManager,
	} from './app.svelte.js'

	let { manager }: { manager: AssetManager } = $props()

	let file_input = $state<HTMLInputElement>()
	let dropping = $state(false)
	const list = $derived(Array.isArray(manager.content) ? manager.content : [])
	const uploading = $derived(manager.uploads.filter((u) => u.status === 'uploading'))

	const drop = (e: DragEvent) => {
		if (!e.dataTransfer?.types.includes('Files')) return
		e.preventDefault()
		dropping = false
		manager.upload_into_field(
			manager.multiple ? e.dataTransfer.files : [...e.dataTransfer.files].slice(0, 1)
		)
	}
</script>

{#snippet card(item: Asset, index: number | null)}
	{@const asset = item._data}
	{@const focus = focus_of(asset, item.focus ?? undefined)}
	<div
		class="group flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-input bg-card p-2 pr-1.5 transition-colors hover:border-primary/60"
	>
		<button
			class="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground"
			class:checker={may_be_clear(asset)}
			onclick={() => manager.open_details(asset, false)}
			title="Edit details"
		>
			{#if is_image(asset)}
				<img
					src={thumb(asset, 200)}
					alt={item.alt ?? ''}
					class="size-full {may_be_clear(asset) ? 'object-contain' : 'object-cover'}"
					style:object-position={focus ? `${focus.x}% ${focus.y}%` : 'center'}
				/>
			{:else}
				<FileTextIcon class="size-6" strokeWidth={1.5} />
			{/if}
		</button>
		<div class="min-w-0 flex-1">
			<p class="truncate font-medium" title={asset.attributes.filename}>{label(asset)}</p>
			<p class="truncate text-xs text-muted-foreground tabular-nums">{describe(asset)}</p>
			{#if is_image(asset) && !item.alt}
				<button
					class="mt-1 flex items-center gap-1 text-xs text-amber-600 hover:underline dark:text-amber-400"
					onclick={() => manager.open_details(asset, false)}
				>
					<TriangleAlertIcon class="size-3.5" /> No alt text
				</button>
			{:else if item.alt}
				<p class="mt-0.5 truncate text-xs text-muted-foreground" title={item.alt}>
					Alt: {item.alt}
				</p>
			{/if}
		</div>
		<div
			class="flex shrink-0 items-center opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
		>
			<button
				class="icon"
				title="Edit details"
				aria-label="Edit details"
				onclick={() => manager.open_details(asset, false)}
			>
				<PencilIcon class="size-4" />
			</button>
			<button
				class="icon"
				title="Replace"
				aria-label="Replace"
				onclick={() => manager.open_picker(index)}
			>
				<RefreshCwIcon class="size-4" />
			</button>
			<button
				class="icon danger"
				title="Remove"
				aria-label="Remove"
				onclick={() => manager.remove(asset.id)}
			>
				<XIcon class="size-4" />
			</button>
		</div>
	</div>
{/snippet}

{#snippet progress()}
	{#if uploading.length}
		{@const done = manager.uploads.filter((u) => u.status !== 'uploading').length}
		<div class="flex items-center gap-2 text-xs text-muted-foreground">
			<span>Uploading {done + 1} of {manager.uploads.length}…</span>
			<span class="h-1 flex-1 overflow-hidden rounded-full bg-muted">
				<span
					class="block h-full bg-primary transition-all"
					style:width="{(uploading[0]?.progress ?? 0) * 100}%"
				></span>
			</span>
		</div>
	{/if}
{/snippet}

<input
	bind:this={file_input}
	class="sr-only"
	type="file"
	multiple={manager.multiple}
	aria-label="Upload files"
	onchange={(e) => {
		const input = e.currentTarget
		manager.upload_into_field(input.files).then(() => (input.value = ''))
	}}
/>

<div
	class="grid gap-2 rounded-lg transition-shadow"
	class:ring-2={dropping}
	class:ring-primary={dropping}
	role="group"
	aria-label="Assets"
	ondragover={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return
		e.preventDefault()
		dropping = true
	}}
	ondragleave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (dropping = false)}
	ondrop={drop}
>
	{#if manager.multiple && list.length}
		{@const [sortable] = dnd(manager.content as Array<Asset>, {
			onDragEnd: manager.update,
			handlerSelector: '.handle',
		})}
		<div class="grid gap-1.5" use:sortable>
			{#each list as item, index (item.id)}
				<div class="flex items-center gap-1" data-index={index}>
					<button
						class="handle grid h-10 w-5 shrink-0 cursor-grab place-items-center text-muted-foreground"
						aria-label="Drag to reorder"
					>
						<GripVerticalIcon class="size-4" />
					</button>
					{@render card(item, index)}
				</div>
			{/each}
		</div>
		<div class="flex items-center gap-2 pl-6">
			<Button variant="secondary" size="sm" onclick={() => manager.open_picker()}
				><PlusIcon /> Add assets</Button
			>
			<Button variant="ghost" size="sm" onclick={() => file_input?.click()}
				><CloudUploadIcon /> Upload</Button
			>
			<span class="ml-auto text-xs text-muted-foreground"
				>{list.length} {list.length === 1 ? 'file' : 'files'}</span
			>
		</div>
	{:else if !manager.multiple && manager.content && !Array.isArray(manager.content)}
		{@render card(manager.content, null)}
	{:else}
		<div
			class="flex items-center gap-3 rounded-lg border border-dashed border-input bg-input-background p-3 transition-colors"
			class:border-primary={dropping}
		>
			<span
				class="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
			>
				<ImagePlusIcon class="size-5" strokeWidth={1.75} />
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-medium">{manager.multiple ? 'Add assets' : 'Add an asset'}</p>
				<p class="text-xs text-muted-foreground">
					Drop {manager.multiple ? 'files' : 'a file'} here, or choose from the library
				</p>
			</div>
			<Button variant="ghost" size="sm" onclick={() => file_input?.click()}
				><CloudUploadIcon /> Upload</Button
			>
			<Button size="sm" onclick={() => manager.open_picker()}>Choose</Button>
		</div>
	{/if}
	{@render progress()}
</div>

<style>
	.icon {
		border-radius: 6px;
		color: var(--muted-foreground);
		cursor: pointer;
		display: grid;
		padding: 6px;
		place-items: center;
		transition:
			background 0.15s,
			color 0.15s;

		&:hover {
			background: var(--muted);
			color: var(--foreground);
		}

		&.danger:hover {
			color: var(--destructive);
		}
	}

	/* see-through images read on a checkerboard, in both themes */
	.checker {
		background: repeating-conic-gradient(var(--muted) 0 25%, var(--card) 0 50%) 0 0 / 12px 12px;
	}
</style>
