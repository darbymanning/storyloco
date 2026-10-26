<!--
	@component
	The draft and what's live, one at a time: a switch flips the page between them in place,
	scrolled to the same spot, and the draft marks the blocks that aren't live yet.
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { editor, on_navigate, review, set_editing } from "./client.js"

	let { label, close }: { label: (name: string) => string; close: () => void } = $props()

	type Box = { top: number; left: number; width: number; height: number }
	/** `inside`: the block's top is off screen, so its tag sits inside the part that shows */
	type Mark = { uid: string; kind: string; name: string; box: Box; inside: boolean }
	type Change = { uid: string; component: string; kind: string; hint?: string }

	let side = $state<"draft" | "live">("draft")
	let loaded = $state(false)
	let leaving = $state(false)
	let frame = $state<HTMLIFrameElement>()
	let toggle = $state<HTMLElement>()
	let changes = $state.raw<Array<Change> | null>(null)
	let marks = $state.raw<Array<Mark>>([])
	/** The list of what's changed, open */
	let listing = $state(false)
	/** A block just gone to from the list, lit up for a moment */
	let flash = $state<string | null>(null)

	/** To a changed block on the draft, scrolled into the middle of the window */
	function go_to(uid: string) {
		listing = false
		side = "draft"
		element_of(uid)?.scrollIntoView({ behavior: still() ? "instant" : "smooth", block: "center" })
		flash = uid
		setTimeout(() => flash === uid && (flash = null), 1600)
	}

	const never = $derived(!editor.story?.published_at)
	const src = $derived.by(() => {
		const url = new URL(location.href)
		url.searchParams.set("_storyloco_live", "1")
		return url.href
	})

	const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

	const KINDS: Record<string, string> = { added: "New", edited: "Edited", reordered: "Moved" }

	/** The live page scrolled to where the draft is */
	function follow() {
		frame?.contentWindow?.scrollTo({ top: scrollY, left: scrollX, behavior: "instant" })
	}

	const element_of = (uid: string) =>
		[...document.querySelectorAll<HTMLElement>("[data-blok-c]")].find((node) => {
			try {
				return JSON.parse(node.dataset.blokC ?? "{}").uid === uid
			} catch {
				return false
			}
		})

	/** Where each changed block is on screen now */
	function measure() {
		if (!changes) return
		marks = changes.flatMap((change) => {
			if (!KINDS[change.kind]) return []
			const node = element_of(change.uid)
			const box = node?.getBoundingClientRect()
			if (!box || !box.height || box.bottom < 0 || box.top > innerHeight) return []
			// what shows of a block taller or wider than the window, so its outline is always seen
			const top = Math.max(box.top, 4)
			const left = Math.max(box.left, 4)
			const bottom = Math.min(box.bottom, innerHeight - 4)
			const right = Math.min(box.right, innerWidth - 4)
			return [
				{
					uid: change.uid,
					kind: change.kind,
					name: label(change.component),
					box: { top, left, width: right - left, height: bottom - top },
					inside: box.top < 28,
				},
			]
		})
	}

	let frame_id = 0
	const soon = () => {
		cancelAnimationFrame(frame_id)
		frame_id = requestAnimationFrame(() => {
			follow()
			measure()
		})
	}

	onMount(() => {
		const was_editing = editor.editing
		const root = document.documentElement
		// the draft as visitors would see it, without outlines and pins
		set_editing(false, false)
		root.dataset.storylocoCompare = ""
		tick().then(() => toggle?.querySelector<HTMLElement>("[aria-checked=true]")?.focus())
		review()
			.then((stories) => {
				changes = stories.flatMap((story) => story.changes ?? [])
				measure()
			})
			.catch(() => (changes = []))
		const stop = on_navigate(close)
		return () => {
			stop()
			cancelAnimationFrame(frame_id)
			delete root.dataset.storylocoCompare
			set_editing(was_editing, false)
		}
	})

	function flip(to: "draft" | "live" = side === "draft" ? "live" : "draft") {
		if (to === "live" && !loaded) return
		follow()
		side = to
	}

	function keys(event: KeyboardEvent) {
		const typing =
			event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")
		if (event.key === "Escape") {
			event.preventDefault()
			// the list first, then the comparison
			if (listing) listing = false
			else leave()
		} else if (!typing && !event.metaKey && !event.ctrlKey && event.key?.toLowerCase() === "l") {
			event.preventDefault()
			flip()
		}
	}

	function leave() {
		if (leaving) return
		leaving = true
		setTimeout(close, still() ? 0 : 280)
	}
