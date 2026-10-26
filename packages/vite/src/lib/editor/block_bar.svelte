<script lang="ts">
	import { tick } from "svelte"

	type Target = { node: HTMLElement; story: number; uid: string; name: string }
	type Choice = { name: string; display_name: string }

	let {
		act,
		choices,
		siblings: siblings_of,
		find,
		select,
		parent,
		label: named,
	}: {
		/** Send a change; the reply, or why it didn't save */
		act: (change: Record<string, unknown>) => Promise<{ uid?: string } | string>
		choices: (story: number, uid: string) => Promise<{ full: boolean; components: Array<Choice> }>
		/** The blocks in the same list as this one, in order, as the page shows them */
		siblings: (story: number, uid: string) => Promise<Array<HTMLElement | null>>
		/** The block on the page with this `_uid`, once the page has caught up with a change */
		find: (uid: string) => Target | undefined
		/** Select a block, or nothing */
		select: (target: Target | null) => void
		/** The block this one sits in, if it's a block of the same story */
		parent: (target: Target) => Target | undefined
		/** The component's name from the schema, once it's loaded */
		label: (name: string) => string | undefined
	} = $props()

	let target = $state.raw<Target | null>(null)
	let bar = $state<HTMLElement>()
	let top = $state(0)
	let left = $state(0)
	let busy = $state(false)
	let problem = $state<string | null>(null)

	let menu = $state<{ full: boolean; components: Array<Choice> } | "loading" | null>(null)
	let filter = $state("")
	let active = $state(0)
	const shown = $derived(
		menu && menu !== "loading"
			? menu.components.filter(({ display_name, name }) =>
					`${display_name} ${name}`.toLowerCase().includes(filter.trim().toLowerCase())
				)
			: []
	)
	const above = $derived(target ? parent(target) : undefined)

	const label = (name: string) => {
		const given = named(name)
		if (given && given !== name) return given
		const words = name.replace(/[_-]+/g, " ").trim()
		return words.charAt(0).toUpperCase() + words.slice(1)
	}

	/** Where a site's sticky or fixed header ends, so the bar never slides under it */
	function header_bottom() {
		let bottom = 0
		for (const x of [innerWidth * 0.25, innerWidth * 0.5, innerWidth * 0.75])
			for (
				let el = document.elementFromPoint(x, 1);
				el && el !== document.body;
				el = el.parentElement
			) {
				if (el.closest("[data-storyloco]")) break
				const { position } = getComputedStyle(el)
				if (position === "fixed" || position === "sticky") {
					bottom = Math.max(bottom, el.getBoundingClientRect().bottom)
					break
				}
			}
		return Math.min(bottom, innerHeight / 3)
	}

	/** Just above the block's top edge, like a tab; inside it when that's off screen */
	function place() {
		if (!target) return
		const box = target.node.getBoundingClientRect()
		const height = bar?.offsetHeight ?? 36
		const floor = header_bottom() + 8
		const outside = box.top - height - 6
		top =
			outside >= floor
				? outside
				: Math.max(Math.min(Math.max(box.top + 8, floor), box.bottom - height - 8), floor)
		left = Math.min(Math.max(box.left, 8), innerWidth - (bar?.offsetWidth ?? 240) - 8)
	}

	/** Pin to a selected block; `null` lets it go */
	export function show(next: Target | null) {
		if (target?.node === next?.node) return place()
		menu = null
		filter = ""
		problem = null
		target = next
		row = []
		if (next)
			siblings_of(next.story, next.uid)
				.then((found) => target === next && (row = found))
				.catch(() => {})
		tick().then(place)
	}

	export const hide = () => show(null)

	const uid_of = (node: HTMLElement) =>
		(JSON.parse(node.dataset.blokC ?? "{}") as { uid?: string }).uid
	const blocks = () => document.querySelectorAll<HTMLElement>("[data-blok-c]")

	/** Where every block is, so after a change each can glide from there to its new place */
	function snapshot() {
		const where = new Map<string, DOMRect>()
		for (const node of blocks()) {
			const uid = uid_of(node)
			if (uid) where.set(uid, node.getBoundingClientRect())
		}
		return where
	}

	function glide(before: Map<string, DOMRect>) {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
		const moved = new Set<HTMLElement>()
		for (const node of blocks()) {
			const uid = uid_of(node)
			const was = uid ? before.get(uid) : undefined
			const now = node.getBoundingClientRect()
			if (now.bottom < 0 || now.top > innerHeight) continue
			if (!was) {
				node.animate(
					[
						{ opacity: 0, scale: 0.98 },
						{ opacity: 1, scale: 1 },
					],
					{ duration: 320, easing: "cubic-bezier(.2,.8,.2,1)" }
				)
				continue
			}
			const dx = was.left - now.left
			const dy = was.top - now.top
			// a block inside one that moved already travels with it
			const outer = node.parentElement?.closest<HTMLElement>("[data-blok-c]")
			if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || (outer && moved.has(outer))) continue
			moved.add(node)
			node.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
				duration: 360,
				easing: "cubic-bezier(.2,.8,.2,1)",
			})
		}
	}

	async function run(change: Record<string, unknown>) {
		if (!target || busy) return
		const { story, uid, node, name } = target
		const was_in = parent(target)
		busy = true
		problem = null
		node.dataset.storylocoBusy = ""
		const before = snapshot()
		const top_was = node.getBoundingClientRect().top
		const reply = await act({ ...change, story, uid, name })
		delete node.dataset.storylocoBusy
		busy = false
		if (typeof reply === "string") {
			problem = reply
			return
		}
		await tick()
		await new Promise(requestAnimationFrame)
		// follow the block to where it went, or the one made, so the next click carries on from there
		const next = reply.uid ? find(reply.uid) : undefined
		if (change.op === "move" && next) {
			// keep the moved block where it was on screen, so the others are what visibly make way
			const shift = next.node.getBoundingClientRect().top - top_was
			if (Math.abs(shift) > 1) scrollTo({ top: scrollY + shift, behavior: "instant" })
		}
		glide(before)
		if (change.op === "remove") select(was_in ?? null)
		else if (next) {
			select(next)
			if (change.op !== "move") next.node.scrollIntoView({ block: "nearest" })
		}
	}

	async function open_menu() {
		if (!target) return
		if (menu) {
			menu = null
			return
		}
		menu = "loading"
		active = 0
		try {
			menu = await choices(target.story, target.uid)
			await tick()
			bar?.querySelector<HTMLInputElement>("input")?.focus()
		} catch (e) {
			menu = null
			problem = (e as Error).message
		}
	}

	/** Arrows move through the blocks, Enter adds the highlighted one */
	function menu_keys(event: KeyboardEvent) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			const step = event.key === "ArrowDown" ? 1 : -1
			active = (active + step + shown.length) % Math.max(shown.length, 1)
			bar?.querySelectorAll("[role=option]")[active]?.scrollIntoView({ block: "nearest" })
		}
		if (event.key === "Enter" && shown[active]) {
			event.preventDefault()
			run({ op: "insert", component: shown[active].name })
		}
	}

	/** The blocks in this one's list, fetched as it's selected so a drag can start straight away */
	let row: Array<HTMLElement | null> = []

	let drop = $state<{ top: number; left: number; width: number; height: number } | null>(null)

	/** Drag the block by its name to another place among its siblings */
	function drag(event: PointerEvent) {
		if (!target || busy || event.button !== 0) return
		const { node } = target
		const from = row.indexOf(node)
		// the rest of the list, in its order; a blok that shows nothing has no element, but keeps its place
		const rest = row.filter((_, i) => i !== from)
		const shown = rest.flatMap((other, i) => (other?.isConnected ? [{ other, i }] : []))
		if (from < 0 || !shown.length) return
		event.preventDefault()
		const handle = event.currentTarget as HTMLElement
		handle.setPointerCapture(event.pointerId)
		// side by side, like cards in a row, or one under another
		const across = (() => {
			const a = node.getBoundingClientRect()
			const b = shown[0].other.getBoundingClientRect()
			return Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2
		})()
		let to = -1
		let last: PointerEvent | null = null
		let scrolling = 0
		// held near the top or bottom of the window, the page scrolls, faster the nearer the edge
		const edge = () => {
			const y = last?.clientY ?? innerHeight / 2
			const by = y < 64 ? y - 64 : y > innerHeight - 64 ? y - (innerHeight - 64) : 0
			if (by && last) {
				scrollBy({ top: by / 3, behavior: "instant" })
				move(last)
			}
			scrolling = requestAnimationFrame(edge)
		}
		scrolling = requestAnimationFrame(edge)
		const move = (e: PointerEvent) => {
			last = e
			const at = across ? e.clientX : e.clientY
			const boxes = shown.map(({ other, i }) => ({ box: other.getBoundingClientRect(), i }))
			const middle = ({ box }: { box: DOMRect }) =>
				across ? box.left + box.width / 2 : box.top + box.height / 2
			const next = boxes.findIndex((b) => middle(b) >= at)
			const after = boxes[next]?.box
			const before = (next < 0 ? boxes.at(-1) : boxes[next - 1])?.box
			to = next < 0 ? rest.length : boxes[next].i
			const edge = (after ?? before)!
			drop = across
				? {
						left: after ? after.left - 3 : before!.right + 1,
						top: edge.top,
						width: 2,
						height: edge.height,
					}
				: {
						left: edge.left,
						top: after ? after.top - 3 : before!.bottom + 1,
						width: edge.width,
						height: 2,
					}
		}
		const done = () => {
			cancelAnimationFrame(scrolling)
			handle.removeEventListener("pointermove", move)
			drop = null
			if (to >= 0 && to !== from) run({ op: "move", to })
		}
		handle.addEventListener("pointermove", move)
		handle.addEventListener("pointerup", done, { once: true })
		handle.addEventListener("pointercancel", () => ((to = -1), done()), { once: true })
	}

	/** Escape closes the menu first; the overlay takes it from there */
	function keydown(event: KeyboardEvent) {
		if (event.key === "Escape" && menu) {
			event.preventDefault()
			menu = null
		}
	}
