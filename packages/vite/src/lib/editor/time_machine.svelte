<!--
	@component
	The page's history, in place: drag the timeline, scroll it, or use the arrow keys, and the
	page shows itself as it was at each save, flying back through a stack of earlier versions
	receding into the void; Restore makes that version the draft.
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { call, editor, on_navigate, send, set_editing } from "./client.js"
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
	/** A version the site's code couldn't show, like one saved before a template changed */
	let unshowable = $state<number | null>(null)
	let busy = $state(false)
	/** Whether the page can show a version in place, which needs its story connected */
	let in_place = $state(true)
	let rail = $state<HTMLElement>()
	let machine = $state<HTMLElement>()
	/** The page as it was, in a frame of its own: the site itself, shrunk to fit the window */
	let view = $state<HTMLIFrameElement>()
	/** How small the window shows the page, so all of it shows rather than its edges cut off */
	let fit = $state(1)
	/** The room under the window, whatever's left once it's shrunk to keep the page's shape */
	let bottom = $state(0)
	/** How far below the vanishing point the window's top sits, in pixels */
	let lift = 0
	/** Whether the window is showing the page, ready for versions */
	let ready = $state(false)
	const src = location.href
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
	/** The version the page has come to rest on, which the card's details are for */
	let resting = $state(0)
	const rested = $derived(versions?.[resting])
	// worked out once a version, and only for the one the page rests on, not every one a scrub passes
	const diffs = new Map<number, Array<Difference>>()
	const changes = $derived.by<Array<Difference>>(() => {
		if (!versions || !resting) return []
		let found = diffs.get(resting)
		if (!found)
			diffs.set(resting, (found = differences(versions[0].content, versions[resting].content)))
		return found
	})
	const focus = $derived(pointer ?? index)

	const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches

	let alive = true
	/** The version the page is showing, which trails `index` while it travels */
	let shown = 0
	let moving = false
	let rest: ReturnType<typeof setTimeout> | undefined
	let settle: ReturnType<typeof setTimeout> | undefined

	onMount(() => {
		const was_editing = editor.editing
		const root = document.documentElement
		// the page as visitors see it, without outlines and pins, while it travels
		set_editing(false, false)
		root.dataset.storylocoTime = ""
		// in the top layer, so it stays lit and still while the page beneath dims for a swap
		machine?.showPopover()
		const story = editor.story
		if (!story) problem = "This page has no story to look back through"
		else
			call<{ versions: Array<Version> }>({ op: "versions", story: story.id })
				.then((reply) => {
					versions = reply.versions
					setTimeout(() => (settled = true), 1800)
				})
				.catch((e: Error) => (problem = e.message))
		tick().then(() => rail?.focus())
		measure()
		addEventListener("resize", measure)
		addEventListener("message", answered)
		// the page behind stays put; the wheel over the window scrolls the page in it
		addEventListener("wheel", still_behind, { passive: false })
		// not passive, so scrolling the timeline doesn't scroll the page too
		rail?.addEventListener("wheel", wheel, { passive: false })
		const stop = on_navigate(close)
		return () => {
			alive = false
			clearTimeout(settle)
			clearTimeout(rest)
			for (const layer of document.querySelectorAll(
				"[data-storyloco=passing], [data-storyloco=passing-behind]"
			))
				layer.remove()
			rail?.removeEventListener("wheel", wheel)
			removeEventListener("resize", measure)
			removeEventListener("message", answered)
			removeEventListener("wheel", still_behind)
			stop()
			delete root.dataset.storylocoTime
			set_editing(was_editing, false)
		}
	})

	const still_behind = (event: WheelEvent) => event.preventDefault()

	/**
	 * The window's size: the page's own, shrunk to fit under the stack, clear of the timeline beside
	 * it, and keep its shape
	 */
	function measure() {
		if (!machine) return
		const css = getComputedStyle(machine)
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
		const length = (name: string) => (parseFloat(css.getPropertyValue(name)) || 0) * rem
		const top = length("--top")
		lift = length("--rise")
		fit = Math.min(
			(innerHeight - top - length("--below")) / innerHeight,
			(innerWidth - 2 * length("--room")) / innerWidth
		)
		bottom = innerHeight * (1 - fit) - top
	}

	/** To another version; quick moves, like a drag, get a lighter transition */
	function go(next: number, quick = false) {
		if (!versions || leaving || restored) return
		unshowable = null
		next = Math.max(0, Math.min(last, next))
		if (next === index) return
		heading = next > index ? -1 : 1
		index = next
		clearTimeout(settle)
		// the timeline keeps up with a scrub at once; the page, slower to redraw, follows when it rests
		if (quick || dragging) settle = setTimeout(() => travel(true), 140)
		else travel(false)
	}

	/**
	 * Brings the window to `index`, one move at a time, skipping versions passed meanwhile. Like
	 * Time Machine: going back, the window in front flies out past the viewer as the one behind
	 * comes forward from the stack; going forward, it sinks back as the next arrives from in front.
	 * What leaves is a still copy of the window as it was. The page itself, beneath, never changes
	 */
	async function travel(quick: boolean) {
		if (!versions || moving || shown === index || !alive || !ready || !view) return
		moving = true
		const back = index > shown
		const steps = Math.abs(index - shown)
		// a scrub travels once it rests, not at every version it passes, which is more than can be
		// painted that fast; leaving, the window opens straight back out onto the page instead
		const motion = !leaving && !still() && in_place
		const old = motion ? copy_of(back) : null
		// the copy shows before the window changes under it, so nothing flashes between them
		if (old) await frame()
		if (old && !back) view.style.opacity = "0"
		const anchor = top_block()
		shown = index
		in_place = await show(shown ? versions[shown].content : null)
		hold(anchor)
		// the card's details follow once a scrub rests, rather than blinking at every version it passes
		clearTimeout(rest)
		if (quick) rest = setTimeout(() => (resting = shown), 320)
		else resting = shown
		if (old) await pass(old, back, steps)
		moving = false
		travel(true)
	}

	const frame = () => new Promise((done) => requestAnimationFrame(() => done(undefined)))

	/** Asks for the window's answers by number, as it gives them */
	let asked = 0
	const answers = new Map<number, (ok: boolean) => void>()
	function answered(event: MessageEvent) {
		const data = event.data as { storyloco?: string; id?: number; ok?: boolean } | null
		if (event.origin !== location.origin || data?.storyloco !== "shown") return
		answers.get(data.id ?? 0)?.(Boolean(data.ok))
		answers.delete(data.id ?? 0)
	}

	/** A version in the window, once it's drawn there; false when the page can't show it in place */
	function show(content: unknown, wait = 3000) {
		const id = ++asked
		return new Promise<boolean>((done) => {
			answers.set(id, done)
			view?.contentWindow?.postMessage({ storyloco: "show", id, content }, location.origin)
			setTimeout(() => answers.delete(id) && done(false), wait)
		})
	}

	/** The window open on the page: once its own editor answers, at the page's scroll, shrunk in */
	async function opened() {
		for (let i = 0; i < 40 && alive && !(await show(null, 250)); i++) await frame()
		if (!alive || !view?.contentWindow) return
		view.contentWindow.scrollTo({ top: scrollY, left: scrollX, behavior: "instant" })
		const win = view.contentWindow
		// typed in the window, the timeline still takes its keys
		win.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault()
				leave()
			} else keys(event)
		})
		win.addEventListener("error", broke)
		win.addEventListener("unhandledrejection", broke)
		// it stays on this page: a link or a form would take it to another, whose story these versions aren't
		const stay = (event: Event) => {
			const at = event.target as Element | null
			if (event.type === "submit" || at?.closest?.("a[href]")) event.preventDefault()
		}
		win.document.addEventListener("click", stay, true)
		win.document.addEventListener("submit", stay, true)
		chrome = null
		ready = true
	}

	/** Showing an old version threw: back to now, rather than the window left broken, and say so */
	function broke() {
		if (!shown || !versions) return
		const id = versions[shown].id
		go(0, true)
		unshowable = id
	}

	/** What shows behind the page where its own blocks leave it bare */
	function backdrop(doc: Document) {
		for (const el of [doc.body, doc.documentElement]) {
			const color = getComputedStyle(el).backgroundColor
			if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color
		}
		return "Canvas"
	}

	/**
	 * The window as it shows now, still and inert: the page and whatever the site keeps fixed over
	 * it, like its header, each where it is, shrunk as the window shows them. In front, it passes over
	 * the frame and the void, past the window's edge as it flies; behind, it's under the window
	 */
	function copy_of(front: boolean) {
		const doc = view?.contentDocument
		const page = doc?.querySelector<HTMLElement>("[data-blok-c]")
		if (!view || !doc || !page) return null
		const { layer, moving, at } = layer_at(view, front)
		moving.style.background = backdrop(doc)
		for (const el of [page, ...chrome_over(doc, page)]) lay(moving, el, at)
		return layer
	}

	/** A layer to pass in, over the window or under it, with a window-sized pane in it to move */
	function layer_at(view: HTMLIFrameElement, front: boolean) {
		const at = view.getBoundingClientRect()
		const layer = document.createElement("div")
		layer.dataset.storyloco = front ? "passing" : "passing-behind"
		layer.inert = true
		// the window's place, the page's own size, shrunk as the window has it
		const place = document.createElement("div")
		Object.assign(place.style, {
			position: "absolute",
			left: `${at.left}px`,
			top: `${at.top}px`,
			width: `${view.contentWindow?.innerWidth ?? innerWidth}px`,
			height: `${view.contentWindow?.innerHeight ?? innerHeight}px`,
			scale: String(fit),
			transformOrigin: "0 0",
		})
		const moving = document.createElement("div")
		Object.assign(moving.style, {
			position: "absolute",
			inset: "0",
			overflow: "hidden",
			borderRadius: `${16 / fit}px`,
			transformOrigin: "50% 0",
			willChange: "transform, opacity",
		})
		place.append(moving)
		layer.append(place)
		document.body.append(layer)
		return { layer, moving, at }
	}

	/** One of the windows passed between, as a pane of glass: only where it is, not what it showed */
	function pane(front: boolean) {
		if (!view) return null
		const { layer, moving } = layer_at(view, front)
		Object.assign(moving.style, {
			background:
				"linear-gradient(rgb(223 230 255 / 0.3), rgb(223 230 255 / 0.12) 30%, rgb(223 230 255 / 0.08))",
			boxShadow: `inset 0 0 0 ${1.5 / fit}px rgb(255 255 255 / 0.3), inset 0 ${1.5 / fit}px 0 rgb(255 255 255 / 0.55)`,
		})
		return layer
	}

	/** A copy of an element of the window's page, exactly where it shows in the window */
	function lay(moving: HTMLElement, el: HTMLElement, at: DOMRect) {
		const box = el.getBoundingClientRect()
		const copy = document.importNode(el, true)
		for (const inner of [copy, ...copy.querySelectorAll("[id], [data-blok-c]")]) {
			inner.removeAttribute("id")
			inner.removeAttribute("data-blok-c")
		}
		Object.assign(copy.style, {
			position: "absolute",
			top: `${box.top}px`,
			left: `${box.left}px`,
			width: `${box.width}px`,
			margin: "0",
		})
		moving.append(copy)
		// wherever the site's styles move a copy out of its parent, it lies exactly over the original
		const got = copy.getBoundingClientRect()
		copy.style.top = `${box.top - (got.top - at.top) / fit + box.top}px`
		copy.style.left = `${box.left - (got.left - at.left) / fit + box.left}px`
	}

	/** What of the window's page is fixed or stuck: the site's, whichever version shows, so found once */
	let chrome: Array<HTMLElement> | null = null

	/** What the site keeps fixed or stuck in view over the page, like a header, outermost only */
	function chrome_over(doc: Document, page: HTMLElement) {
		chrome ??= [...doc.body.querySelectorAll<HTMLElement>("*")].filter(
			(el) =>
				!page.contains(el) &&
				!el.closest("[data-storyloco]") &&
				/^(fixed|sticky)$/.test(getComputedStyle(el).position)
		)
		const found: Array<HTMLElement> = []
		const height = doc.defaultView?.innerHeight ?? innerHeight
		for (const el of chrome) {
			if (!el.isConnected || found.some((f) => f.contains(el))) continue
			const box = el.getBoundingClientRect()
			if (box.width && box.height && box.bottom > 0 && box.top < height) found.push(el)
		}
		return found
	}

	const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
	/** How long a step along the track takes, the same as the stack behind, so they move as one */
	const STEP = 650

	/**
	 * Where along the track a window is at `depth`, steps behind the window (or in front, below 0):
	 * the stack's own perspective, shrinking toward the top of the window and rising as it goes
	 */
	function along(depth: number) {
		// in front, it's soon past the viewer: any nearer and it would grow without end
		const scale = 1 / (1 + Math.max(depth, -4) * 0.09)
		return { scale, rise: lift * (scale - 1) }
	}

	const moving_of = (layer: HTMLElement) =>
		layer.firstElementChild?.firstElementChild as HTMLElement

	/** A copy of the window from one place on the track to another, fading as it goes */
	function slide(
		layer: HTMLElement,
		from: number,
		to: number,
		fade: [number, number],
		duration: number
	) {
		const [a, b] = [along(from), along(to)]
		const moving = moving_of(layer)
		// fading out, it holds on while it moves, or it's gone before it's seen to go anywhere
		moving.animate(
			{ opacity: fade },
			{
				duration,
				easing: fade[1] < fade[0] ? "cubic-bezier(0.5, 0, 0.9, 0.6)" : EASE,
				fill: "forwards",
			}
		)
		// the copy is inside the window's shrinking, so its rise is in the page's own size
		return moving
			.animate(
				[
					{ scale: a.scale, translate: `0 ${a.rise / fit}px` },
					{ scale: b.scale, translate: `0 ${b.rise / fit}px` },
				],
				// held where it ends, as what passes faster waits for the rest before it goes
				{ duration, easing: EASE, fill: "forwards" }
			)
			.finished.catch(() => {})
	}

	/**
	 * The window that was, and every one between it and the one travelled to, along the track
	 * together: going back, they pass out by the viewer as the window comes forward from as deep as
	 * it was; going forward, they sink into the stack as the next arrives from in front
	 */
	async function pass(old: HTMLElement, back: boolean, steps: number) {
		// as deep as the stack shows, past which they'd be panes too small and faint to see
		const deep = Math.min(steps, 6)
		const duration = STEP + (deep - 1) * 70
		const flights: Array<Promise<unknown>> = []
		// the nearer the viewer, the higher: going back, all of them under the one that was
		for (let n = 1; n < deep; n++) {
			const k = back ? deep - n : n
			const glass = pane(back)
			if (!glass) continue
			if (back) old.before(glass)
			flights.push(
				back
					? slide(glass, k, k - steps, [0.9, 0], duration)
					: slide(glass, 0, deep - k, [0, 0.9], duration)
			)
		}
		// the window that was, and the next, at a step's pace whatever the distance, the nearest first:
		// any longer and they hang about the viewer; any nearer and they're too big to paint in time
		if (back) flights.push(slide(old, 0, -3, [1, 0], STEP))
		else {
			const next = copy_of(true)
			flights.push(slide(old, 0, deep, [1, 0], duration))
			if (next) flights.push(slide(next, -1, 0, [0, 1], STEP))
		}
		if (back) flights.push(come_forward(deep, duration))
		await Promise.all(flights)
		for (const layer of document.querySelectorAll(
			"[data-storyloco=passing], [data-storyloco=passing-behind]"
		))
			layer.remove()
		if (view) view.style.opacity = ""
	}

	/** Going back, the window itself comes forward along the track, the earlier version in it */
	function come_forward(from: number, duration: number) {
		if (!view) return Promise.resolve()
		const { scale, rise } = along(from)
		// the window shrinks from its corner, so it's moved to shrink toward its top's middle instead
		const across = ((1 - scale) * innerWidth * fit) / 2
		return view
			.animate(
				[
					{ opacity: 0.4, scale: fit * scale, translate: `${across}px ${rise}px` },
					{ opacity: 1, scale: fit, translate: "0 0" },
				],
				{ duration, easing: EASE }
			)
			.finished.catch(() => {})
	}

	/** The innermost block across the top of the window, and where it is, so a swap can keep it there */
	function top_block() {
		const doc = view?.contentDocument
		const line = (doc?.defaultView?.innerHeight ?? 0) * 0.15
		let found: { uid: string; top: number } | null = null
		for (const el of doc?.querySelectorAll<HTMLElement>("[data-blok-c]") ?? []) {
			const box = el.getBoundingClientRect()
			if (box.top > line || box.bottom <= line) continue
			const uid = uid_of(el)
			if (uid && (!found || box.top >= found.top)) found = { uid, top: box.top }
		}
		return found
	}

	/** Back where it was, if the version shows it, rather than wherever a different length leaves it */
	function hold(anchor: { uid: string; top: number } | null) {
		const doc = view?.contentDocument
		if (!anchor || !doc) return
		for (const el of doc.querySelectorAll<HTMLElement>("[data-blok-c]"))
			if (uid_of(el) === anchor.uid)
				return void doc.defaultView?.scrollBy({
					top: el.getBoundingClientRect().top - anchor.top,
					behavior: "instant",
				})
	}

	const uid_of = (el: HTMLElement) => {
		try {
			return (JSON.parse(el.dataset.blokC ?? "{}") as { uid?: string }).uid
		} catch {
			return undefined
		}
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

	/** Wherever the focus is, as the page behind can't be scrolled while it travels; not while typing */
	function keys(event: KeyboardEvent) {
		// typed in the window too, whose elements aren't this page's kind of Element
		const target = (event.target as Element | null)?.closest ? (event.target as Element) : null
		if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
		if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))
			return
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
		leaving = true
		if (index && !restored) {
			heading = 1
			index = 0
			clearTimeout(settle)
			travel(true)
		}
		// the page under the window is where the window is, so it opens back out onto the same place
		const win = view?.contentWindow
		if (win) scrollTo({ top: win.scrollY, left: win.scrollX, behavior: "instant" })
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

	/** The night behind the stack, the same each time: faint dust, and a few stars that twinkle */
	const sky = (() => {
		let seed = 11
		const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
		const at = () => `${(random() * 100).toFixed(2)}vw ${(random() * 100).toFixed(2)}vh`
		const dust = Array.from({ length: 320 }, () => {
			const tone = random() < 0.25 ? "196 208 255" : random() < 0.12 ? "255 224 200" : "255 255 255"
			const size = random() < 0.12 ? 0.5 : 0
			return `${at()} 0 ${size}px rgb(${tone} / ${(0.2 + random() * 0.5).toFixed(2)})`
		}).join(", ")
		const stars = Array.from({ length: 34 }, () => ({
			x: random() * 100,
			y: random() * 100,
			size: 1.25 + random() * 1.5,
			time: 2.4 + random() * 4.2,
			delay: -random() * 7,
		}))
		return { dust, stars }
	})()

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
		} else keys(event)
	}}
