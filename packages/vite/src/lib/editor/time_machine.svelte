<!--
	@component
	The page's history, in place: drag the timeline, scroll it, or use the arrow keys, and the
	page shows itself as it was at each save, flying back through a stack of earlier versions
	receding into the void; Restore makes that version the draft.
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { call, editor, on_navigate, send, set_editing, show_version } from "./client.js"
	import { differences, type Difference } from "./content.js"

	type Version = {
		id: number
		created_at: string
		status: string
		by: string | null
		content: unknown
	}

	let { label, close }: { label: (name: string) => string; close: () => void } = $props()

	let versions = $state.raw<Array<Version> | null>(null)
	let index = $state(0)
	let problem = $state<string | null>(null)
	let busy = $state(false)
	/** Whether the page can show a version in place, which needs its story connected */
	let in_place = $state(true)
	let rail = $state<HTMLElement>()
	/** Where the pointer is on the timeline, in versions, while it hovers or drags */
	let pointer = $state<number | null>(null)
	let dragging = $state(false)
	/** Which way the last move went: -1 back in time, 1 forward */
	let heading = $state(-1)
	/** Ghosts rise one after another as the machine opens, then all follow at once */
	let settled = $state(false)
	let restored = $state(false)
	let leaving = $state(false)

	const chosen = $derived(versions?.[index])
	const last = $derived((versions?.length ?? 1) - 1)
	const changes = $derived<Array<Difference>>(
		versions && index ? differences(versions[0].content, versions[index].content) : []
	)
	const focus = $derived(pointer ?? index)

	const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

	let alive = true
	/** The version the page is showing, which trails `index` while a transition runs */
	let shown = 0
	let transition: ViewTransition | null = null
	let settle: ReturnType<typeof setTimeout> | undefined

	onMount(() => {
		const was_editing = editor.editing
		const root = document.documentElement
		// the page as visitors see it, without outlines and pins, while it travels
		set_editing(false, false)
		root.dataset.storylocoTime = ""
		const story = editor.story
		if (!story) problem = "This page has no story to look back through"
		else
			call<{ versions: Array<Version> }>({ op: "versions", story: story.id })
				.then((reply) => {
					versions = reply.versions
					setTimeout(() => (settled = true), 1200)
				})
				.catch((e: Error) => (problem = e.message))
		tick().then(() => rail?.focus())
		// not passive, so scrolling the timeline doesn't scroll the page too
		rail?.addEventListener("wheel", wheel, { passive: false })
		const stop = on_navigate(close)
		return () => {
			alive = false
			clearTimeout(settle)
			transition?.skipTransition()
			rail?.removeEventListener("wheel", wheel)
			stop()
			show_version(null)
			delete root.dataset.storylocoTime
			set_editing(was_editing, false)
		}
	})

	/** To another version; quick moves, like a drag, get a lighter transition */
	function go(next: number, quick = false) {
		if (!versions || leaving || restored) return
		next = Math.max(0, Math.min(last, next))
		if (next === index) return
		heading = next > index ? -1 : 1
		index = next
		clearTimeout(settle)
		// the timeline keeps up with a scrub at once; the page, slower to redraw, follows when it rests
		if (quick || dragging) settle = setTimeout(() => travel(true), 140)
		else travel(false)
	}

	/** Brings the page to `index`, one transition at a time, skipping versions passed meanwhile */
	function travel(quick: boolean) {
		if (!versions || transition || shown === index || !alive) return
		const back = index > shown
		const swap = async () => {
			if (!alive || !versions) return
			shown = index
			in_place = show_version(shown ? versions[shown].content : null)
			await tick()
		}
		if (!in_place || still() || !document.startViewTransition) return void swap()
		document.documentElement.dataset.storylocoTime = `${back ? "back" : "forward"}${quick ? " quick" : ""}`
		transition = document.startViewTransition(swap)
		transition.finished.finally(() => {
			transition = null
			travel(true)
		})
	}

	/** The version under the pointer on the timeline, newest at the bottom, as a fraction */
	function spot(event: PointerEvent) {
		if (!rail || !last) return 0
		const box = rail.getBoundingClientRect()
		return Math.max(0, Math.min(1, (box.bottom - event.clientY) / box.height)) * last
	}

	function press(event: PointerEvent) {
		if (event.button !== 0 || !versions) return
		rail?.setPointerCapture(event.pointerId)
		pointer = spot(event)
		go(Math.round(pointer))
		dragging = true
	}

	function move(event: PointerEvent) {
		if (!versions) return
		pointer = spot(event)
		if (dragging) go(Math.round(pointer), true)
	}

	function release(event: PointerEvent) {
		dragging = false
		if (event.pointerType !== "mouse") pointer = null
		clearTimeout(settle)
		travel(true)
	}

	let scrolled = 0

	function wheel(event: WheelEvent) {
		event.preventDefault()
		scrolled += event.deltaY
		const steps = Math.trunc(scrolled / 40)
		if (!steps) return
		scrolled -= steps * 40
		go(index - steps, true)
	}

	function keys(event: KeyboardEvent) {
		const step: Record<string, number> = {
			ArrowUp: 1,
			ArrowLeft: 1,
			PageUp: 5,
			ArrowDown: -1,
			ArrowRight: -1,
			PageDown: -5,
		}
		if (event.key in step) go(index + step[event.key], event.repeat)
		else if (event.key === "Home") go(0)
		else if (event.key === "End") go(last)
		else return
		event.preventDefault()
	}

	/** Back to now, the page returning from the void before the machine closes */
	function leave() {
		if (leaving) return
		if (index && !restored) {
			heading = 1
			index = 0
			clearTimeout(settle)
			travel(false)
		}
		leaving = true
		setTimeout(close, still() ? 0 : 560)
	}

	async function restore() {
		const story = editor.story
		if (!story || !chosen || !index) return
		busy = true
		const ok = await send({ op: "revert", story: story.id, version: chosen.id })
		busy = false
		if (!ok) return (problem = editor.problem ?? "Couldn’t restore it")
		restored = true
		setTimeout(leave, still() ? 600 : 900)
	}

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
	const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
	const days_ago = (date: string) =>
		Math.round((day(new Date()) - day(new Date(date))) / 86_400_000)

	/** "Today", "Yesterday", then the date */
	function day_of(date: string) {
		const ago = days_ago(date)
		if (ago < 2) return relative.format(-ago, "day").replace(/^./, (c) => c.toUpperCase())
		return new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short" })
	}

	const time_of = (date: string) =>
		new Date(date).toLocaleTimeString(undefined, { timeStyle: "short" })

	/** A version's label on the timeline: its time, with the day unless it's today */
	function stamp(i: number) {
		const at = versions?.[i]?.created_at
		if (!i || !at) return "Now"
		return days_ago(at) ? `${day_of(at)} · ${time_of(at)}` : time_of(at)
	}

	/** Where a version sits on the timeline, newest at the bottom */
	const place = (i: number) => (last ? 100 - (i / last) * 100 : 100)

	/** Ticks swell near the pointer, or the one chosen, like a dock */
	const swell = (i: number) => Math.max(0, 1 - Math.abs(i - focus) / 3.5)

	/** How far behind the page a version's ghost sits, as a perspective divisor */
	const distance = (depth: number) => 1 + Math.max(0, Math.min(depth, 9)) * 0.09

	const KINDS: Record<string, { verb: string; mark: string }> = {
		// from the page as it is now to the version: what restoring it would do
		added: { verb: "Brings back", mark: "+" },
		removed: { verb: "Removes", mark: "−" },
		edited: { verb: "Changes back", mark: "↺" },
		reordered: { verb: "Reorders", mark: "⇅" },
	}
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") {
			event.preventDefault()
			leave()
		}
	}}
