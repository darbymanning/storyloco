<script lang="ts">
	import { tick } from "svelte"
	import { cubicOut } from "svelte/easing"
	import { fly } from "svelte/transition"
	import { editor } from "./client.js"
	import { next_frame } from "./page.js"

	type Target = { node: HTMLElement; story: number; uid: string; name: string }
	type Choice = { name: string; display_name: string }

	let {
		act,
		choices,
		find,
		select,
		parent,
		label: named,
		aim,
		where,
	}: {
		/** Send a change; the reply, or why it didn't save */
		act: (change: Record<string, unknown>) => Promise<{ uid?: string } | string>
		choices: (story: number, uid: string) => Promise<{ full: boolean; components: Array<Choice> }>
		/** The block on the page with this `_uid`, once the page has caught up with a change */
		find: (uid: string) => Target | undefined
		/** Select a block, or nothing */
		select: (target: Target | null) => void
		/** The block this one sits in, if it's a block of the same story */
		parent: (target: Target) => Target | undefined
		/** The component's name from the schema, once it's loaded */
		label: (name: string) => string | undefined
		/** Look again at which block to point at */
		aim: () => void
		/** Where a block is among its siblings, and what they are, on a page that can show it moved before that's saved */
		where: (
			story: number,
			uid: string
		) => { index: number; list: Array<{ uid: string; name: string }> } | undefined
	} = $props()

	let target = $state.raw<Target | null>(null)
	let bar = $state<HTMLElement>()
	let top = $state(0)
	let left = $state(0)
	/* a block clicked, rather than the one being read */
	let chosen = $state(false)
	/* with the settings open, their header moves, duplicates and deletes the block they're for; this keeps to the rest */
	const docked = $derived(editor.settings_open && chosen)
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

	/** One place, always: the middle of the top of the window, below any header, whatever else is open */
	function place() {
		if (!target) return
		top = header_bottom() + 8
		left = Math.max(8, (innerWidth - (bar?.offsetWidth ?? 240)) / 2)
	}

	/** Outlined, as nothing else says which block it is; a clicked block has its own outline */
	$effect(() => {
		const node = !chosen && target?.node
		if (!node) return
		node.setAttribute("data-storyloco-aimed", "")
		return () => node.removeAttribute("data-storyloco-aimed")
	})

	/**
	 * Which way the name changes: 1 when the block now pointed at is further down the page than the
	 * last, as when scrolling down, so its name comes up from below as the last one's leaves upwards;
	 * -1 the other way round
	 */
	let way = $state(1)
	const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
	// a whole line's height, kept solid: the two names roll past like one strip, each beside the
	// other and never over it, where a short fade through each other reads as a smudge
	const slide = (by: number) => ({
		y: `${by * 100}%`,
		opacity: 1,
		duration: calm ? 0 : 260,
		easing: cubicOut,
	})

	/** Point at a block; `null` lets it go */
	export function show(next: Target | null, clicked = false) {
		chosen = clicked
		if (target?.node !== next?.node) {
			if (target && next)
				way =
					target.node.compareDocumentPosition(next.node) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1
			menu = null
			filter = ""
			problem = null
			target = next
			// ready before + is pressed
			if (next && clicked) choices(next.story, next.uid).catch(() => {})
		}
		tick().then(place)
	}

	/**
	 * Point at the block in view, unless the bar's in use: it mustn't change under someone's hand,
	 * though a clicked block that's no longer selected, `selecting` says, lets go of it
	 */
	export function aim_at(next: Target | null, clicked = false, selecting = false) {
		if (busy || dragging) return
		const held = menu || bar?.matches(":hover, :has(:focus-visible)")
		if ((!chosen || selecting) && target?.node.isConnected && held) return
		show(next, clicked)
	}

	export const hide = () => show(null)

	const uid_of = (node: HTMLElement) =>
		(JSON.parse(node.dataset.blokC ?? "{}") as { uid?: string }).uid
	const blocks = () => document.querySelectorAll<HTMLElement>("[data-blok-c]")

	/** Where every block is, so after a change each can glide from there to its new place */
	export function snapshot() {
		const where = new Map<string, DOMRect | null>()
		for (const node of blocks()) {
			const uid = uid_of(node)
			// a blok shown in two places, like a layout's header and footer, has no one place to glide from
			if (uid) where.set(uid, where.has(uid) ? null : node.getBoundingClientRect())
		}
		return where
	}

	const EASE = "cubic-bezier(.2,.8,.2,1)"

	/**
	 * Each block glides from where it was on screen to where it is now. One inside another that
	 * moved travels with it, and glides only by what it moved besides, so a block kept where it was
	 * as the page shifted round it holds still. `lifted` is the block moved by hand: it stays in
	 * front of the others as they make way
	 */
	export function glide(before: Map<string, DOMRect | null>, lifted?: HTMLElement) {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
		const on_screen = (box: DOMRect) => box.bottom > 0 && box.top < innerHeight
		/** How far each block is from where it was */
		const shifts = new Map<HTMLElement, { dx: number; dy: number }>()
		const moves: Array<{ node: HTMLElement; dx: number; dy: number }> = []
		for (const node of blocks()) {
			const uid = uid_of(node)
			const was = uid ? before.get(uid) : undefined
			if (was === null) continue
			const now = node.getBoundingClientRect()
			if (!was) {
				if (on_screen(now))
					node.animate(
						[
							{ opacity: 0, scale: 0.98 },
							{ opacity: 1, scale: 1 },
						],
						{ duration: 320, easing: EASE }
					)
				continue
			}
			const shift = { dx: was.left - now.left, dy: was.top - now.top }
			shifts.set(node, shift)
			// in document order, so the block around this one has been through already
			let outer = node.parentElement?.closest<HTMLElement>("[data-blok-c]")
			while (outer && !shifts.has(outer))
				outer = outer.parentElement?.closest<HTMLElement>("[data-blok-c]")
			const around = (outer && shifts.get(outer)) || { dx: 0, dy: 0 }
			const dx = shift.dx - around.dx
			const dy = shift.dy - around.dy
			if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || !(on_screen(was) || on_screen(now))) continue
			moves.push({ node, dx, dy })
		}
		if (!moves.length) return
		// all together, so one carried by another that's moving keeps in step with it; further takes
		// a little longer, so a tall block passing by is seen to pass
		const furthest = Math.max(...moves.map(({ dx, dy }) => Math.hypot(dx, dy)))
		const options = { duration: 360 + Math.min(furthest, 1200) / 4, easing: EASE }
		for (const { node, dx, dy } of moves)
			node.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], options)
		if (!lifted) return
		// picked up, in front of what slides past, and set down as they settle
		const position = getComputedStyle(lifted).position
		const raised = { position: position === "static" ? "relative" : position, zIndex: 1 }
		lifted.animate(
			[
				{ ...raised, boxShadow: "0 1.5rem 4rem rgb(0 0 0 / 0.22)" },
				{ ...raised, boxShadow: "0 0 0 rgb(0 0 0 / 0)" },
			],
			options
		)
	}

	const frame = () => new Promise(requestAnimationFrame)

	async function run(change: Record<string, unknown>) {
		if (!target || busy) return
		const { story, uid, node, name } = target
		const was_in = parent(target)
		// the bar may only be offering this one: what's selected elsewhere stays selected
		const has_selected = node.matches("[data-storyloco-selected], :has([data-storyloco-selected])")
		// moving a block the bar was only offering leaves what's selected, and the settings, as they are
		const follow = change.op !== "move" || chosen
		busy = true
		problem = null
		const before = snapshot()
		const top_was = node.getBoundingClientRect().top
		/** The block stays where it was on screen, so the others are what visibly make way round it */
		const settle = (moved: HTMLElement) => {
			const shift = moved.getBoundingClientRect().top - top_was
			if (Math.abs(shift) > 1) scrollTo({ top: scrollY + shift, behavior: "instant" })
			glide(before, moved)
		}
		const place_was = change.op === "move" ? where(story, uid)?.index : undefined
		const saving = act({ ...change, story, uid, name })
		// a move the page could show at once is in its content already, and saves behind: by where
		// it is there, as on screen it may not have moved, held in place as the browser anchors a scroll
		const at_once = place_was !== undefined && where(story, uid)?.index !== place_was
		if (at_once) {
			// the site has redrawn within a frame or two
			for (let i = 0; i < 2; i++) await frame()
			settle(find(uid)?.node ?? node)
		} else node.dataset.storylocoBusy = ""
		const reply = await saving
		delete node.dataset.storylocoBusy
		busy = false
		if (typeof reply === "string") {
			problem = reply
			return
		}
		await tick()
		await frame()
		// follow the block to where it went, or the one made, so the next click carries on from there
		const next = reply.uid ? find(reply.uid) : undefined
		// one shown at once has glided already: measured again mid-glide, it would only glide twice
		if (at_once) return void (next && (follow ? select(next) : show(next)))
		if (change.op === "move" && next) settle(next.node)
		else glide(before)
		if (change.op === "remove") {
			show(null)
			if (has_selected) select(was_in ?? null)
			else aim()
		} else if (next) {
			if (follow) select(next)
			else show(next)
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

	/** Where a dragged block would land: a line on the page, between the blocks it would go between */
	let drop = $state<{ top: number; left: number; width: number; height: number } | null>(null)
	const dragging = $derived(drop !== null)
	/** Whether the block pointed at can be dragged to another place: it has siblings, on a page that can show it */
	const draggable = $derived.by(() => {
		const at = target && where(target.story, target.uid)
		return !!at && at.list.length > 1
	})

	/**
	 * Drag the block by its name to another place among its siblings: the page stays as it is, a
	 * line on it showing where the block would go, between whichever two the pointer's nearest, and
	 * the block moves there, the others making way, once it's let go
	 */
	function drag(event: PointerEvent) {
		if (!target || busy || !draggable || event.button !== 0) return
		const { node, story, uid } = target
		const at = where(story, uid)
		if (!at) return
		const from = at.index
		// the rest of the list, in its order; a blok that shows nothing has no element, but keeps its place
		const rest = at.list.filter((_, i) => i !== from).map((sibling) => find(sibling.uid)?.node)
		const shown = rest.flatMap((other, i) => (other?.isConnected ? [{ other, i }] : []))
		if (!shown.length) return
		event.preventDefault()
		const handle = event.currentTarget as HTMLElement
		handle.setPointerCapture(event.pointerId)
		menu = null
		// side by side, like cards in a row, or one under another
		const across = (() => {
			const a = node.getBoundingClientRect()
			const b = shown[0].other.getBoundingClientRect()
			return Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2
		})()
		let to = -1
		let last: PointerEvent | null = null
		let scrolling = 0
		const move = (e: PointerEvent) => {
			last = e
			const point = across ? e.clientX : e.clientY
			const boxes = shown.map(({ other, i }) => ({ box: other.getBoundingClientRect(), i }))
			const middle = ({ box }: { box: DOMRect }) =>
				across ? box.left + box.width / 2 : box.top + box.height / 2
			const next = boxes.findIndex((b) => middle(b) >= point)
			const after = boxes[next]?.box
			const before = (next < 0 ? boxes.at(-1) : boxes[next - 1])?.box
			to = next < 0 ? rest.length : boxes[next].i
			const edge = (after ?? before)!
			// where it is already is nowhere to go: no line there
			if (to === from) return void (drop = { top: 0, left: 0, width: 0, height: 0 })
			drop = across
				? {
						left: after ? after.left - 3 : before!.right + 1,
						top: edge.top,
						width: 4,
						height: edge.height,
					}
				: {
						left: edge.left,
						top: after ? after.top - 2 : before!.bottom - 2,
						width: edge.width,
						height: 4,
					}
		}
		// held near the top or bottom of the window, the page scrolls, faster the nearer the edge
		const edge = () => {
			const y = last?.clientY ?? innerHeight / 2
			const by = y < 72 ? y - 72 : y > innerHeight - 72 ? y - (innerHeight - 72) : 0
			if (by && last) {
				scrollBy({ top: by / 3, behavior: "instant" })
				move(last)
			}
			scrolling = requestAnimationFrame(edge)
		}
		scrolling = requestAnimationFrame(edge)
		drop = { top: 0, left: 0, width: 0, height: 0 }
		const up = () => done(true)
		const cancel = () => done(false)
		const done = (keep: boolean) => {
			cancelAnimationFrame(scrolling)
			handle.removeEventListener("pointermove", move)
			handle.removeEventListener("pointerup", up)
			handle.removeEventListener("pointercancel", cancel)
			drop = null
			if (keep && to >= 0 && to !== from) run({ op: "move", to })
		}
		handle.addEventListener("pointermove", move)
		handle.addEventListener("pointerup", up)
		handle.addEventListener("pointercancel", cancel)
	}

	/** Escape closes the menu first; the overlay takes it from there */
	function keydown(event: KeyboardEvent) {
		if (event.key === "Escape" && menu) {
			event.preventDefault()
			menu = null
			tick().then(aim)
		}
	}

	const follow = next_frame(() => place())
</script>

<svelte:window onscroll={follow} onresize={place} />

{#snippet tool(
	tip: string,
	d: string,
	onclick: () => void,
	{
		end = false,
		danger = false,
		expanded,
	}: { end?: boolean; danger?: boolean; expanded?: boolean } = {}
)}
	<span class="control" class:end>
		<button
			type="button"
			class:danger
			aria-label={tip}
			aria-expanded={expanded}
			disabled={busy}
			{onclick}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path {d} /></svg>
		</button>
		<span class="tip" aria-hidden="true">{tip}</span>
	</span>
{/snippet}

{#if drop?.width}
	<div
		class="drop"
		data-storyloco="drop-line"
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
		class:quiet={menu || dragging}
		data-storyloco="block-bar"
		role="toolbar"
		tabindex="-1"
		aria-label="{label(target.name)} block"
		style:top="{top}px"
		style:left="{left}px"
		onkeydown={keydown}
		onpointerleave={aim}
	>
		<div class="row">
			{#if above}
				{@render tool(
					`Select the ${label(above.name)} it’s in`,
					"M14 9 9 4 4 9M20 20h-7a4 4 0 0 1-4-4V4",
					() => above && select(above)
				)}
			{/if}
			<span class="control named">
				<!-- dragging is for the pointer: Move up and down do it from the keyboard -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span class="name" class:grip={draggable && !busy} onpointerdown={drag}>
					{#if draggable}
						<svg class="dots" viewBox="0 0 24 24" aria-hidden="true"
							><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle
								cx="9"
								cy="12"
								r="1"
							/><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle
								cx="15"
								cy="18"
								r="1"
							/></svg
						>
					{/if}
					<span class="words">
						{#key target.node}
							<span class="word" in:fly={slide(way)} out:fly={slide(-way)}
								>{label(target.name)}</span
							>
						{/key}
					</span>
				</span>
				{#if draggable}<span class="tip" aria-hidden="true">Drag to move</span>{/if}
			</span>
			{#if !docked}
				{@render tool("Move up", "m18 15-6-6-6 6", () => run({ op: "move", by: -1 }))}
				{@render tool("Move down", "m6 9 6 6 6-6", () => run({ op: "move", by: 1 }))}
				{@render tool(
					"Duplicate",
					"M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM4 16V5a1 1 0 0 1 1-1h11",
					() => run({ op: "duplicate" })
				)}
			{/if}
			{@render tool("Add a block after this one", "M12 5v14M5 12h14", open_menu, {
				end: true,
				expanded: menu !== null,
			})}
			{#if !docked}
				{@render tool(
					"Delete",
					"M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
					() => run({ op: "remove" }),
					{ end: true, danger: true }
				)}
			{/if}
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

		--bg: var(--editor-bg, #fff);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--danger: var(--editor-danger, #e5484d);
		--shadow: var(--editor-shadow, 0 0 0 1px var(--line), 0 2px 8px rgb(27 36 63 / 0.08));

		backdrop-filter: blur(20px) saturate(1.8);
		background:
			linear-gradient(color-mix(in srgb, var(--accent) 9%, transparent), transparent 12rem),
			color-mix(in srgb, var(--bg) 80%, transparent);
		border-radius: 0.75rem;
		box-shadow:
			var(--shadow),
			0 4px 16px rgb(0 0 0 / 0.12);
		color: var(--ink);
		font: var(--editor-font, 500 0.8125rem/1.25 system-ui, sans-serif);
		max-inline-size: min(20rem, 100vw - 1rem);
		padding: 0.25rem;
		position: fixed;
		/* it arrives: down a touch from above, as the window's top is where it lives */
		transition:
			opacity 0.25s ease,
			translate 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
			scale 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
		z-index: 2147482999;

		@starting-style {
			opacity: 0;
			scale: 0.96;
			translate: 0 -0.5rem;
		}

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}

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

	.control {
		display: flex;
		flex: none;
		position: relative;

		&:has(:focus-visible) .tip {
			opacity: 1;
			translate: 0 0;
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover .tip {
				opacity: 1;
				translate: 0 0;
			}
		}
	}

	/* towards the middle, so it isn't cut off by a narrow window */
	.control.end .tip {
		inset-inline: auto calc(50% - 0.9375rem);

		&::after {
			inset-inline: auto 0.625rem;
		}
	}

	/* the edit bar's tips; the bar's at the top of the window, so they open downwards */
	.tip {
		background-color: var(--ink);
		border-radius: 0.5rem;
		color: var(--bg);
		font-size: 0.75rem;
		inset: calc(100% + 0.625rem) auto auto calc(50% - 0.9375rem);
		opacity: 0;
		padding: 0.5rem 0.625rem;
		pointer-events: none;
		position: absolute;
		transition:
			opacity 0.2s ease,
			translate 0.2s ease;
		translate: 0 -0.25rem;
		white-space: nowrap;

		&::after {
			background-color: inherit;
			block-size: 0.3125rem;
			clip-path: polygon(50% 0, 100% 100%, 0 100%);
			content: "";
			inline-size: 0.625rem;
			inset: auto auto 100% 0.625rem;
			position: absolute;
		}

		/* they'd cover what's being chosen from */
		.quiet & {
			display: none;
		}

		@media (prefers-reduced-motion: reduce) {
			translate: none;
		}
	}

	/* the same width whatever it's called, so the buttons stay put as the block changes */
	.control.named {
		flex: 0 1 auto;
		inline-size: 9rem;
		min-inline-size: 0;
	}

	.row .name {
		align-items: center;
		display: flex;
		flex: 1;
		font-weight: 600;
		min-inline-size: 0;
		padding-inline: 0.5rem 0.375rem;
	}

	.row .grip {
		cursor: grab;
		touch-action: none;
		user-select: none;

		&:active {
			cursor: grabbing;
		}
	}

	.row .dots {
		block-size: 1rem;
		color: var(--muted);
		fill: currentColor;
		flex: none;
		inline-size: 1rem;
		margin-inline: -0.25rem 0.125rem;
		stroke: none;
	}

	/* a line high and no more, so a name rolling in or out is cut off at its edge */
	.row .words {
		block-size: 1.25em;
		display: grid;
		flex: 1;
		line-height: 1.25;
		min-inline-size: 0;
		overflow: hidden;
	}

	/* one in the other's place while the name changes, the last leaving as the next arrives */
	.row .word {
		grid-area: 1 / 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* where a dragged block would land: a line on the page, in the accent, that glides from gap to gap */
	.drop {
		background: var(--editor-accent, #05807f);
		border-radius: 999px;
		box-shadow:
			0 0 0 2px rgb(255 255 255 / 0.85),
			0 2px 12px rgb(0 0 0 / 0.3);
		pointer-events: none;
		position: fixed;
		transition:
			top 0.12s ease,
			left 0.12s ease;
		z-index: 2147482998;

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}
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
