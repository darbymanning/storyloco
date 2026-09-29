<script lang="ts">
	// One file, in Storyblok's split layout: a big preview (click to set the focus point, with crop previews) and its
	// details beside it. Saving updates the file everywhere and this field's copy of it.
	import {
		ArrowLeftIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		CrosshairIcon,
		ExternalLinkIcon,
		FileTextIcon,
		Link2Icon,
		RotateCcwIcon,
		Trash2Icon,
		XIcon,
	} from '@lucide/svelte'
	import { Button } from 'shared'
	import type { R2Asset } from '../r2.js'
	import {
		extension,
		focus_of,
		is_image,
		is_svg,
		label,
		may_be_clear,
		size,
		thumb,
		type AssetManager,
	} from './app.svelte.js'

	let { manager, asset }: { manager: AssetManager; asset: R2Asset } = $props()

	const blank = (a: R2Asset) => ({
		name: a.attributes.name ?? '',
		alt: a.attributes.alt ?? '',
		title: a.attributes.title ?? '',
		copyright: a.attributes.copyright ?? '',
		source: a.attributes.source ?? '',
		focus: a.attributes.focus ?? '',
		folder: '',
	})
	// svelte-ignore state_referenced_locally
	let form = $state(blank(asset))
	// svelte-ignore state_referenced_locally
	let initial = JSON.stringify(blank(asset))
	let tab = $state<'details' | 'used'>('details')
	let sharp = $state(false)

	const in_trash = $derived(manager.view.kind === 'trash' && manager.details_from_picker)
	const dirty = $derived(JSON.stringify(form) !== initial)
	const used = $derived(manager.usage[asset.id])
	const focus = $derived(focus_of(asset, form.focus))
	const focusable = $derived(is_image(asset) && !is_svg(asset) && !in_trash)
	const ratio = $derived(
		asset.attributes.width && asset.attributes.height
			? asset.attributes.width / asset.attributes.height
			: null
	)
	// previous/next only make sense among the files the browser showed
	const list = $derived(manager.details_from_picker ? (manager.assets ?? []) : [])
	const index = $derived(list.findIndex((a) => a.id === asset.id))

	// the grid's thumbnail shows at once, sized to the final frame; the sharp one swaps in once loaded
	$effect(() => {
		sharp = false
		if (!is_image(asset)) return
		const id = asset.id
		const img = new Image()
		img.onload = () => asset.id === id && (sharp = true)
		img.src = thumb(asset, 1600)
	})

	const leave = () => !dirty || confirm('Discard your changes to this file?')
	const close = () => leave() && manager.close_details()
	const step = (by: number) => {
		const next = list[index + by]
		// the view remounts for each file, so its form starts fresh
		if (next && leave()) manager.open_details(next, true)
	}

	const save = async () => {
		if (!dirty) return
		const { folder, ...fields } = form
		const ok = await manager.save(
			asset,
			{
				...fields,
				...(folder ? { folder_id: folder === 'none' ? null : folder } : {}),
			},
			{ quiet: !manager.details_from_picker }
		)
		if (ok) {
			initial = JSON.stringify(form)
			manager.close_details()
		}
	}

	// in the original image's pixels, which is what the resizer crops around
	const set_focus = (e: MouseEvent) => {
		const img = e.currentTarget as HTMLImageElement
		const { width, height } = asset.attributes
		if (!focusable || !width || !height) return
		const x = Math.round((e.offsetX / img.clientWidth) * width)
		const y = Math.round((e.offsetY / img.clientHeight) * height)
		form.focus = `${x}x${y}:${x + 1}x${y + 1}`
	}

	const keys = (e: KeyboardEvent) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault()
			save()
		}
		if ((e.target as HTMLElement).closest('input, textarea, select')) return
		if (e.key === 'Escape') close()
		if (e.key === 'ArrowLeft') step(-1)
		if (e.key === 'ArrowRight') step(1)
	}
</script>

<svelte:window onkeydown={keys} />