/>

<div class={["time", { settled, leaving, restored }]} data-storyloco="time">
	<div class="frame" aria-hidden="true"></div>

	<div class="void" aria-hidden="true" style:--travel={index}>
		{#each versions ?? [] as version, i (version.id)}
			{@const depth = i - index}
			<button
				type="button"
				tabindex="-1"
				aria-label={stamp(i)}
				class={["ghost", { published: version.status === "published" }]}
				style:--z={distance(depth)}
				style:--lit={Math.max(0, 1 - depth * 0.13)}
				style:--order={Math.max(0, depth)}
				style:opacity={depth >= 0 && depth <= 7 ? 1 : 0}
				style:z-index={50 - depth}
				onclick={() => go(i)}
			></button>
		{/each}
	</div>

	<div
		bind:this={rail}
		class={["rail", { dragging }]}
		role="slider"
		tabindex="0"
		aria-label="Page history"
		aria-orientation="vertical"
		aria-valuemin={0}
		aria-valuemax={last}
		aria-valuenow={index}
		aria-valuetext={chosen
			? index
				? `${day_of(chosen.created_at)} at ${time_of(chosen.created_at)}`
				: "Now"
			: "Loading"}
		onpointerdown={press}
		onpointermove={move}
		onpointerup={release}
		onpointercancel={release}
		onpointerleave={() => dragging || (pointer = null)}
		onkeydown={keys}
	>
		{#each versions ?? [] as version, i (version.id)}
			{@const near = swell(i)}
			{@const new_day =
				i === last || days_ago(version.created_at) !== days_ago(versions![i + 1].created_at)}
			<span
				class={["tick", { chosen: i === index, published: version.status === "published" }]}
				style:top="{place(i)}%"
				style:--near={near}
			>
				{#if new_day && near < 0.4 && Math.abs(i - index) > 1.5}
					<span class="day">{day_of(version.created_at)}</span>
				{/if}
			</span>
		{/each}
		{#if versions}
			{@const peek = pointer === null || dragging ? null : Math.round(pointer)}
			{#if peek !== null && peek !== index}
				<span class="peek" style:top="{place(peek)}%">{stamp(peek)}</span>
			{/if}
			<span class="thumb" style:top="{place(dragging && pointer !== null ? pointer : index)}%">
				<span class="when">{stamp(index)}</span>
			</span>
		{/if}
	</div>

	<div class="card" role="status">
		{#if restored}
			<p class="done">
				<svg viewBox="0 0 20 20" aria-hidden="true"
					><path
						d="M5 10.5l3.2 3.2L15 6.8"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
				Restored. The draft is this version again.
			</p>
		{:else if problem}
			<p class="problem">{problem}</p>
			<div class="actions"><button type="button" onclick={close}>Close</button></div>
		{:else if versions && !versions.length}
			<p class="head"><span>Page history</span></p>
			<p class="title">No saves yet</p>
			<p class="sub">Each change made to this page from now on can be gone back to here.</p>
			<div class="actions"><button type="button" onclick={leave}>Done</button></div>
		{:else if !versions || !chosen}
			<p class="head"><span>Page history</span></p>
			<p class="title loading">Gathering the page’s history…</p>
		{:else}
			<p class="head">
				<span>Page history</span>
				<span>{index ? `${index} of ${last} saves back` : `${last} saves`}</span>
			</p>
			{#key index}
				<div class="moment" style:--from={heading}>
					<p class="title">
						{index ? `${day_of(chosen.created_at)}, ${time_of(chosen.created_at)}` : "Now"}
					</p>
					{#if index}
						<p class="sub meta">
							<span class={["status", { published: chosen.status === "published" }]}
								>{chosen.status === "published" ? "Published" : "Saved"}</span
							>
							{#if chosen.by}<span>by {chosen.by}</span>{/if}
						</p>
						{#if !in_place}
							<p class="sub">
								This page can’t show itself as it was, but this is what restoring would do.
							</p>
						{/if}
						{#if changes.length}
							<ul class="changes">
								{#each changes.slice(0, 4) as change, n (change.uid)}
									<li class={["change", change.kind]} style:--n={n}>
										<span class="mark" aria-hidden="true">{KINDS[change.kind]?.mark ?? "•"}</span>
										<span class="what"
											><b>{KINDS[change.kind]?.verb ?? change.kind}</b>
											{label(change.component)}{#if change.hint}<span class="hint"
													>“{change.hint}”</span
												>{/if}</span
										>
									</li>
								{/each}
								{#if changes.length > 4}
									<li class="change more" style:--n={4}>and {changes.length - 4} more</li>
								{/if}
							</ul>
						{:else}
							<p class="sub">The same as the page now</p>
						{/if}
					{:else}
						<p class="sub">
							Drag the timeline, scroll it, or press <kbd>↑</kbd> to go back through {last} saves
						</p>
					{/if}
				</div>
			{/key}
			<div class="actions">
				<button type="button" onclick={leave}>{index ? "Back to now" : "Done"}</button>
				{#if index}
					<button type="button" class="primary" disabled={busy || !changes.length} onclick={restore}
						>{busy ? "Restoring…" : "Restore this version"}</button
					>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.time) :not(svg, svg *) {
		all: revert;
	}

	.time {
		color-scheme: dark;

		--void: #050816;
		--ink: #f4f6fb;
		--muted: rgb(244 246 251 / 0.62);
		--accent: var(--storyloco-accent, #05807f);
		--accent-ink: var(--storyloco-accent-ink, #fff);
		--glow: color-mix(in oklab, var(--accent) 55%, #7d8cff);
		--ease: cubic-bezier(0.22, 1, 0.36, 1);
		--spring: cubic-bezier(0.34, 1.5, 0.55, 1);

		/* the window onto the page, with room above it for the past to stack up */
		--top: 3.5rem;
		--side: 0.875rem;
		--bottom: 0.875rem;
		/* how far below the vanishing point the window's top edge sits */
		--rise: 9rem;

		color: var(--ink);
		font: var(--storyloco-bar-font, 500 0.8125rem/1.4 system-ui, sans-serif);

		& * {
			box-sizing: border-box;
		}

		&.leaving {
			pointer-events: none;
		}
	}

	/* the page framed in the dark, like a window into the past */
	.frame {
		border-radius: 1rem;
		box-shadow:
			inset 0 0 0 1px rgb(255 255 255 / 0.14),
			inset 0 0 5rem rgb(0 0 0 / 0.3),
			0 0 0 100vmax var(--void);
		inset: var(--top) var(--side) var(--bottom);
		pointer-events: none;
		position: fixed;
		view-transition-name: storyloco-time-frame;
		z-index: 2147483000;

		@starting-style {
			box-shadow:
				inset 0 0 0 1px transparent,
				inset 0 0 5rem transparent,
				0 0 0 100vmax transparent;
			inset: 0;
		}
		transition:
			inset 0.6s var(--ease),
			box-shadow 0.45s ease;

		.leaving & {
			box-shadow:
				inset 0 0 0 1px transparent,
				inset 0 0 5rem transparent,
				0 0 0 100vmax transparent;
			inset: 0;
			transition:
				inset 0.5s var(--ease),
				box-shadow 0.5s ease 0.1s;
		}

		/* restoring: the page lights up as it becomes the draft */
		.restored &::after {
			animation: restored 1.2s var(--ease) both;
			border-radius: inherit;
			box-shadow:
				inset 0 0 0 2px var(--glow),
				inset 0 0 5rem color-mix(in srgb, var(--glow) 45%, transparent);
			content: "";
			inset: 0;
			position: absolute;
		}
	}

	@keyframes restored {
		0% {
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* the space around the window, where earlier versions recede toward a vanishing point */
	.void {
		background:
			radial-gradient(48rem 12rem at 50% -3rem, rgb(110 128 255 / 0.32), transparent 70%),
			radial-gradient(
				22rem 9rem at 78% 0,
				color-mix(in srgb, var(--accent) 28%, transparent),
				transparent 70%
			),
			var(--void);
		clip-path: polygon(
			evenodd,
			0 0,
			100% 0,
			100% 100%,
			0 100%,
			0 0,
			var(--side) var(--top),
			var(--side) calc(100% - var(--bottom)),
			calc(100% - var(--side)) calc(100% - var(--bottom)),
			calc(100% - var(--side)) var(--top),
			var(--side) var(--top)
		);
		inset: 0;
		position: fixed;
		view-transition-name: storyloco-time-void;
		z-index: 2147483001;

		@starting-style {
			clip-path: polygon(
				evenodd,
				0 0,
				100% 0,
				100% 100%,
				0 100%,
				0 0,
				0 0,
				0 100%,
				100% 100%,
				100% 0,
				0 0
			);
			opacity: 0;
		}
		transition:
			clip-path 0.6s var(--ease),
			opacity 0.4s ease;

		.leaving & {
			clip-path: polygon(
				evenodd,
				0 0,
				100% 0,
				100% 100%,
				0 100%,
				0 0,
				0 0,
				0 100%,
				100% 100%,
				100% 0,
				0 0
			);
			opacity: 0;
			transition:
				clip-path 0.5s var(--ease),
				opacity 0.4s ease 0.15s;
		}

		/* stars, in two layers that drift at different speeds as it travels */
		&::before,
		&::after {
			background-position: 0 calc(var(--travel) * 6px);
			content: "";
			inset: 0;
			pointer-events: none;
			position: absolute;
			transition: background-position 1.2s var(--ease);
		}

		&::before {
			background-image:
				radial-gradient(1px 1px at 13% 27%, rgb(255 255 255 / 0.7), transparent),
				radial-gradient(1px 1px at 61% 71%, rgb(255 255 255 / 0.6), transparent),
				radial-gradient(1px 1px at 37% 53%, rgb(200 210 255 / 0.7), transparent),
				radial-gradient(1px 1px at 83% 19%, rgb(255 255 255 / 0.5), transparent);
			background-size:
				157px 89px,
				211px 113px,
				97px 131px,
				263px 71px;
			opacity: 0.6;
		}

		&::after {
			animation: twinkle 3.6s ease-in-out infinite alternate;
			background-image:
				radial-gradient(1.5px 1.5px at 29% 41%, #fff, transparent),
				radial-gradient(1.5px 1.5px at 71% 63%, rgb(190 205 255), transparent),
				radial-gradient(2px 2px at 47% 17%, rgb(255 255 255 / 0.9), transparent);
			background-position: 0 calc(var(--travel) * 14px);
			background-size:
				331px 149px,
				419px 127px,
				587px 173px;
		}
	}

	@keyframes twinkle {
		from {
			opacity: 0.45;
		}
		to {
			opacity: 0.95;
		}
	}

	/* an earlier version, a window further back the older it is */
	.ghost {
		background-color: color-mix(in oklab, #dfe6ff calc(var(--lit) * 17%), var(--void));
		background-image: linear-gradient(rgb(255 255 255 / 0.05), transparent 2.5rem);
		border: 0;
		border-radius: 1rem;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / calc(var(--lit) * 0.3)),
			0 -0.5rem 1.5rem -0.5rem rgb(0 0 0 / 0.55);
		cursor: pointer;
		inset: var(--top) var(--side) var(--bottom);
		margin: 0;
		padding: 0;
		position: absolute;
		scale: calc(1 / var(--z));
		transform-origin: 50% 0;
		translate: 0 calc(var(--rise) * (1 / var(--z) - 1));

		@starting-style {
			scale: 1;
			translate: 0 0;
		}
		transition:
			translate 0.65s var(--ease),
			scale 0.65s var(--ease),
			background-color 0.5s ease,
			box-shadow 0.5s ease,
			opacity 0.35s ease,
			filter 0.2s ease;

		.time:not(.settled) & {
			transition-delay: calc(0.1s + var(--order) * 55ms);
		}

		.leaving & {
			scale: 1;
			transition-delay: 0s;
			translate: 0 0;
		}

		&.published {
			box-shadow:
				inset 0 1px 0 color-mix(in srgb, var(--glow) calc(var(--lit) * 90%), transparent),
				0 -0.5rem 1.5rem -0.5rem rgb(0 0 0 / 0.55);
		}

		&:hover {
			filter: brightness(1.6);
		}
	}

	.rail {
		block-size: 66vh;
		cursor: ns-resize;
		inline-size: 4.5rem;
		inset-block-start: calc(var(--top) + 12vh);
		inset-inline-end: 1.75rem;
		outline: none;
		position: fixed;
		touch-action: none;
		user-select: none;
		view-transition-name: storyloco-time-rail;
		z-index: 2147483002;

		@starting-style {
			opacity: 0;
			translate: 1.5rem 0;
		}
		transition:
			opacity 0.4s ease 0.15s,
			translate 0.6s var(--ease) 0.15s;

		.leaving & {
			opacity: 0;
			transition:
				opacity 0.25s ease,
				translate 0.4s var(--ease);
			translate: 1.5rem 0;
		}

		&::before {
			/* solid enough not to need a backdrop blur, which repaints every frame the page moves behind it */
			background: linear-gradient(rgb(26 34 64 / 0.94), rgb(12 17 34 / 0.96));
			border-radius: 999px;
			box-shadow:
				inset 0 1px 0 rgb(255 255 255 / 0.1),
				0 0 0 1px rgb(255 255 255 / 0.08),
				0 1rem 2.5rem -0.75rem rgb(0 0 0 / 0.6);
			content: "";
			inset: -1.25rem 0;
			position: absolute;
			transition: box-shadow 0.2s ease;
		}

		&:focus-visible::before {
			box-shadow:
				inset 0 1px 0 rgb(255 255 255 / 0.1),
				0 0 0 1px color-mix(in srgb, var(--glow) 55%, transparent),
				0 1rem 2.5rem -0.75rem rgb(0 0 0 / 0.6);
		}
	}

	.tick {
		background: rgb(255 255 255 / calc(0.3 + var(--near) * 0.5));
		block-size: 2px;
		border-radius: 2px;
		inline-size: calc(0.625rem + var(--near) * 1.375rem);
		inset-inline-end: 1rem;
		position: absolute;
		transition:
			inline-size 0.22s var(--ease),
			background 0.22s ease;
		translate: 0 -50%;

		&.published {
			background: color-mix(in srgb, var(--glow) calc(60% + var(--near) * 40%), transparent);

			/* a dot beside each published save */
			&::after {
				background: var(--glow);
				block-size: 4px;
				border-radius: 50%;
				box-shadow: 0 0 6px var(--glow);
				content: "";
				inline-size: 4px;
				inset-inline-start: calc(100% + 0.25rem);
				position: absolute;
				top: 50%;
				translate: 0 -50%;
			}
		}
	}

	/* the playhead, gliding between saves, following the pointer exactly while dragged */
	.thumb {
		block-size: 0;
		inline-size: 2.5rem;
		inset-inline-end: 0.875rem;
		pointer-events: none;
		position: absolute;
		transition: top 0.5s var(--spring);

		.dragging & {
			transition: top 0.06s linear;
		}

		&::before {
			background: var(--ink);
			block-size: 3px;
			border-radius: 3px;
			box-shadow:
				0 0 0 3px rgb(255 255 255 / 0.1),
				0 0 1rem 2px var(--glow);
			content: "";
			inset-inline: 0;
			position: absolute;
			translate: 0 -50%;
		}
	}

	.when,
	.day,
	.peek {
		border-radius: 999px;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 650;
		padding: 0.1875rem 0.5rem;
		pointer-events: none;
		position: absolute;
		translate: 0 -50%;
		white-space: nowrap;
	}

	.when {
		background: var(--ink);
		box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 0.35);
		color: var(--void);
		font-size: 0.75rem;
		font-weight: 700;
		inset-inline-end: calc(100% + 0.625rem);
		top: 0;
	}

	.day,
	.peek {
		background: rgb(12 17 34 / 0.94);
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.08);
		color: var(--muted);
	}

	.day {
		inset-inline-end: calc(100% + 0.5rem);
		top: 50%;
	}

	.peek {
		color: var(--ink);
		inset-inline-end: calc(100% - 0.375rem);
		transition: top 0.15s var(--ease);

		@starting-style {
			opacity: 0;
		}
	}

	.card {
		background: linear-gradient(rgb(28 36 66 / 0.95), rgb(12 17 34 / 0.97));
		border-radius: 1.25rem;
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.1),
			0 0 0 1px rgb(255 255 255 / 0.08),
			0 1.5rem 4rem -1rem rgb(0 0 0 / 0.65);
		display: grid;
		gap: 0.25rem;
		inline-size: min(27rem, 100vw - 11rem);
		inset-block-end: 2rem;
		inset-inline-start: 50%;
		padding: 0.875rem 1.125rem 1rem;
		position: fixed;
		translate: -50% 0;
		view-transition-name: storyloco-time-card;
		z-index: 2147483002;

		@starting-style {
			opacity: 0;
			translate: -50% 1.5rem;
		}
		transition:
			opacity 0.35s ease 0.1s,
			translate 0.6s var(--ease) 0.1s;

		.leaving & {
			opacity: 0;
			transition:
				opacity 0.3s ease,
				translate 0.45s var(--ease);
			translate: -50% 1.5rem;
		}
	}

	p {
		margin: 0;
	}

	.head {
		color: var(--muted);
		display: flex;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		font-weight: 650;
		justify-content: space-between;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	/* each moment arrives from the direction it was travelled to */
	.moment {
		animation: arrive 0.4s var(--ease) both;
		display: grid;
		gap: 0.25rem;
	}

	@keyframes arrive {
		from {
			opacity: 0;
			translate: 0 calc(var(--from, 1) * 0.5rem);
		}
	}

	.title {
		font-size: 1.375rem;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}

	.loading {
		animation: breathe 1.4s ease-in-out infinite alternate;
		font-size: 1.0625rem;
	}

	@keyframes breathe {
		to {
			opacity: 0.45;
		}
	}

	.sub,
	.hint {
		color: var(--muted);
	}

	.meta {
		align-items: center;
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}

	.status {
		background: rgb(255 255 255 / 0.1);
		border-radius: 999px;
		color: var(--ink);
		font-size: 0.6875rem;
		font-weight: 650;
		padding: 0.0625rem 0.5rem;

		&.published {
			background: color-mix(in srgb, var(--glow) 32%, transparent);
			box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--glow) 50%, transparent);
		}
	}

	kbd {
		background: rgb(255 255 255 / 0.1);
		border-radius: 0.3125rem;
		box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.12);
		color: var(--ink);
		font: inherit;
		font-size: 0.75rem;
		padding: 0 0.3125rem;
	}

	.changes {
		border-block-start: 1px solid rgb(255 255 255 / 0.08);
		display: grid;
		gap: 0.3125rem;
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0.625rem 0 0;
	}

	.change {
		align-items: center;
		animation: arrive 0.4s var(--ease) both;
		animation-delay: calc(0.05s + var(--n) * 40ms);
		display: flex;
		gap: 0.5rem;
		min-inline-size: 0;
		white-space: nowrap;

		&.added {
			--tone: #5ee6a0;
		}
		&.removed {
			--tone: #ff8a8d;
		}
		&.edited {
			--tone: #ffc66b;
		}
		&.reordered {
			--tone: #8fb3ff;
		}

		&.more {
			color: var(--muted);
			padding-inline-start: 1.625rem;
		}
	}

	.mark {
		background: color-mix(in srgb, var(--tone, #fff) 20%, transparent);
		block-size: 1.125rem;
		border-radius: 0.375rem;
		color: var(--tone, #fff);
		display: grid;
		flex: none;
		font-size: 0.75rem;
		font-weight: 800;
		inline-size: 1.125rem;
		place-items: center;
	}

	.what {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.what .hint {
		margin-inline-start: 0.3em;
	}

	.problem {
		color: #ff8a8d;
	}

	.done {
		align-items: center;
		animation: arrive 0.4s var(--ease) both;
		display: flex;
		font-size: 0.9375rem;
		font-weight: 650;
		gap: 0.625rem;
		padding-block: 0.25rem;

		svg {
			background: var(--glow);
			block-size: 1.75rem;
			border-radius: 50%;
			box-shadow: 0 0 1.25rem var(--glow);
			color: #fff;
			flex: none;
			inline-size: 1.75rem;
			padding: 0.25rem;
		}
	}

	.actions {
		display: flex;
		gap: 0.375rem;
		justify-content: flex-end;
		margin-block-start: 0.625rem;
	}

	button:not(.ghost) {
		background: rgb(255 255 255 / 0.1);
		border: 0;
		border-radius: 0.625rem;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 0.875rem;
		transition:
			background 0.15s ease,
			box-shadow 0.15s ease,
			scale 0.15s ease;

		&:hover:not(:disabled) {
			background: rgb(255 255 255 / 0.16);
		}

		&:active:not(:disabled) {
			scale: 0.97;
		}

		&.primary {
			background: var(--accent);
			box-shadow: 0 0.375rem 1.25rem -0.25rem color-mix(in srgb, var(--accent) 70%, transparent);
			color: var(--accent-ink);

			&:hover:not(:disabled) {
				background: color-mix(in oklab, var(--accent), #fff 12%);
			}
		}

		&:disabled {
			cursor: default;
			opacity: 0.5;
		}
	}

	@media (max-width: 480px) {
		.time {
			--top: 2.75rem;
			--side: 0.5rem;
			--bottom: 0.5rem;
			--rise: 7rem;
		}

		.rail {
			block-size: 40vh;
			inline-size: 3.25rem;
			inset-block-start: calc(var(--top) + 2.5rem);
			inset-inline-end: 1rem;
		}

		.tick {
			inset-inline-end: 0.75rem;
		}

		.thumb {
			inline-size: 2rem;
			inset-inline-end: 0.625rem;
		}

		.card {
			inline-size: calc(100vw - 1.75rem);
			inset-block-end: 1rem;
		}
	}

	/* calm: no flying or gliding, only fades */
	@media (prefers-reduced-motion: reduce) {
		.frame,
		.void,
		.ghost,
		.rail,
		.card,
		.thumb,
		.peek,
		.void::before,
		.void::after {
			transition-property: opacity, background-color, box-shadow;
		}

		.void::after,
		.moment,
		.change,
		.done,
		.loading {
			animation: none;
		}
	}

	/* the editor's own bar and toasts step aside while it travels */
	:global(html[data-storyloco-time] [data-storyloco="bar"]),
	:global(html[data-storyloco-time] [data-storyloco="toast"]) {
		display: none !important;
	}

	:global(html[data-storyloco-time]::view-transition) {
		background: #050816;
	}

	/* the machine itself stays live and still while the page travels behind it */
	:global(html[data-storyloco-time]::view-transition-old(storyloco-time-frame)),
	:global(html[data-storyloco-time]::view-transition-old(storyloco-time-void)),
	:global(html[data-storyloco-time]::view-transition-old(storyloco-time-rail)),
	:global(html[data-storyloco-time]::view-transition-old(storyloco-time-card)) {
		display: none;
	}
	:global(html[data-storyloco-time]::view-transition-new(storyloco-time-frame)),
	:global(html[data-storyloco-time]::view-transition-new(storyloco-time-void)),
	:global(html[data-storyloco-time]::view-transition-new(storyloco-time-rail)),
	:global(html[data-storyloco-time]::view-transition-new(storyloco-time-card)) {
		animation: none;
	}

	:global(html[data-storyloco-time]::view-transition-old(root)),
	:global(html[data-storyloco-time]::view-transition-new(root)) {
		--storyloco-pass: 1.12;
		--storyloco-sink: 0.88;
		--storyloco-lift: -3.5rem;
		animation-duration: 0.5s;
		animation-fill-mode: both;
		animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
		mix-blend-mode: normal;
		transform-origin: 50% 0;
	}

	/* dragging and scrolling: the same journey, lighter and quicker, so it keeps up */
	:global(html[data-storyloco-time~="quick"]::view-transition-old(root)),
	:global(html[data-storyloco-time~="quick"]::view-transition-new(root)) {
		--storyloco-pass: 1.035;
		--storyloco-sink: 0.965;
		--storyloco-lift: -1rem;
		animation-duration: 0.24s;
	}

	/* back in time: the page now flies past the viewer, the earlier one comes forward from the stack */
	:global(html[data-storyloco-time~="back"]::view-transition-old(root)) {
		animation-name: storyloco-time-pass-out;
		z-index: 1;
	}
	:global(html[data-storyloco-time~="back"]::view-transition-new(root)) {
		animation-name: storyloco-time-stack-in;
	}
	/* forward: the page sinks back into the stack, the later one arrives from in front */
	:global(html[data-storyloco-time~="forward"]::view-transition-old(root)) {
		animation-name: storyloco-time-stack-out;
	}
	:global(html[data-storyloco-time~="forward"]::view-transition-new(root)) {
		animation-name: storyloco-time-pass-in;
	}

	/* opacity, scale and translate only: the compositor moves the snapshots, nothing repaints */
	@keyframes -global-storyloco-time-pass-out {
		to {
			opacity: 0;
			scale: var(--storyloco-pass);
			translate: 0 1.5rem;
		}
	}

	@keyframes -global-storyloco-time-pass-in {
		from {
			opacity: 0;
			scale: var(--storyloco-pass);
			translate: 0 1.5rem;
		}
	}

	@keyframes -global-storyloco-time-stack-out {
		to {
			opacity: 0;
			scale: var(--storyloco-sink);
			translate: 0 var(--storyloco-lift);
		}
	}

	@keyframes -global-storyloco-time-stack-in {
		from {
			opacity: 0;
			scale: var(--storyloco-sink);
			translate: 0 var(--storyloco-lift);
		}
	}
</style>