</script>

<svelte:window onscroll={soon} onresize={soon} onkeydown={keys} />

<div class={["compare", side, { loaded, leaving }]} data-storyloco="compare">
	{#if never}
		<div class="bar card" role="status">
			<p class="title">Not live yet</p>
			<p class="sub">
				This page has never been published, so there's nothing live to compare it with.
			</p>
			<div class="actions"><button type="button" onclick={leave}>Done</button></div>
		</div>
	{:else}
		<iframe
			bind:this={frame}
			title="This page as it is live"
			{src}
			tabindex="-1"
			aria-hidden={side !== "live"}
			onload={() => {
				follow()
				loaded = true
			}}
		></iframe>

		<div class="marks" aria-hidden="true">
			{#each marks as mark (mark.uid)}
				<span
					class={["mark", { inside: mark.inside, flash: mark.uid === flash }]}
					data-kind={mark.kind}
					style:top="{mark.box.top}px"
					style:left="{mark.box.left}px"
					style:width="{mark.box.width}px"
					style:height="{mark.box.height}px"
				>
					<span class="tag">{KINDS[mark.kind]} · {mark.name}</span>
				</span>
			{/each}
		</div>

		{#if listing && changes?.length}
			<div class="list" role="dialog" aria-label="What's changed since it was published">
				<p class="head">Not live yet</p>
				<ul>
					{#each changes as change, i (`${change.uid}:${change.kind}:${i}`)}
						{@const what = `${KINDS[change.kind] ?? "Removed"}`}
						<li style:--i={i}>
							{#if change.kind === "removed"}
								<span class="row gone">
									<i data-kind="removed"></i>
									<span><b>{what}</b> {label(change.component)}</span>
									{#if change.hint}<span class="said">“{change.hint}”</span>{/if}
								</span>
							{:else}
								<button type="button" class="row" onclick={() => go_to(change.uid)}>
									<i data-kind={change.kind}></i>
									<span><b>{what}</b> {label(change.component)}</span>
									{#if change.hint}<span class="said">“{change.hint}”</span>{/if}
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="bar" role="group" aria-label="Compare with live">
			<div bind:this={toggle} class="switch" role="radiogroup" aria-label="Show">
				<span class="pill" aria-hidden="true"></span>
				{#each ["draft", "live"] as const as which (which)}
					<button
						type="button"
						role="radio"
						aria-checked={side === which}
						tabindex={side === which ? 0 : -1}
						disabled={which === "live" && !loaded}
						onclick={() => flip(which)}
						onkeydown={(e) => {
							if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
								e.preventDefault()
								flip()
								tick().then(() =>
									toggle?.querySelector<HTMLElement>("[aria-checked=true]")?.focus()
								)
							}
						}}
					>
						{which === "draft" ? "Draft" : "Live"}
						{#if which === "live" && !loaded}<span class="loading" aria-label="loading"></span>{/if}
					</button>
				{/each}
			</div>
			{#if side === "draft" && changes?.length}
				<button
					type="button"
					class="count changes"
					aria-expanded={listing}
					onclick={() => (listing = !listing)}
				>
					{changes.length} change{changes.length === 1 ? "" : "s"}
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
				</button>
			{:else}
				<span class="count" aria-live="polite">
					{side === "live"
						? "What visitors see now"
						: changes === null
							? "Finding changes…"
							: "Nothing new since it was published"}
				</span>
			{/if}
			<span class="hint" aria-hidden="true"><kbd>L</kbd> flips</span>
			<button type="button" class="done" onclick={leave}>Done</button>
		</div>
	{/if}
</div>

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.compare) :not(svg, svg *) {
		all: revert;
	}

	.compare {
		color-scheme: dark;

		--glass: rgb(16 22 42 / 0.84);
		--ink: #f4f6fb;
		--muted: rgb(244 246 251 / 0.62);
		--accent: var(--editor-accent, #05807f);
		--accent-ink: var(--editor-accent-ink, #fff);
		--live: #ffb224;
		--spring: cubic-bezier(0.2, 0.9, 0.25, 1.15);

		color: var(--ink);
		font: var(--editor-font, 500 0.8125rem/1.4 system-ui, sans-serif);

		& * {
			box-sizing: border-box;
		}
	}

	iframe {
		background: #fff;
		block-size: 100vh;
		border: 0;
		inline-size: 100vw;
		inset: 0;
		opacity: 0;
		pointer-events: none;
		position: fixed;
		transition:
			opacity 0.28s ease,
			filter 0.28s ease;
		filter: blur(2px);
		z-index: 2147483000;

		.live & {
			filter: none;
			opacity: 1;
		}
	}

	.marks {
		inset: 0;
		pointer-events: none;
		position: fixed;
		transition: opacity 0.2s ease;
		z-index: 2147482999;

		.live & {
			opacity: 0;
		}
	}

	.mark {
		--c: var(--accent);

		border-radius: 0.375rem;
		box-shadow:
			0 0 0 2px var(--c),
			0 0 0 6px color-mix(in oklab, var(--c) 18%, transparent);
		position: fixed;

		&[data-kind="added"] {
			--c: #30a46c;
		}

		&[data-kind="reordered"] {
			--c: #8e4ec6;
		}

		@starting-style {
			opacity: 0;
			scale: 1.02;
		}
		transition:
			opacity 0.3s ease,
			scale 0.4s var(--spring);
	}

	.inside .tag {
		border-radius: 0 0 0.3125rem 0;
		inset-block: 0 auto;
		inset-inline-start: 0;
	}

	.tag {
		background: var(--c);
		border-radius: 0.3125rem 0.3125rem 0.3125rem 0;
		color: #fff;
		font-size: 0.6875rem;
		font-weight: 700;
		inset-block-end: 100%;
		inset-inline-start: -2px;
		max-inline-size: 16rem;
		overflow: hidden;
		padding: 0.1875rem 0.5rem;
		position: absolute;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar {
		align-items: center;
		backdrop-filter: blur(16px);
		background: var(--glass);
		border-radius: 999px;
		box-shadow:
			0 0 0 1px rgb(255 255 255 / 0.1),
			0 16px 40px rgb(0 0 0 / 0.4);
		display: flex;
		gap: 0.75rem;
		inset-block-end: 1.5rem;
		inset-inline-start: 50%;
		max-inline-size: calc(100vw - 2rem);
		padding: 0.3125rem 0.3125rem 0.3125rem 0.3125rem;
		position: fixed;
		translate: -50% 0;
		z-index: 2147483002;

		@starting-style {
			opacity: 0;
			translate: -50% 1rem;
		}
		transition:
			opacity 0.3s ease,
			translate 0.45s var(--spring);

		.leaving & {
			opacity: 0;
			translate: -50% 1rem;
		}
	}

	.switch {
		background: rgb(255 255 255 / 0.08);
		border-radius: 999px;
		display: grid;
		/* the same width each, whatever they say, so the pill under them never changes size */
		grid-template-columns: repeat(2, minmax(0, 1fr));
		inline-size: 11rem;
		padding: 0.1875rem;
		position: relative;

		& button {
			background: none;
			border: 0;
			border-radius: 999px;
			color: var(--muted);
			cursor: pointer;
			font: inherit;
			font-weight: 650;
			align-items: center;
			display: inline-flex;
			gap: 0.375rem;
			justify-content: center;
			padding: 0.375rem 0.875rem;
			position: relative;
			transition: color 0.2s ease;
			white-space: nowrap;
			z-index: 1;

			&[aria-checked="true"] {
				color: #10162a;
			}

			&:focus-visible {
				outline: 2px solid var(--ink);
				outline-offset: 1px;
			}

			&:disabled {
				cursor: progress;
				opacity: 0.6;
			}
		}
	}

	/* one pill slides under whichever is showing, in its colour */
	.pill {
		background: color-mix(in oklab, var(--accent) 55%, #fff);
		border-radius: 999px;
		inset: 0.1875rem auto 0.1875rem 0.1875rem;
		inline-size: calc(50% - 0.1875rem);
		position: absolute;
		transition:
			translate 0.4s var(--spring),
			background-color 0.3s ease;

		.live & {
			background: var(--live);
			translate: 100% 0;
		}
	}

	.count {
		color: var(--muted);
		font-weight: 600;
		white-space: nowrap;
	}

	button.changes {
		align-items: center;
		background: none;
		border: 0;
		border-radius: 999px;
		color: var(--ink);
		cursor: pointer;
		display: inline-flex;
		font: inherit;
		font-weight: 650;
		gap: 0.25rem;
		margin-inline: -0.5rem;
		padding: 0.375rem 0.5rem;

		&:hover {
			background: rgb(255 255 255 / 0.1);
		}

		& svg {
			block-size: 0.875rem;
			fill: none;
			inline-size: 0.875rem;
			stroke: currentColor;
			stroke-width: 2.25;
			transition: rotate 0.3s var(--spring);
		}

		&[aria-expanded="true"] svg {
			rotate: 180deg;
		}
	}

	.loading {
		animation: storyloco-compare-pulse 1s ease-in-out infinite alternate;
		background: var(--live);
		block-size: 0.375rem;
		border-radius: 50%;
		inline-size: 0.375rem;
	}

	@keyframes -global-storyloco-compare-pulse {
		from {
			opacity: 0.25;
		}
	}

	.list {
		backdrop-filter: blur(16px);
		background: var(--glass);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px rgb(255 255 255 / 0.1),
			0 16px 40px rgb(0 0 0 / 0.4);
		inline-size: min(26rem, 100vw - 2rem);
		inset-block-end: 4.75rem;
		inset-inline-start: 50%;
		max-block-size: 50vh;
		overflow: auto;
		padding: 0.5rem;
		position: fixed;
		translate: -50% 0;
		z-index: 2147483002;

		@starting-style {
			opacity: 0;
			scale: 0.96;
			translate: -50% 0.5rem;
		}
		transform-origin: 50% 100%;
		transition:
			opacity 0.2s ease,
			scale 0.35s var(--spring),
			translate 0.35s var(--spring);

		& .head {
			color: var(--muted);
			font-size: 0.6875rem;
			font-weight: 700;
			letter-spacing: 0.06em;
			margin: 0.25rem 0.5rem 0.375rem;
			text-transform: uppercase;
		}

		& ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}

		& li {
			@starting-style {
				opacity: 0;
				translate: 0 0.25rem;
			}
			transition:
				opacity 0.25s ease calc(var(--i) * 25ms),
				translate 0.35s var(--spring) calc(var(--i) * 25ms);
		}
	}

	.row {
		align-items: baseline;
		background: none;
		border: 0;
		border-radius: 0.625rem;
		color: var(--ink);
		cursor: pointer;
		display: grid;
		font: inherit;
		gap: 0.125rem 0.625rem;
		grid-template-columns: auto 1fr;
		inline-size: 100%;
		padding: 0.5rem;
		text-align: start;

		&:hover:not(.gone) {
			background: rgb(255 255 255 / 0.08);
		}

		&.gone {
			cursor: default;
			opacity: 0.7;
		}

		& i {
			--c: var(--accent);

			background: var(--c);
			block-size: 0.5rem;
			border-radius: 50%;
			inline-size: 0.5rem;

			&[data-kind="added"] {
				--c: #30a46c;
			}
			&[data-kind="reordered"] {
				--c: #8e4ec6;
			}
			&[data-kind="removed"] {
				--c: #e5484d;
			}
		}

		& .said {
			color: var(--muted);
			grid-column: 2;
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.mark.flash {
		animation: storyloco-compare-flash 1.4s ease-out;
	}

	@keyframes -global-storyloco-compare-flash {
		0%,
		40% {
			box-shadow:
				0 0 0 3px var(--c),
				0 0 0 14px color-mix(in oklab, var(--c) 30%, transparent);
		}
	}

	.hint {
		color: var(--muted);
		white-space: nowrap;
	}

	kbd {
		border: 1px solid rgb(255 255 255 / 0.25);
		border-radius: 0.3125rem;
		font:
			600 0.625rem/1 ui-monospace,
			monospace;
		padding: 0.1875rem 0.375rem;
	}

	button.done,
	.card button {
		background: rgb(255 255 255 / 0.12);
		border: 0;
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 650;
		padding: 0.4375rem 0.875rem;

		&:hover {
			background: rgb(255 255 255 / 0.18);
		}
	}

	.card {
		border-radius: 1rem;
		display: grid;
		gap: 0.375rem;
		inline-size: min(24rem, 100vw - 2rem);
		padding: 0.875rem 1rem;

		& .title {
			font-size: 1rem;
			font-weight: 700;
			margin: 0;
		}

		& .sub {
			color: var(--muted);
			margin: 0;
		}

		& .actions {
			display: flex;
			justify-content: flex-end;
		}
	}

	/* the editor's own bar and toasts step aside while comparing */
	:global(html[data-storyloco-compare] [data-storyloco="bar"]),
	:global(html[data-storyloco-compare] [data-storyloco="toast"]) {
		display: none !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.compare *,
		.compare *::before {
			transition-duration: 0.01s !important;
		}
	}

	@media (max-width: 560px) {
		.hint {
			display: none;
		}
		.bar {
			gap: 0.5rem;
			inset-block-end: 1rem;
		}
		.count {
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
		}
	}
</style>