<div
	class="grid h-dvh grid-cols-[minmax(0,1fr)_380px] bg-background text-foreground max-[860px]:grid-cols-1"
>
	<section class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
		<header class="flex items-center gap-4 px-7 pt-5 pb-3">
			{#if manager.details_from_picker}
				<button
					class="icon"
					title="Back to the library"
					aria-label="Back to the library"
					onclick={close}><ArrowLeftIcon class="size-5" /></button
				>
			{/if}
			<h2 class="min-w-0 flex-1 truncate text-xl font-semibold" title={asset.attributes.filename}>
				{label(asset)}<span class="ml-1 text-base font-normal text-muted-foreground"
					>.{extension(asset)}</span
				>
			</h2>
			{#if list.length > 1}
				<nav
					class="flex shrink-0 items-center gap-1 text-sm text-muted-foreground tabular-nums"
					aria-label="Browse files"
				>
					<button
						class="icon"
						disabled={index <= 0}
						title="Previous (←)"
						aria-label="Previous"
						onclick={() => step(-1)}><ChevronLeftIcon class="size-5" /></button
					>
					{index + 1} of {manager.total.toLocaleString()}
					<button
						class="icon"
						disabled={index >= list.length - 1}
						title="Next (→)"
						aria-label="Next"
						onclick={() => step(1)}><ChevronRightIcon class="size-5" /></button
					>
				</nav>
			{/if}
		</header>

		<div
			class="mx-7 grid min-h-0 place-items-center overflow-hidden rounded-xl bg-muted"
			class:checker={may_be_clear(asset)}
		>
			{#if is_image(asset)}
				<div
					class="relative leading-none"
					style:aspect-ratio={ratio}
					style:width="min(100%, calc((100dvh - 250px) * {ratio ?? 1}))"
				>
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<img
						src={sharp ? thumb(asset, 1600) : thumb(asset, 400)}
						alt={form.alt}
						class="block size-full object-contain"
						class:cursor-crosshair={focusable}
						draggable="false"
						onclick={set_focus}
					/>
					{#if focus && focusable}
						<span class="marker" style:left="{focus.x}%" style:top="{focus.y}%"></span>
					{/if}
				</div>
			{:else}
				<span class="grid justify-items-center gap-2 font-mono text-sm text-muted-foreground"
					><FileTextIcon class="size-10" strokeWidth={1.25} />.{extension(asset)}</span
				>
			{/if}
		</div>

		<footer
			class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t border-border px-7 pt-3.5 pb-4"
		>
			<dl class="flex flex-wrap gap-x-7 gap-y-2 text-sm">
				{#if asset.attributes.width}<div>
						<dt class="text-xs text-muted-foreground">Width &amp; height</dt>
						<dd class="font-medium tabular-nums">
							{asset.attributes.width} × {asset.attributes.height}
						</dd>
					</div>{/if}
				<div>
					<dt class="text-xs text-muted-foreground">Size</dt>
					<dd class="font-medium tabular-nums">{size(asset.attributes.size_bytes)}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Format</dt>
					<dd class="font-medium">.{extension(asset)}</dd>
				</div>
				<!-- files picked by the old asset-plus field were saved without a date -->
				{#if asset.attributes.created_at}<div>
						<dt class="text-xs text-muted-foreground">Added</dt>
						<dd class="font-medium">
							{new Date(asset.attributes.created_at).toLocaleDateString(undefined, {
								day: 'numeric',
								month: 'short',
								year: 'numeric',
							})}
						</dd>
					</div>{/if}
			</dl>
			{#if focusable}
				<div class="flex items-end gap-2.5" aria-label="How crops will look">
					{#each [['1 / 1', '1:1'], ['4 / 3', '4:3'], ['16 / 9', '16:9'], ['3 / 4', '3:4']] as [aspect, name] (name)}
						<figure class="grid justify-items-center gap-1">
							<img
								src={thumb(asset, 400)}
								alt=""
								class="h-12 w-auto rounded object-cover transition-[object-position] duration-300"
								style:aspect-ratio={aspect}
								style:object-position={focus ? `${focus.x}% ${focus.y}%` : 'center'}
							/>
							<figcaption class="text-[11px] text-muted-foreground">{name}</figcaption>
						</figure>
					{/each}
				</div>
			{/if}
		</footer>
	</section>

	<aside class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-l border-border bg-card">
		<header class="px-5 pt-3.5">
			<div class="flex justify-end gap-0.5">
				{#if asset.links?.self}
					<button
						class="icon"
						title="Copy link"
						aria-label="Copy link"
						onclick={() => manager.copy(asset.links!.self!)}><Link2Icon class="size-4.5" /></button
					>
					<a
						class="icon"
						title="Open in a new tab"
						aria-label="Open in a new tab"
						href={asset.links.self}
						target="_blank"
						rel="noreferrer"><ExternalLinkIcon class="size-4.5" /></a
					>
				{/if}
				{#if !in_trash}
					<button
						class="icon danger"
						title="Move to the trash"
						aria-label="Move to the trash"
						onclick={() => {
							const n = used?.length
							if (
								n &&
								!confirm(
									`This is used in ${n} ${n === 1 ? 'story' : 'stories'}. Move it to the trash anyway?`
								)
							)
								return
							manager.trash([asset.id]).then(manager.close_details)
						}}><Trash2Icon class="size-4.5" /></button
					>
				{/if}
				<button class="icon" title="Close (Esc)" aria-label="Close" onclick={close}
					><XIcon class="size-5" /></button
				>
			</div>
			<div class="mt-1.5 flex gap-4.5 border-b border-border" role="tablist">
				<button
					class="tab"
					role="tab"
					aria-selected={tab === 'details'}
					onclick={() => (tab = 'details')}>Details</button
				>
				{#if manager.indexed}
					<button
						class="tab"
						role="tab"
						aria-selected={tab === 'used'}
						onclick={() => (tab = 'used')}
					>
						Used in {#if used}<span
								class="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground"
								>{used.length}</span
							>{/if}
					</button>
				{/if}
			</div>
		</header>

		<div class="overflow-y-auto px-5 py-4.5">
			{#if tab === 'used'}
				{#if used === undefined}
					<p class="text-sm text-muted-foreground">Looking through your stories…</p>
				{:else if !used.length}
					<div class="rounded-lg bg-muted p-4 text-sm">
						<p class="font-semibold">Not used in any story</p>
						<p class="text-muted-foreground">Nothing links to this file, so it’s safe to delete.</p>
					</div>
				{:else}
					<ul class="grid gap-0.5">
						{#each used as story (story.id)}
							<li>
								<a
									class="grid gap-0.5 rounded-lg px-2.5 py-2 hover:bg-muted"
									target="_top"
									href="https://app.storyblok.com/#/me/spaces/{manager.plugin?.data
										?.spaceId}/stories/0/0/{story.id}"
									><strong class="font-medium text-tertiary">{story.name}</strong><span
										class="truncate text-xs text-muted-foreground">/{story.slug}</span
									></a
								>
							</li>
						{/each}
					</ul>
				{/if}
			{:else if in_trash}
				<div class="rounded-lg bg-muted p-4 text-sm">
					<p class="font-semibold">This file is in the trash</p>
					<p class="text-muted-foreground">Restore it to use it again, or delete it for good.</p>
				</div>
			{:else}
				<form
					id="asset-form"
					class="grid gap-4"
					onsubmit={(e) => {
						e.preventDefault()
						save()
					}}
				>
					<label class="field"
						><span>Name</span><input
							bind:value={form.name}
							placeholder={asset.attributes.filename}
						/></label
					>
					<label class="field">
						<span class="flex justify-between"
							>Alt text <em class="text-xs text-muted-foreground not-italic tabular-nums"
								>{form.alt.length}/125</em
							></span
						>
						<textarea
							bind:value={form.alt}
							rows="3"
							placeholder="Describe the image for people who can’t see it"
						></textarea>
					</label>
					<label class="field"><span>Title / caption</span><input bind:value={form.title} /></label>
					<div class="grid grid-cols-2 gap-3">
						<label class="field"
							><span>Copyright</span><input
								bind:value={form.copyright}
								placeholder="© 2026 …"
							/></label
						>
						<label class="field"><span>Source</span><input bind:value={form.source} /></label>
					</div>
					<label class="field">
						<span>Folder</span>
						<select bind:value={form.folder}>
							<option value="">Keep where it is</option>
							<option value="none">No folder</option>
							{#each manager.flat as { folder, path } (folder.id)}<option value={folder.id}
									>{path}</option
								>{/each}
						</select>
					</label>
					{#if focusable}
						<p class="flex items-center gap-2 text-sm text-muted-foreground">
							<CrosshairIcon class="size-4" />
							{form.focus
								? 'Focus point set. Crops keep it in view.'
								: 'Click the image to set a focus point.'}
							{#if form.focus}<button
									type="button"
									class="font-medium text-tertiary hover:underline"
									onclick={() => (form.focus = '')}>Clear</button
								>{/if}
						</p>
					{/if}
				</form>
			{/if}
		</div>

		<footer class="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
			{#if in_trash}
				<Button
					variant="destructive"
					disabled={manager.busy}
					onclick={() =>
						confirm('Delete this file for good? This can’t be undone.') &&
						manager.destroy([asset.id]).then(manager.close_details)}>Delete for good</Button
				>
				<Button
					disabled={manager.busy}
					onclick={() => manager.restore([asset.id]).then(manager.close_details)}
					><RotateCcwIcon /> Restore</Button
				>
			{:else}
				<span class="mr-auto text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : ''}</span>
				<Button variant="outline" onclick={close}>Cancel</Button>
				<Button type="submit" form="asset-form" disabled={!dirty || manager.busy} title="Save (⌘S)"
					>{manager.busy ? 'Saving…' : 'Save & close'}</Button
				>
			{/if}
		</footer>
	</aside>
</div>

<style>
	.icon {
		border-radius: 8px;
		color: var(--muted-foreground);
		cursor: pointer;
		display: grid;
		padding: 7px;
		place-items: center;
		transition:
			background 0.15s,
			color 0.15s;

		&:hover:not(:disabled) {
			background: var(--muted);
			color: var(--foreground);
		}

		&.danger:hover {
			color: var(--destructive);
		}

		&:disabled {
			cursor: default;
			opacity: 0.35;
		}
	}

	.tab {
		align-items: center;
		border-bottom: 2px solid transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		display: flex;
		font-weight: 500;
		gap: 6px;
		margin-bottom: -1px;
		padding: 8px 0 10px;

		&[aria-selected='true'] {
			border-color: var(--tertiary);
			color: var(--tertiary);
		}
	}

	.field {
		display: grid;
		gap: 6px;

		& > span {
			font-size: 13px;
			font-weight: 500;
		}

		& :is(input, textarea, select) {
			background: var(--input-background);
			border: 1px solid var(--input);
			border-radius: 8px;
			color: var(--foreground);
			font: inherit;
			padding: 8px 12px;
			transition:
				border-color 0.15s,
				box-shadow 0.15s;

			&:focus {
				border-color: var(--primary);
				box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 20%, transparent);
				outline: none;
			}
		}

		& textarea {
			resize: vertical;
		}
	}

	.marker {
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow:
			0 0 0 2px rgb(0 0 0 / 0.45),
			0 2px 10px rgb(0 0 0 / 0.4);
		height: 26px;
		pointer-events: none;
		position: absolute;
		transition:
			left 0.18s,
			top 0.18s;
		translate: -50% -50%;
		width: 26px;

		&::after {
			background: #fff;
			border-radius: 50%;
			content: '';
			height: 4px;
			inset: 0;
			margin: auto;
			position: absolute;
			width: 4px;
		}
	}

	.checker {
		background: repeating-conic-gradient(var(--muted) 0 25%, var(--card) 0 50%) 0 0 / 18px 18px;
	}
</style>
