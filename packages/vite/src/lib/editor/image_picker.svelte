<script lang="ts">
	import { untrack } from "svelte"
	import type { Asset } from "./server.js"

	type Current = {
		id?: number | null
		filename?: string | null
		alt?: string | null
		focus?: string | null
	}
	type Choice = { asset: number; alt: string; focus: string; filename: string }
	type Folder = { id: number; name: string; parent: number | null }

	let {
		current,
		images = true,
		list,
		folders,
		put,
		save,
		close,
		suggest,
	}: {
		current: Current
		/** Only images, as an image field takes; otherwise any file */
		images?: boolean
		list: (search: string, page: number, folder?: number) => Promise<{ assets: Array<Asset> }>
		/** The library's folders, to browse and upload into */
		folders?: () => Promise<{ folders: Array<Folder> }>
		/** A file added to the library, in this folder */
		put: (file: File, folder?: number) => Promise<Asset>
		save: (choice: Choice) => Promise<string | null>
		close: () => void
		/** Alt text written for the image, by AI */
		suggest?: (filename: string) => Promise<string>
	} = $props()

	const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)$/i
	const PER_PAGE = 48

	let dialog: HTMLDialogElement
	// the field as it was when the picker opened; the picker only edits its own copy
	const start = untrack(() => current)
	let chosen = $state({ id: start.id ?? 0, filename: start.filename ?? "" })
	let alt = $state(start.alt ?? "")
	let focus = $state(start.focus ?? "")
	let measured = $state<{ filename: string; width: number; height: number } | null>(null)

	let search = $state("")
	let tree = $state<Array<Folder>>([])
	let folder = $state<number | null>(null)
	/** The folders shown open in the tree */
	let opened = $state<Array<number>>([])
	const children_of = (parent: number | null) =>
		tree.filter((f) => f.parent === parent).sort((a, b) => a.name.localeCompare(b.name))
	let assets = $state<Array<Asset>>([])
	let page = $state(1)
	let more = $state(false)
	let loading = $state(false)
	let uploading = $state(0)
	let saving = $state(false)
	let dragging = $state(false)
	let problem = $state<string | null>(null)
	let suggesting = $state(false)

	async function suggest_alt() {
		if (!suggest || !chosen.filename) return
		suggesting = true
		problem = null
		try {
			alt = await suggest(chosen.filename)
		} catch (e) {
			problem = (e as Error).message
		} finally {
			suggesting = false
		}
	}

	/** The image service only resizes rasters */
	const thumb = (filename: string, width: number) =>
		/\.svg$/i.test(filename) ? filename : `${filename}/m/${width}x0`

	/** Where the focus point sits on the preview, as percentages */
	const marker = $derived.by(() => {
		const match = focus.match(/^(\d+)x(\d+):(\d+)x(\d+)$/)
		if (!match || !size) return null
		const [x1, y1, x2, y2] = match.slice(1).map(Number)
		return {
			x: (((x1 + x2) / 2) * 100) / size.width,
			y: (((y1 + y2) / 2) * 100) / size.height,
		}
	})

	/** Focus points are in the original's pixels, which newer asset URLs don't spell out */
	const size = $derived.by(() => {
		const named = chosen.filename.match(/\/(\d+)x(\d+)\//)
		if (named) return { width: Number(named[1]), height: Number(named[2]) }
		return measured?.filename === chosen.filename ? measured : null
	})

	function measure(filename: string) {
		if (!filename || /\/\d+x\d+\//.test(filename)) return
		const probe = new Image()
		probe.onload = () =>
			(measured = { filename, width: probe.naturalWidth, height: probe.naturalHeight })
		probe.src = filename
	}

	async function load(next = 1) {
		loading = true
		try {
			const { assets: found } = await list(search.trim(), next, folder ?? undefined)
			const usable = images ? found.filter((asset) => IMAGE.test(asset.filename)) : found
			assets = next === 1 ? usable : [...assets, ...usable]
			page = next
			more = found.length === PER_PAGE
		} catch (e) {
			problem = (e as Error).message
		} finally {
			loading = false
		}
	}

	function browse(to: number | null) {
		folder = to
		if (to !== null && !opened.includes(to)) opened.push(to)
		load()
	}

	function toggle(id: number) {
		opened = opened.includes(id) ? opened.filter((open) => open !== id) : [...opened, id]
	}

	let typing: ReturnType<typeof setTimeout> | undefined
	function searched() {
		clearTimeout(typing)
		typing = setTimeout(() => load(), 250)
	}

	function choose(asset: Asset) {
		chosen = { id: asset.id, filename: asset.filename }
		measure(asset.filename)
		alt = asset.alt
		focus = asset.focus
	}

	function place(event: MouseEvent) {
		if (!size) return
		const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
		const x = Math.round(((event.clientX - box.left) / box.width) * size.width)
		const y = Math.round(((event.clientY - box.top) / box.height) * size.height)
		focus = `${x}x${y}:${x + 1}x${y + 1}`
	}

	async function add(files: FileList | null | undefined) {
		for (const file of Array.from(files ?? [])) {
			if (images && !file.type.startsWith("image/")) {
				problem = `${file.name} isn’t an image`
				continue
			}
			uploading++
			problem = null
			try {
				const asset = await put(file, folder ?? undefined)
				assets = [asset, ...assets.filter(({ id }) => id !== asset.id)]
				choose(asset)
			} catch (e) {
				problem = `${file.name} didn’t upload: ${(e as Error).message}`
			} finally {
				uploading--
			}
		}
	}

	async function done() {
		if (!chosen.id) return
		saving = true
		problem = await save({ asset: chosen.id, alt: alt.trim(), focus, filename: chosen.filename })
		saving = false
		if (!problem) dialog.close()
	}

	// an attachment re-runs when what it reads changes, and this should only ever open once
	function open(node: HTMLDialogElement) {
		untrack(() => {
			dialog = node
			node.showModal()
			measure(chosen.filename)
			load()
			// a moxy without folders yet leaves the library as one list
			folders?.()
				.then((found) => (tree = found.folders))
				.catch(() => {})
		})
	}
</script>

{#snippet Branch(parent: number | null)}
	<ul>
		{#each children_of(parent) as child (child.id)}
			{@const nested = children_of(child.id).length > 0}
			{@const expanded = opened.includes(child.id)}
			<li>
				<div class="row">
					{#if nested}
						<button
							class="twisty"
							type="button"
							aria-label="{expanded ? 'Close' : 'Open'} {child.name}"
							aria-expanded={expanded}
							onclick={() => toggle(child.id)}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg
							>
						</button>
					{/if}
					<button
						class="folder"
						type="button"
						aria-current={folder === child.id ? "true" : undefined}
						onclick={() => browse(child.id)}
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><path
								d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
							/></svg
						>
						<span>{child.name}</span>
					</button>
				</div>
				{#if nested && expanded}{@render Branch(child.id)}{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<dialog
	{@attach open}
	class="picker"
	data-storyloco="picker"
	class:dragging
	aria-labelledby="storyloco-picker-title"
	onclose={close}
	onclick={(e) => e.target === dialog && dialog.close()}
	ondragover={(e) => {
		e.preventDefault()
		dragging = true
	}}
	ondragleave={(e) => e.target === dialog && (dragging = false)}
	ondrop={(e) => {
		e.preventDefault()
		dragging = false
		add(e.dataTransfer?.files)
	}}
>
	<div class="frame">
		<header>
			<h2 id="storyloco-picker-title">
				{images ? (start.filename ? "Replace image" : "Choose an image") : "Choose a file"}
			</h2>
			<button class="round" type="button" aria-label="Close" onclick={() => dialog.close()}>
				<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M18 6 6 18M6 6l12 12" />
				</svg>
			</button>
		</header>

		<div class={["body", { "with-tree": tree.length > 0 }]}>
			{#if tree.length}
				<nav class="tree" aria-label="Folders">
					<div class="row">
						<button
							class="folder"
							type="button"
							aria-current={folder === null ? "true" : undefined}
							onclick={() => browse(null)}
						>
							<svg
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								><rect x="3" y="3" width="18" height="18" rx="2" /><circle
									cx="9"
									cy="9"
									r="2"
								/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg
							>
							<span>All images</span>
						</button>
					</div>
					{@render Branch(null)}
				</nav>
			{/if}

			<section class="library">
				<div class="tools">
					<input
						type="search"
						placeholder="Search the library"
						aria-label="Search the library"
						bind:value={search}
						oninput={searched}
					/>
					<label class="button">
						<input
							type="file"
							accept={images ? "image/*" : undefined}
							multiple
							onchange={(e) => {
								add(e.currentTarget.files)
								e.currentTarget.value = ""
							}}
						/>
						{uploading ? "Uploading…" : "Upload"}
					</label>
				</div>

				<ul class="grid" aria-busy={loading}>
					{#each assets as asset (asset.id)}
						<li>
							<button
								type="button"
								class:selected={asset.id === chosen.id}
								aria-pressed={asset.id === chosen.id}
								title={asset.alt || asset.filename.split("/").pop()}
								onclick={() => choose(asset)}
							>
								{#if IMAGE.test(asset.filename)}
									<img src={thumb(asset.filename, 240)} alt={asset.alt} loading="lazy" />
								{:else}
									<span class="document">{asset.filename.split("/").pop()}</span>
								{/if}
							</button>
						</li>
					{:else}
						{#if !loading}
							<li class="empty">
								{search
									? "No images match"
									: folder
										? "No images in this folder. Drop one here to upload it into it."
										: "No images yet. Drop one here to upload it."}
							</li>
						{/if}
					{/each}
				</ul>
				{#if more}
					<button
						class="button wide"
						type="button"
						disabled={loading}
						onclick={() => load(page + 1)}>More</button
					>
				{/if}
			</section>

			<section class="chosen">
				{#if chosen.filename && !IMAGE.test(chosen.filename)}
					<p class="document">{chosen.filename.split("/").pop()}</p>
				{:else if chosen.filename}
					<button
						class="preview"
						type="button"
						aria-label="Set the focus point"
						title="Click where the image should stay in view when it’s cropped"
						onclick={place}
					>
						<img src={thumb(chosen.filename, 800)} alt="" />
						{#if marker}
							<span class="focus" style:left="{marker.x}%" style:top="{marker.y}%"></span>
						{/if}
					</button>
				{/if}
				{#if chosen.filename}
					<p class="meta">
						<span class="name">{chosen.filename.split("/").pop()}</span>
						{#if size}<span>{size.width} × {size.height}</span>{/if}
					</p>
				{/if}
				<p class="hint" hidden={!IMAGE.test(chosen.filename)}>
					{#if focus}
						Crops keep the point you clicked in view.
						<button class="link" type="button" onclick={() => (focus = "")}>Clear it</button>
					{:else}
						Click the image to choose what stays in view when it’s cropped.
					{/if}
				</p>

				<label>
					<span>Alt text</span>
					<textarea
						rows="3"
						bind:value={alt}
						placeholder="What the image shows, for people who can’t see it"></textarea>
				</label>
				{#if suggest && IMAGE.test(chosen.filename) && !/\.svg$/i.test(chosen.filename)}
					<p class="hint">
						<button class="link" type="button" disabled={suggesting} onclick={suggest_alt}>
							{suggesting ? "Looking at the image…" : alt ? "Suggest another" : "Suggest alt text"}
						</button>
						· check it says what matters here
					</p>
				{/if}
			</section>
		</div>

		<footer>
			{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			<button class="button" type="button" onclick={() => dialog.close()}>Cancel</button>
			<button
				class="button primary"
				type="button"
				disabled={!chosen.id || saving || uploading > 0}
				onclick={done}>{saving ? "Saving…" : images ? "Use image" : "Use file"}</button
			>
		</footer>
	</div>
</dialog>

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.picker) :not(svg, svg *) {
		all: revert;
	}

	.picker {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--editor-bg, #fff);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--danger: var(--editor-danger, #e5484d);
		--font: var(--editor-font, 500 0.8125rem/1.25 system-ui, sans-serif);

		background: var(--bg);
		border: 0;
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 24px 64px rgb(0 0 0 / 0.25);
		color: var(--ink);
		font: var(--font);
		/* A set height, so searching doesn't make the dialog jump */
		block-size: min(44rem, 100dvh - 2rem);
		inline-size: min(74rem, 100vw - 2rem);
		padding: 0;

		&::backdrop {
			backdrop-filter: blur(2px);
			background: rgb(10 12 20 / 0.45);
		}

		&.dragging .library {
			outline: 2px dashed var(--accent);
			outline-offset: -0.5rem;
		}

		& * {
			box-sizing: border-box;
		}
	}

	.frame {
		display: grid;
		block-size: 100%;
		grid-template-rows: auto minmax(0, 1fr) auto;
	}

	header,
	footer {
		align-items: center;
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem 0.75rem 1.25rem;
	}

	header {
		border-block-end: 1px solid var(--line);
		justify-content: space-between;

		& h2 {
			font: inherit;
			font-size: 1rem;
			margin: 0;
		}
	}

	footer {
		border-block-start: 1px solid var(--line);
		justify-content: flex-end;
		padding-inline-end: 1.25rem;
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 19rem);
		min-block-size: 0;

		&.with-tree {
			grid-template-columns: minmax(0, 13rem) minmax(0, 1fr) minmax(0, 19rem);
		}

		@media (width < 48rem) {
			&,
			&.with-tree {
				grid-template-columns: minmax(0, 1fr);
				overflow: auto;
			}
		}
	}

	/* The space's folders, as Storyblok's own asset manager shows them */
	.tree {
		border-inline-end: 1px solid var(--line);
		overflow: auto;
		padding: 0.75rem 0.5rem;

		& ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}

		& ul ul {
			padding-inline-start: 0.875rem;
		}

		& li::before {
			content: none;
		}

		@media (width < 48rem) {
			border-block-end: 1px solid var(--line);
			border-inline-end: 0;
			max-block-size: 10rem;
		}
	}

	.row {
		align-items: center;
		display: grid;
		grid-template-columns: 1.25rem minmax(0, 1fr);
	}

	.twisty {
		background: none;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		display: grid;
		padding: 0.25rem;
		place-items: center;

		& svg {
			transition: rotate 0.15s ease;
		}

		&[aria-expanded="true"] svg {
			rotate: 90deg;
		}
	}

	.folder {
		align-items: center;
		background: none;
		border: 0;
		border-radius: 0.375rem;
		color: inherit;
		cursor: pointer;
		display: flex;
		font: inherit;
		gap: 0.5rem;
		grid-column: 2;
		padding: 0.375rem 0.5rem;
		text-align: start;

		& svg {
			color: var(--muted);
			flex: none;
		}

		& span {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&:hover {
			background: color-mix(in srgb, var(--ink) 6%, transparent);
		}

		&[aria-current] {
			background: color-mix(in srgb, var(--accent) 16%, transparent);

			& svg {
				color: var(--accent);
			}
		}
	}

	.meta {
		color: var(--muted);
		display: flex;
		font-size: 0.75rem;
		gap: 0.5rem;
		justify-content: space-between;
		margin: 0;

		& .name {
			color: var(--ink);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.chosen {
		border-inline-start: 1px solid var(--line);
		display: grid;
		/* the file name truncates rather than widening it */
		grid-template-columns: minmax(0, 1fr);
		overflow: auto;
		padding: 1.25rem;
		gap: 0.75rem;
		align-content: start;

		& label {
			display: grid;
			gap: 0.375rem;
		}
	}

	.preview {
		background: repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 0 0 / 16px 16px;
		border: 0;
		border-radius: 0.5rem;
		cursor: crosshair;
		display: block;
		justify-self: center;
		padding: 0;
		position: relative;

		& img {
			border-radius: inherit;
			display: block;
			max-block-size: 16rem;
			max-inline-size: 100%;
		}
	}

	.document {
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		border-radius: 0.5rem;
		display: grid;
		font-size: 0.75rem;
		block-size: 100%;
		overflow-wrap: anywhere;
		padding: 0.5rem;
		place-items: center;
		text-align: center;
	}

	.focus {
		block-size: 1.25rem;
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow:
			0 0 0 1px rgb(0 0 0 / 0.4),
			0 1px 4px rgb(0 0 0 / 0.4);
		inline-size: 1.25rem;
		pointer-events: none;
		position: absolute;
		translate: -50% -50%;
	}

	.hint {
		color: var(--muted);
		font-size: 0.75rem;
		margin: 0;
	}

	.link {
		background: none;
		border: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		padding: 0;
		text-decoration: underline;
	}

	input[type="search"],
	textarea {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		color: inherit;
		font: inherit;
		inline-size: 100%;
		padding: 0.5rem 0.625rem;
		resize: vertical;

		&:focus-visible {
			border-color: var(--accent);
			outline: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
		}
	}

	.library {
		padding: 1.25rem;
		display: grid;
		gap: 0.75rem;
		grid-template-rows: auto minmax(0, 1fr);
		min-block-size: 0;
	}

	.tools {
		display: flex;
		gap: 0.5rem;

		& input[type="file"] {
			display: none;
		}
	}

	.grid {
		align-content: start;
		display: grid;
		gap: 0.5rem;
		grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
		list-style: none;
		margin: 0;
		min-block-size: 12rem;
		overflow: auto;
		padding: 2px;

		& li::before {
			content: none;
		}

		& button {
			aspect-ratio: 1;
			/* light whatever the editor's scheme, so a dark logo on nothing still shows */
			background: repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 0 0 / 12px 12px;
			border: 0;
			border-radius: 0.5rem;
			cursor: pointer;
			display: block;
			inline-size: 100%;
			outline: 2px solid transparent;
			outline-offset: 1px;
			padding: 0;

			&:hover {
				outline-color: var(--line);
			}

			&.selected {
				outline-color: var(--accent);
			}
		}

		& img {
			block-size: 100%;
			border-radius: inherit;
			display: block;
			inline-size: 100%;
			object-fit: cover;
		}

		& .empty {
			color: var(--muted);
			grid-column: 1 / -1;
			padding-block: 2rem;
			text-align: center;
		}
	}

	.button {
		align-items: center;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		display: inline-flex;
		flex: none;
		font: inherit;
		justify-content: center;
		padding: 0.5rem 1rem;

		&:hover {
			background: color-mix(in srgb, var(--ink) 5%, transparent);
		}

		&.primary {
			background: var(--accent);
			border-color: transparent;
			color: var(--editor-accent-ink, #fff);
		}

		&:disabled {
			cursor: default;
			opacity: 0.5;
		}

		&.wide {
			justify-self: center;
		}
	}

	.round {
		background: none;
		block-size: 2rem;
		border: 0;
		border-radius: 50%;
		color: var(--muted);
		cursor: pointer;
		display: grid;
		inline-size: 2rem;
		place-items: center;

		&:hover {
			background: color-mix(in srgb, var(--ink) 6%, transparent);
			color: var(--ink);
		}

		& path {
			fill: none;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-width: 2;
		}
	}

	.problem {
		color: var(--danger);
		margin: 0 auto 0 0;
	}
</style>