</script>

<svelte:window onscroll={place} onresize={place} />

{#if drop}
	<div
		class="drop"
		data-storyloco="drop"
		style:top="{drop.top}px"
		style:left="{drop.left}px"
		style:width="{drop.width}px"
		style:height="{drop.height}px"
	></div>
{/if}

{#if target}
	<div
		bind:this={bar}
		class="bar"
		class:busy
		data-storyloco="block-bar"
		role="toolbar"
		tabindex="-1"
		aria-label="{label(target.name)} block"
		style:top="{top}px"
		style:left="{left}px"
		onkeydown={keydown}
	>
		<div class="row">
			{#if above}
				<button
					type="button"
					aria-label="Select the {label(above.name)} it’s in"
					title="Select the {label(above.name)} it’s in"
					onclick={() => above && select(above)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
					>
				</button>
			{/if}
			<!-- dragging is for the pointer: Move up and down do the same from the keyboard -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="name"
				class:grip={!busy}
				title="Drag to move {label(target.name)}"
				onpointerdown={drag}>{label(target.name)}</span
			>
			<button
				type="button"
				aria-label="Move up"
				title="Move up"
				disabled={busy}
				onclick={() => run({ op: "move", by: -1 })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
			</button>
			<button
				type="button"
				aria-label="Move down"
				title="Move down"
				disabled={busy}
				onclick={() => run({ op: "move", by: 1 })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
			</button>
			<button
				type="button"
				aria-label="Duplicate"
				title="Duplicate"
				disabled={busy}
				onclick={() => run({ op: "duplicate" })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><rect x="8" y="8" width="13" height="13" rx="2" /><path
						d="M4 16V5a1 1 0 0 1 1-1h11"
					/></svg
				>
			</button>
			<button
				type="button"
				aria-label="Add a block after this one"
				title="Add a block after this one"
				aria-expanded={menu !== null}
				disabled={busy}
				onclick={open_menu}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
			</button>
			<button
				type="button"
				class="danger"
				aria-label="Delete"
				title="Delete"
				disabled={busy}
				onclick={() => run({ op: "remove" })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"
					><path
						d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
					/></svg
				>
			</button>
		</div>

		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}

		{#if menu === "loading"}
			<p class="note">Loading blocks…</p>
		{:else if menu?.full}
			<p class="note">This list is full</p>
		{:else if menu}
			<div class="menu">
				<input
					type="search"
					placeholder="Find a block"
					aria-label="Find a block"
					aria-controls="storyloco-add-list"
					bind:value={filter}
					oninput={() => (active = 0)}
					onkeydown={menu_keys}
				/>
				<ul id="storyloco-add-list" role="listbox" aria-label="Blocks">
					{#each shown as choice, i (choice.name)}
						<li role="option" aria-selected={i === active}>
							<button
								type="button"
								class:active={i === active}
								disabled={busy}
								onpointerenter={() => (active = i)}
								onclick={() => run({ op: "insert", component: choice.name })}
								>{label(choice.name) === choice.name
									? choice.display_name
									: label(choice.name)}</button
							>
						</li>
					{:else}
						<li class="note">No blocks match</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.bar) :not(svg, svg *) {
		all: revert;
	}

	:global([data-storyloco-busy]) {
		transition: opacity 0.2s ease;
	}

	:global([data-storyloco-busy]) {
		opacity: 0.55;
	}

	.bar {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--storyloco-bar-bg, #fff);
		--ink: var(--storyloco-bar-ink, #1b243f);
		--muted: var(--storyloco-bar-muted, #6b7280);
		--line: var(--storyloco-bar-line, rgb(27 36 63 / 0.12));
		--accent: var(--storyloco-accent, #05807f);
		--danger: var(--storyloco-danger, #e5484d);
		--shadow: var(--storyloco-bar-shadow, 0 0 0 1px var(--line), 0 2px 8px rgb(27 36 63 / 0.08));

		background: var(--bg);
		border-radius: 0.75rem;
		box-shadow:
			var(--shadow),
			0 4px 16px rgb(0 0 0 / 0.12);
		color: var(--ink);
		font: var(--storyloco-bar-font, 500 0.8125rem/1.25 system-ui, sans-serif);
		max-inline-size: min(20rem, 100vw - 1rem);
		padding: 0.25rem;
		position: fixed;
		z-index: 2147482999;

		& * {
			box-sizing: border-box;
		}

		&.busy {
			cursor: progress;
		}
	}

	.row {
		align-items: center;
		display: flex;
		gap: 0.125rem;
	}

	.drop {
		background: var(--storyloco-accent, #05807f);
		border-radius: 1px;
		box-shadow: 0 0 0 2px rgb(255 255 255 / 0.8);
		pointer-events: none;
		position: fixed;
		z-index: 2147482999;
	}

	.row .grip {
		cursor: grab;
		touch-action: none;
		user-select: none;

		&:active {
			cursor: grabbing;
		}
	}

	.row .name {
		font-weight: 600;
		max-inline-size: 12rem;
		overflow: hidden;
		padding-inline: 0.5rem 0.375rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button {
		align-items: center;
		background: none;
		block-size: 1.75rem;
		border: 0;
		border-radius: 0.5rem;
		color: inherit;
		cursor: pointer;
		display: inline-flex;
		font: inherit;
		justify-content: center;
		min-inline-size: 1.75rem;
		padding: 0 0.25rem;

		&:hover:not(:disabled) {
			background: color-mix(in srgb, var(--ink) 7%, transparent);
		}

		&:disabled {
			cursor: inherit;
			opacity: 0.5;
		}

		&.danger:hover:not(:disabled) {
			color: var(--danger);
		}
	}

	svg {
		block-size: 1rem;
		fill: none;
		inline-size: 1rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	.note,
	.problem {
		font-size: 0.75rem;
		margin: 0;
		padding: 0.375rem 0.5rem 0.25rem;
	}

	.note {
		color: var(--muted);
	}

	.problem {
		color: var(--danger);
	}

	.menu {
		border-block-start: 1px solid var(--line);
		display: grid;
		gap: 0.25rem;
		margin-block-start: 0.25rem;
		padding-block-start: 0.25rem;

		& input {
			background: transparent;
			border: 1px solid var(--line);
			border-radius: 0.5rem;
			color: inherit;
			font: inherit;
			inline-size: 100%;
			padding: 0.375rem 0.5rem;

			&:focus-visible {
				border-color: var(--accent);
				outline: none;
			}
		}

		& ul {
			display: grid;
			gap: 0;
			list-style: none;
			margin: 0;
			max-block-size: 16rem;
			overflow: auto;
			padding: 0;
		}

		& li::before {
			content: none;
		}

		& li button.active {
			background: color-mix(in srgb, var(--ink) 7%, transparent);
		}

		& li button {
			inline-size: 100%;
			justify-content: flex-start;
			padding-inline: 0.5rem;
			text-align: start;
		}
	}
</style>