/>

<!-- the window and the void around it, between the copies of the page as they pass: see `travel` -->
<div
	class={["time", "stage", { settled, leaving, restored, ready }]}
	data-storyloco="time-stage"
	style:--fit={fit}
	style:--side="{((1 - fit) / 2) * 100}vw"
	style:--bottom="{bottom}px"
>
	<iframe
		bind:this={view}
		class="window"
		title="This page as it was"
		{src}
		tabindex="-1"
		onload={opened}
	></iframe>
	{#if ready}
		<div class="hole" aria-hidden="true"></div>
		<div class="frame" aria-hidden="true"></div>

		<div class="void" aria-hidden="true" style:--travel={index}>
			<div class="sky">
				<i class="dust" style:box-shadow={sky.dust}></i>
				{#each sky.stars as star, n (n)}
					<i
						class="star"
						style:left="{star.x}%"
						style:top="{star.y}%"
						style:--size="{star.size}px"
						style:animation-duration="{star.time}s"
						style:animation-delay="{star.delay}s"
					></i>
				{/each}
				<i class="meteor"></i>
			</div>
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
	{/if}
</div>

<!-- the timeline and its card, in the top layer, over everything -->
<div
	class={["time", { settled, leaving, restored, ready }]}
	data-storyloco="time"
	style:--side="{((1 - fit) / 2) * 100}vw"
	popover="manual"
	bind:this={machine}
>
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
				<span class="peek" style:--at={place(peek)}>{stamp(peek)}</span>
			{/if}
			<span class="thumb" style:--at={place(dragging && pointer !== null ? pointer : index)}>
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
			{#if unshowable !== null}
				<p class="problem" role="status">
					A save the page couldn’t show with its code as it is now, likely from before a block
					changed. It can still be restored.
				</p>
			{/if}
			<p class="title">
				{index ? `${day_of(chosen.created_at)}, ${time_of(chosen.created_at)}` : "Now"}
			</p>
			{#key resting}
				<div class={["moment", { passing: resting !== index }]} style:--from={heading}>
					{#if resting && rested}
						<p class="sub meta">
							<span class={["status", { published: rested.status === "published" }]}
								>{rested.status === "published" ? "Published" : "Saved"}</span
							>
							{#if rested.by}<span>by {rested.by}</span>{/if}
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
					<button
						type="button"
						class="primary"
						disabled={busy || resting !== index || !changes.length}
						onclick={restore}>{busy ? "Restoring…" : "Restore this version"}</button
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
		/* the popover's own box gives way: what's in it places itself */
		background: none;
		block-size: auto;
		border: 0;
		inline-size: auto;
		inset: 0;
		margin: 0;
		max-block-size: none;
		max-inline-size: none;
		overflow: visible;
		padding: 0;
		pointer-events: none;
		position: fixed;

		/* under the copies passing in front, which fly out past the window's edge */
		/* no box of its own, so its parts stack between the copies passing in front and behind */
		&.stage {
			display: contents;
		}

		/* not the void: it's over the window too, cut out, and it'd take the wheel from the page in it */
		&:not(.leaving) :is(.ghost, .rail, .card) {
			pointer-events: auto;
		}

		/*
		 * Layers of their own, so what changes at each step, the ticks and the playhead,
		 * never repaints the rail or the void it sits on: painted once, they can't come up blank
		 * while the page beneath is redrawn
		 */
		& :is(.frame, .void, .rail, .card, .tick, .thumb, .peek) {
			will-change: transform;
		}

		color-scheme: dark;

		--void: #050816;
		--ink: #f4f6fb;
		--muted: rgb(244 246 251 / 0.62);
		--accent: var(--editor-accent, #05807f);
		--accent-ink: var(--editor-accent-ink, #fff);
		--glow: color-mix(in oklab, var(--accent) 55%, #7d8cff);
		--ease: cubic-bezier(0.22, 1, 0.36, 1);
		--spring: cubic-bezier(0.34, 1.5, 0.55, 1);

		/* the window onto the page, with room above it for the past to stack up, and the sky around */
		--top: 5rem;
		--side: 0.875rem;
		--below: 2.5rem;
		/* beside it, clear of the timeline */
		--room: 7rem;
		/* how far below the vanishing point the window's top edge sits */
		--rise: 10rem;
		/* opening: the page pulled back into the window, slow to start, then all the way */
		--open: 1.05s;
		--pull: cubic-bezier(0.6, 0, 0.12, 1.05);

		color: var(--ink);
		font: var(--editor-font, 500 0.8125rem/1.4 system-ui, sans-serif);

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
		z-index: 2147483000;

		@starting-style {
			box-shadow:
				inset 0 0 0 1px transparent,
				inset 0 0 5rem transparent,
				0 0 0 100vmax transparent;
			inset: 0;
		}
		transition:
			inset var(--open) var(--pull),
			box-shadow 0.6s ease;

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
			clip-path var(--open) var(--pull),
			opacity 0.6s ease;

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
	}

	/*
	 * The night sky, drawn once, nothing in it repainted: it zooms out as the machine opens, and on
	 * a little further in each step back, as though flying through it
	 */
	.sky {
		background:
			radial-gradient(42vw 30vh at 12% 30%, rgb(122 96 255 / 0.2), transparent 70%),
			radial-gradient(
				36vw 26vh at 90% 58%,
				color-mix(in srgb, var(--accent) 24%, transparent),
				transparent 70%
			),
			radial-gradient(30vw 16vh at 30% 6%, rgb(206 118 255 / 0.14), transparent 70%),
			linear-gradient(
				158deg,
				transparent 28%,
				rgb(160 172 255 / 0.08) 44%,
				rgb(255 212 240 / 0.06) 51%,
				transparent 64%
			),
			radial-gradient(95vw 30vh at 50% 112%, rgb(72 98 214 / 0.34), transparent 70%);
		inset: 0;
		pointer-events: none;
		position: absolute;
		scale: calc(1 + min(var(--travel), 24) * 0.005);
		transition:
			scale 2.2s var(--ease),
			opacity 1.2s ease;
		will-change: transform;

		@starting-style {
			opacity: 0;
			scale: 1.45;
		}

		.leaving & {
			opacity: 0;
			scale: 1.15;
			transition:
				scale 0.6s var(--ease),
				opacity 0.4s ease;
		}
	}

	.dust {
		block-size: 1px;
		border-radius: 50%;
		inline-size: 1px;
		left: 0;
		position: absolute;
		top: 0;
	}

	.star {
		animation: twinkle 4s ease-in-out infinite alternate;
		background: #fff;
		block-size: var(--size);
		border-radius: 50%;
		box-shadow: 0 0 calc(var(--size) * 3) calc(var(--size) * 0.4) rgb(190 205 255 / 0.5);
		inline-size: var(--size);
		position: absolute;
	}

	@keyframes twinkle {
		from {
			opacity: 0.15;
			scale: 0.6;
		}
		to {
			opacity: 0.9;
			scale: 1;
		}
	}

	/* now and then, one falls */
	.meteor {
		animation: meteor 17s linear 6s infinite;
		background: linear-gradient(to left, transparent, rgb(255 255 255 / 0.75));
		block-size: 1px;
		inline-size: 6rem;
		left: 72%;
		opacity: 0;
		position: absolute;
		rotate: -18deg;
		top: 9%;
	}

	@keyframes meteor {
		0% {
			opacity: 0;
			translate: 0 0;
		}
		1% {
			opacity: 0.7;
		}
		5% {
			opacity: 0;
			translate: -16rem 5.2rem;
		}
		100% {
			opacity: 0;
			translate: -16rem 5.2rem;
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
		/* only its top shows, above the window: the rest would be layer for nothing to see */
		block-size: 10rem;
		cursor: pointer;
		inset: var(--top) var(--side) auto;
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
		/* moved and faded only, nothing repainted, so a step never waits on painting it */
		transition:
			translate 0.65s var(--ease),
			scale 0.65s var(--ease),
			opacity 0.35s ease;

		.time:not(.settled) & {
			transition-delay: calc(0.5s + var(--order) * 75ms);
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
		--length: 66vh;

		block-size: var(--length);
		cursor: ns-resize;
		inline-size: 4.5rem;
		inset-block-start: calc(var(--top) + 12vh);
		inset-inline-end: 1.75rem;
		outline: none;
		position: fixed;
		touch-action: none;
		user-select: none;
		z-index: 2147483002;

		/* once the page has pulled back into the window, not on it full size, as it loads */
		.time:not(.ready) & {
			opacity: 0;
			translate: 1.5rem 0;
		}
		transition:
			opacity 0.5s ease 0.6s,
			translate 0.8s var(--ease) 0.6s;

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
		block-size: 2px;
		inline-size: 2rem;
		inset-inline-end: 1rem;
		position: absolute;
		translate: 0 -50%;

		/* swelling by scale and fade, which only move what's painted, rather than resizing it */
		&::before {
			background: #fff;
			border-radius: 2px;
			content: "";
			inset: 0;
			opacity: calc(0.3 + var(--near) * 0.5);
			position: absolute;
			scale: calc((0.625 + var(--near) * 1.375) / 2) 1;
			transform-origin: right;
			transition:
				scale 0.22s var(--ease),
				opacity 0.22s ease;
		}

		&.published {
			&::before {
				background: var(--glow);
				opacity: calc(0.6 + var(--near) * 0.4);
			}

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
		top: 0;
		transition: translate 0.5s var(--spring);
		translate: 0 calc(var(--at) / 100 * var(--length));

		.dragging & {
			transition: translate 0.06s linear;
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
		top: 0;
		transition: translate 0.15s var(--ease);
		translate: 0 calc(var(--at) / 100 * var(--length) - 50%);

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
		z-index: 2147483002;

		.time:not(.ready) & {
			opacity: 0;
			translate: -50% 1.5rem;
		}
		transition:
			opacity 0.5s ease 0.7s,
			translate 0.8s var(--ease) 0.7s;

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
		transition: opacity 0.15s ease;

		/* still the last version's, while a scrub passes others */
		&.passing {
			opacity: 0.45;
		}
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
		margin-block: -0.15em;
		overflow: hidden;
		padding-block: 0.15em;
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
			--below: 0.5rem;
			--room: 0.5rem;
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
		.sky {
			transition-property: opacity, background-color, box-shadow;
		}

		.star,
		.meteor,
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
	/*
	 * The window: the page itself, framed, laid out at its own size and shrunk to fit. It opens
	 * from the page as it is, and closes back onto it
	 */
	.window {
		background: none;
		block-size: 100vh;
		border: 0;
		border-radius: calc(1rem / var(--fit));
		inline-size: 100vw;
		inset-block-start: 0;
		inset-inline-start: 0;
		margin: 0;
		opacity: 0;
		padding: 0;
		pointer-events: none;
		position: fixed;
		transform-origin: 0 0;
		transition:
			inset-block-start var(--open) var(--pull),
			inset-inline-start var(--open) var(--pull),
			scale var(--open) var(--pull);
		z-index: 2147482200;

		.ready & {
			inset-block-start: var(--top);
			inset-inline-start: var(--side);
			opacity: 1;
			pointer-events: auto;
			scale: var(--fit);
		}

		.ready.leaving & {
			inset-block-start: 0;
			inset-inline-start: 0;
			scale: 1;
			transition:
				inset-block-start 0.5s var(--ease),
				inset-inline-start 0.5s var(--ease),
				scale 0.5s var(--ease);
		}
	}

	/* the dark behind the window, seen as it comes forward from the stack */
	.hole {
		background: var(--void);
		border-radius: 1rem;
		inset: var(--top) var(--side) var(--bottom);
		pointer-events: none;
		position: fixed;
		z-index: 2147482000;
	}

	/* copies of the window passing, see `copy_of`: in front over the frame and the void, behind under the window */
	:global([data-storyloco="passing"]),
	:global([data-storyloco="passing-behind"]) {
		inset: 0;
		overflow: hidden;
		pointer-events: none;
		position: fixed;
		z-index: 2147483100;
	}
	:global([data-storyloco="passing-behind"]) {
		z-index: 2147482100;
	}
</style>
