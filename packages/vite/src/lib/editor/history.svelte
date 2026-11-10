<script lang="ts">
	import { history } from "./client.js"

	let {
		go,
	}: {
		/** Step back or forward through the changes, `times` over */
		go: (back: boolean, times: number) => void
	} = $props()

	/** How many changes show at once; older ones slide off the start */
	const ROOM = 16
	/** How long it stays once nothing's happening */
	const LINGERS = 2600

	let open = $state(false)
	let said = $state("")
	let back = $state(true)
	let timer: ReturnType<typeof setTimeout> | undefined

	const steps = $derived(history.steps)
	const now = $derived(steps.done.length)
	const all = $derived([...steps.done, ...steps.undone])
	// the changes around where things stand, by their place in the whole run so each keeps its mark as it moves
	const from = $derived(Math.max(0, Math.min(now - ROOM + 4, all.length - ROOM)))
	const shown = $derived(all.slice(from, from + ROOM).map((label, i) => ({ label, at: from + i })))

	function linger() {
		clearTimeout(timer)
		timer = setTimeout(() => (open = false), LINGERS)
	}

	/** Show where things stand, saying what just happened */
	export function say(message: string, backwards: boolean) {
		said = message
		back = backwards
		open = true
		linger()
	}

	export function hide() {
		clearTimeout(timer)
		open = false
	}

	/** To just before a change, or just after one that was undone */
	const jump = (at: number) => (at < now ? go(true, now - at) : go(false, at - now + 1))
</script>

<div
	class="history"
	class:open
	data-storyloco="history"
	role="group"
	aria-label="History"
	inert={!open}
	onpointerenter={() => clearTimeout(timer)}
	onpointerleave={linger}
	onfocusin={() => clearTimeout(timer)}
	onfocusout={linger}
>
	<button
		type="button"
		aria-label="Undo"
		title="Undo · ⌘Z"
		disabled={!now}
		onclick={() => go(true, 1)}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg
		>
	</button>
	{#if shown.length}
		<ol class="track" class:more={from > 0}>
			{#each shown as { label, at } (at)}
				<li>
					<button
						type="button"
						class="mark"
						class:done={at < now}
						class:latest={at === now - 1}
						title={at < now ? `Undo to before this ${label}` : `Redo this ${label}`}
						aria-label={at < now ? `Undo to before ${label}` : `Redo ${label}`}
						aria-current={at === now - 1 ? "step" : undefined}
						onclick={() => jump(at)}
					></button>
				</li>
			{/each}
		</ol>
	{/if}
	<span class="said" role="status">
		{#key said}<span class="words" class:back>{said}</span>{/key}
	</span>
	<button
		type="button"
		aria-label="Redo"
		title="Redo · ⇧⌘Z"
		disabled={now === all.length}
		onclick={() => go(false, 1)}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg
		>
	</button>
</div>

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.history) :not(svg, svg *) {
		all: revert;
	}

	/* the toast's place and its glass, as it says what a toast would */
	.history {
		--ease: cubic-bezier(0.2, 0.8, 0.2, 1);

		align-items: center;
		backdrop-filter: blur(20px) saturate(1.8);
		background: color-mix(in srgb, var(--editor-pill, var(--editor-ink, #1b243f)) 82%, transparent);
		border-radius: 999px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
		color: #fff;
		display: flex;
		font:
			500 0.8125rem/1.25 system-ui,
			sans-serif;
		gap: 0.625rem;
		inset: auto auto 1.25rem 50%;
		max-inline-size: calc(100vw - 2rem);
		opacity: 0;
		padding: 0.25rem;
		pointer-events: none;
		position: fixed;
		transition:
			opacity 0.2s ease,
			translate 0.3s var(--ease),
			scale 0.3s var(--ease);
		translate: -50% 0.75rem;
		scale: 0.96;
		z-index: 2147483003;

		& * {
			box-sizing: border-box;
		}

		&.open {
			opacity: 1;
			pointer-events: auto;
			scale: 1;
			translate: -50% 0;
		}
	}

	button {
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		font: inherit;
		margin: 0;
		padding: 0;

		&:focus-visible {
			outline: 2px solid #fff;
			outline-offset: 1px;
		}
	}

	.history > button {
		block-size: 1.75rem;
		border-radius: 999px;
		display: grid;
		flex: none;
		inline-size: 1.75rem;
		place-items: center;
		transition:
			background-color 0.15s ease,
			opacity 0.15s ease;

		&:hover:not(:disabled) {
			background: rgb(255 255 255 / 0.16);
		}

		&:active:not(:disabled) {
			scale: 0.92;
		}

		&:disabled {
			cursor: default;
			opacity: 0.35;
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

	.track {
		align-items: center;
		display: flex;
		flex: none;
		list-style: none;
		margin: 0;
		padding: 0;

		/* more before these than there's room for */
		&.more {
			mask-image: linear-gradient(to right, transparent, #000 1.25rem);
		}

		& li {
			display: flex;
		}
	}

	/* a change: a wide enough thing to press, with a slim mark in it that stands taller once it's made */
	.mark {
		block-size: 1.75rem;
		display: grid;
		inline-size: 0.5rem;
		place-items: center;

		&::before {
			background: #fff;
			block-size: 0.5rem;
			border-radius: 999px;
			content: "";
			inline-size: 0.1875rem;
			opacity: 0.28;
			transition:
				block-size 0.35s var(--ease),
				opacity 0.25s ease,
				inline-size 0.35s var(--ease);
		}

		&.done::before {
			block-size: 0.75rem;
			opacity: 0.7;
		}

		/* where things stand */
		&.latest::before {
			block-size: 1.125rem;
			inline-size: 0.25rem;
			opacity: 1;
		}

		&:hover::before {
			opacity: 1;
		}
	}

	.said {
		display: grid;
		min-inline-size: 5.5rem;
		overflow: hidden;
		white-space: nowrap;
	}

	/* each word of it comes in from the way things went: back from the left, forward from the right */
	.words {
		animation: storyloco-said 0.3s var(--ease);
		grid-area: 1 / 1;
		--from: 0.5rem;

		&.back {
			--from: -0.5rem;
		}
	}

	@keyframes storyloco-said {
		from {
			opacity: 0;
			translate: var(--from) 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.history,
		.mark::before,
		.words {
			animation: none;
			transition: none;
		}
	}
</style>
