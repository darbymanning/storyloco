<!--
	@component
	The accessibility check: what's wrong with the page in front of you, beside it rather than over
	it, so each problem can be seen where it is and fixed from here where that's possible.
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { audit, see_as, VISIONS, type Issue, type Vision } from "./a11y.js"
	import { on_navigate, on_saved } from "./client.js"
	import { next_frame, page_origin } from "./page.js"

	type Block = { story: number; uid: string; name: string }

	let {
		is_field,
		block_at,
		open_block,
		edit_image,
		close,
	}: {
		/** Whether an image is a field someone fills in */
		is_field: (img: HTMLImageElement) => Promise<boolean>
		/** The block an element is in, when it's in one */
		block_at: (el: Element) => Block | null
		open_block: (block: Block) => void
		/** Open the image's field to change its alt text */
		edit_image: (img: HTMLImageElement) => void
		close: () => void
	} = $props()

	const GROUPS: ReadonlyArray<[Issue["group"], string]> = [
		["images", "Images"],
		["contrast", "Colour contrast"],
		["headings", "Headings"],
		["links", "Links and buttons"],
		["forms", "Forms"],
		["video", "Video"],
		["page", "The page"],
	]

	let issues = $state.raw<Array<Issue>>([])
	/** Images in this list are fields, so they can be fixed from here */
	let fields = $state.raw(new Set<Element>())
	let checking = $state(true)
	let panel = $state<HTMLElement>()
	let vision = $state<Vision>(null)
	/** The element being pointed out on the page */
	let pointed = $state<Element | null>(null)
	let ring = $state<{ top: number; left: number; width: number; height: number } | null>(null)

	const to_fix = $derived(issues.filter((issue) => issue.severity === "fail").length)
	const to_check = $derived(issues.length - to_fix)
	const summary = $derived.by(() => {
		if (checking) return "Checking this page…"
		if (!issues.length) return "Nothing found on this page"
		const said = [to_fix && `${to_fix} to fix`, to_check && `${to_check} to check`]
		return said.filter(Boolean).join(" · ")
	})
	const grouped = $derived(
		GROUPS.map(([group, name]) => ({
			name,
			rows: issues
				.filter((issue) => issue.group === group)
				.sort((a, b) => Number(a.severity === "review") - Number(b.severity === "review")),
		})).filter(({ rows }) => rows.length)
	)

	let run_id = 0
	async function check() {
		const run = ++run_id
		checking = true
		const images = new Set<Element>()
		const asked = new Map<Element, Promise<boolean>>()
		const field = (img: HTMLImageElement) => {
			let known = asked.get(img)
			if (!known) asked.set(img, (known = is_field(img)))
			return known
		}
		const found = await audit(field)
		// a bad alt can be fixed from here too, not only a missing one
		await Promise.all(
			found.map(async ({ el }) => {
				if (el instanceof HTMLImageElement && (await field(el).catch(() => false))) images.add(el)
			})
		)
		if (run !== run_id) return
		issues = found
		fields = images
		checking = false
		point(null)
	}

	function place() {
		if (!pointed?.isConnected) return (ring = null)
		const box = pointed.getBoundingClientRect()
		const origin = page_origin()
		ring = {
			top: box.top - 4 - origin.top,
			left: box.left - 4 - origin.left,
			width: box.width + 8,
			height: box.height + 8,
		}
	}

	function point(el: Element | null) {
		pointed = el
		place()
	}

	function show(el: Element | null) {
		if (!el?.isConnected) return
		const box = el.getBoundingClientRect()
		const away = box.bottom < 0 || box.top > innerHeight
		el.scrollIntoView({ block: away ? "center" : "nearest", behavior: "smooth" })
		point(el)
	}

	function chosen(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value
		vision = (value || null) as Vision
		see_as(vision)
	}

	function key(event: KeyboardEvent) {
		// the image picker over this takes its own Escape
		if (event.key === "Escape" && !document.querySelector("dialog[open]")) close()
	}

	onMount(() => {
		const back = document.activeElement as HTMLElement | null
		check()
		tick().then(() => panel?.focus())
		// a change re-renders the page, which takes a moment to land
		let later: ReturnType<typeof setTimeout> | undefined
		const again = () => {
			clearTimeout(later)
			later = setTimeout(check, 400)
		}
		const stop_saved = on_saved(again)
		const stop_navigate = on_navigate(again)
		const follow = next_frame(place)
		addEventListener("scroll", follow, { passive: true })
		addEventListener("resize", follow)
		return () => {
			clearTimeout(later)
			run_id++
			stop_saved()
			stop_navigate()
			removeEventListener("scroll", follow)
			removeEventListener("resize", follow)
			see_as(null)
			if (back?.isConnected) back.focus({ preventScroll: true })
		}
	})
</script>

<svelte:window onkeydown={key} />

{#if ring}
	<div
		class="ring"
		data-storyloco="a11y-ring"
		aria-hidden="true"
		style:top="{ring.top}px"
		style:left="{ring.left}px"
		style:width="{ring.width}px"
		style:height="{ring.height}px"
	></div>
{/if}

<aside
	bind:this={panel}
	class="a11y"
	data-storyloco="a11y"
	aria-label="Accessibility check"
	tabindex="-1"
>
	<header>
		<div>
			<h2>Accessibility</h2>
			<p role="status">
				{summary}
			</p>
		</div>
		<button
			class="round"
			class:spinning={checking}
			type="button"
			aria-label="Check again"
			disabled={checking}
			onclick={check}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path
					d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
				/><path d="M8 16H3v5" /></svg
			>
		</button>
		<button class="round" type="button" aria-label="Close" onclick={close}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
		</button>
	</header>

	<div class="list">
		{#if !checking && !issues.length}
			<p class="clear">
				No problems an automatic check can find. It’s still worth trying the page with only a
				keyboard.
			</p>
		{/if}
		{#each grouped as { name, rows } (name)}
			<section>
				<h3>{name}</h3>
				<ul>
					{#each rows as issue (issue.key)}
						{@const el = issue.el}
						{@const block = el?.isConnected ? block_at(el) : null}
						<li
							class:review={issue.severity === "review"}
							onpointerenter={() => point(el)}
							onpointerleave={() => point(null)}
							onfocusin={() => point(el)}
						>
							<button class="what" type="button" disabled={!el} onclick={() => show(el)}>
								<span class="title">
									{issue.title}{#if issue.count > 1}<small> ×{issue.count}</small>{/if}
								</span>
								{#if issue.sample}<span class="sample">{issue.sample}</span>{/if}
								<span class="why">{issue.why}</span>
							</button>
							{#if issue.colours}
								<p class="colours">
									<span
										class="chip"
										style:color={issue.colours.fg}
										style:background={issue.colours.bg}>Aa</span
									>
									<svg viewBox="0 0 24 24" aria-hidden="true"
										><path d="M5 12h14m-6-6 6 6-6 6" /></svg
									>
									<span
										class="chip"
										style:color={issue.colours.suggestion}
										style:background={issue.colours.bg}>Aa</span
									>
									<span>Try <code>{issue.colours.suggestion}</code> on {issue.colours.bg}</span>
								</p>
							{/if}
							{#if (el && fields.has(el)) || block}
								<p class="actions">
									{#if el && fields.has(el)}
										<button
											class="action"
											type="button"
											onclick={() => edit_image(el as HTMLImageElement)}
										>
											{issue.title === "No alt text" ? "Add alt text" : "Edit alt text"}
										</button>
									{/if}
									{#if block}
										<button class="action" type="button" onclick={() => open_block(block)}>
											Open {block.name}
										</button>
									{/if}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>

	<footer>
		<label>
			<span>See the page with</span>
			<select onchange={chosen}>
				{#each VISIONS as { id, name } (name)}
					<option value={id ?? ""} selected={vision === id}>{name}</option>
				{/each}
			</select>
		</label>
		<p>This page, at this screen width. Automatic checks only catch part of what matters.</p>
	</footer>
</aside>

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.a11y) :not(svg, svg *) {
		all: revert;
	}

	.ring {
		border-radius: 0.375rem;
		box-shadow:
			0 0 0 2px #e5484d,
			0 0 0 5px rgb(229 72 77 / 0.25);
		pointer-events: none;
		position: absolute;
		z-index: 2147483000;
	}

	.a11y {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--editor-bg, #fff);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--danger: var(--editor-danger, #e5484d);

		backdrop-filter: blur(20px) saturate(1.8);
		background:
			linear-gradient(color-mix(in srgb, var(--accent) 9%, transparent), transparent 12rem),
			color-mix(in srgb, var(--bg) 88%, transparent);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 12px 32px rgb(27 36 63 / 0.18);
		box-sizing: border-box;
		color: var(--ink);
		display: grid;
		font:
			400 0.8125rem/1.45 system-ui,
			sans-serif;
		grid-template-rows: auto minmax(0, 1fr) auto;
		inline-size: min(23rem, calc(100vw - 2rem));
		inset: 1rem 1rem 1rem auto;
		outline: none;
		position: fixed;
		z-index: 2147483001;

		/* clear of the settings on a small screen, the page still showing above */
		@media (max-width: 40rem) {
			block-size: 55vh;
			inset: auto 0.5rem 0.5rem;
			inline-size: auto;
		}

		@starting-style {
			opacity: 0;
			translate: 0.5rem 0;
		}

		transition:
			opacity 0.2s ease,
			translate 0.2s ease;
	}

	header {
		align-items: center;
		border-block-end: 1px solid var(--line);
		display: flex;
		gap: 0.25rem;
		padding: 0.75rem 0.625rem 0.75rem 1rem;

		& > div {
			flex: 1;
			min-inline-size: 0;
		}

		& h2 {
			font-size: 0.9375rem;
			font-weight: 600;
			margin: 0;
		}

		& p {
			color: var(--muted);
			font-size: 0.75rem;
			margin: 0;
		}
	}

	.round {
		align-items: center;
		background: none;
		block-size: 1.75rem;
		border: 0;
		border-radius: 50%;
		color: var(--muted);
		cursor: pointer;
		display: flex;
		flex: none;
		inline-size: 1.75rem;
		justify-content: center;
		padding: 0;

		&:hover:not(:disabled) {
			background: color-mix(in srgb, var(--ink) 10%, transparent);
			color: var(--ink);
		}

		&:disabled {
			cursor: wait;
		}

		&.spinning svg {
			animation: spin 1s linear infinite;
		}

		@media (prefers-reduced-motion: reduce) {
			&.spinning svg {
				animation: none;
			}
		}

		& svg {
			block-size: 1rem;
			fill: none;
			inline-size: 1rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-linejoin: round;
			stroke-width: 2;
		}
	}

	.list {
		min-block-size: 0;
		overflow: auto;
		padding: 0.25rem 0.5rem 0.75rem;
	}

	.clear {
		color: var(--muted);
		margin: 0.75rem 0.5rem;
	}

	section {
		margin-block-start: 0.5rem;
	}

	h3 {
		color: var(--muted);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		margin: 0.5rem 0.5rem 0.25rem;
		text-transform: uppercase;
	}

	ul {
		display: grid;
		gap: 0.125rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		border-radius: 0.5rem;
		padding: 0.25rem;
		transition: background-color 0.15s;

		&:hover,
		&:focus-within {
			background: color-mix(in srgb, var(--ink) 6%, transparent);
		}
	}

	.what {
		background: none;
		border: 0;
		border-radius: 0.375rem;
		color: inherit;
		cursor: pointer;
		display: grid;
		font: inherit;
		gap: 0.125rem;
		inline-size: 100%;
		padding: 0.25rem 0.25rem 0.25rem 1.125rem;
		position: relative;
		text-align: start;

		/* a filled mark for a problem, a hollow one for something to look at, not by colour alone */
		&::before {
			background: var(--danger);
			block-size: 0.5rem;
			border-radius: 50%;
			content: "";
			inline-size: 0.5rem;
			inset: 0.6rem auto auto 0.25rem;
			position: absolute;
		}

		&:disabled {
			cursor: default;
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: -1px;
		}
	}

	.review .what::before {
		background: none;
		box-shadow: inset 0 0 0 2px var(--muted);
	}

	.title {
		font-weight: 600;

		& small {
			color: var(--muted);
			font-size: 0.75rem;
			font-weight: 500;
			margin-inline-start: 0.25rem;
		}
	}

	.sample {
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.why {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.colours {
		align-items: center;
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		font-size: 0.75rem;
		gap: 0.375rem;
		margin: 0.25rem 0.25rem 0.125rem 1.125rem;

		& > svg {
			block-size: 0.75rem;
			fill: none;
			flex: none;
			inline-size: 0.75rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-linejoin: round;
			stroke-width: 2;
		}

		& code {
			font:
				500 0.75rem ui-monospace,
				monospace;
		}
	}

	.chip {
		border-radius: 0.25rem;
		box-shadow: 0 0 0 1px var(--line);
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.0625rem 0.3125rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0.25rem 0.25rem 0.25rem 1.125rem;
	}

	.action {
		background: var(--field, color-mix(in srgb, var(--ink) 7%, transparent));
		border: 1px solid var(--line);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.1875rem 0.625rem;

		&:hover {
			border-color: color-mix(in srgb, var(--ink) 30%, transparent);
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 1px;
		}
	}

	footer {
		border-block-start: 1px solid var(--line);
		display: grid;
		gap: 0.375rem;
		padding: 0.625rem 1rem 0.75rem;

		& label {
			align-items: center;
			display: flex;
			font-size: 0.75rem;
			font-weight: 500;
			gap: 0.5rem;
			justify-content: space-between;
		}

		& select {
			background: transparent;
			border: 1px solid var(--line);
			border-radius: 0.375rem;
			color: inherit;
			font: inherit;
			font-weight: 400;
			min-inline-size: 0;
			padding: 0.1875rem 0.25rem;
		}

		& p {
			color: var(--muted);
			font-size: 0.6875rem;
			margin: 0;
		}
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}
</style>
