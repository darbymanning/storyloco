<!--
	@component
	The editor app's badge, which previews and signed-in editors see in a corner. Click it for the story's publish status
	and signing in and out to edit in place; drag it to another corner, which it remembers. Renders
	nothing for visitors, or inside Storyblok's own editor, and keeps clear of Next.js's dev badge.
	On the live site ⌘⇧E (Ctrl+Shift+E) signs in, and turns edit mode on and off once signed in.

	Mount it once in the root layout. Match it to a site with `--editor-bg`, `-ink`, `-muted`,
	`-line`, `-shadow`, `-font` and `-offset`, `--editor-badge`, and `--editor-accent`, `-good`
	and `-danger`; or pass `accent`, which can follow a site's theme as it changes. For a different
	bar altogether, build one from `editor`.

	```svelte
	<EditBar />
	<EditBar accent="var(--brand)" />
	```
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { flip } from "svelte/animate"
	import { scale } from "svelte/transition"
	import { backIn, cubicOut } from "svelte/easing"
	import Face from "./face.svelte"
	import {
		editor,
		follow,
		history,
		kit,
		leave_share,
		load_inbox,
		read_notices,
		publish,
		review,
		set_editing,
		signin,
		unpublished,
		type Notice,
		type Pending,
		type Person,
	} from "./client.js"
	import { page_name } from "./content.js"

	let {
		accent,
		accent_ink,
	}: {
		/**
		 * The editor's accent, any CSS colour: outlines, toolbars and buttons, wherever they're
		 * drawn on the page. It can change, say with a site's location theme. Storyblok's teal
		 * otherwise, or `--editor-accent` set in CSS.
		 */
		accent?: string
		/** Text on the accent, where white won't read, like on a light yellow */
		accent_ink?: string
	} = $props()

	/*
	 * The accent works out where the bar sits, so `var(--accent)` from a site's own wrapper
	 * counts, then goes on :root in a stylesheet for the toolbars and panels on the page's body.
	 * Not the root's inline style, which a site may rewrite whole
	 */
	let probe = $state<HTMLElement>()
	let resolved = $state<{ accent: string; ink: string } | null>(null)

	function resolve() {
		if (!probe || (!accent && !accent_ink)) return (resolved = null)
		const style = getComputedStyle(probe)
		const next = { accent: accent ? style.color : "", ink: accent_ink ? style.backgroundColor : "" }
		if (next.accent !== resolved?.accent || next.ink !== resolved?.ink) resolved = next
	}

	/* At most once a frame, however busily a site animates its inline styles */
	let pending = false
	function soon() {
		if (pending) return
		pending = true
		requestAnimationFrame(() => {
			pending = false
			resolve()
		})
	}

	$effect(() => {
		void accent
		void accent_ink
		resolve()
		// a site's theme can change under the bar, like a location picked from its header
		if (!accent && !accent_ink) return
		const watch = new MutationObserver(soon)
		watch.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["style", "class"],
			subtree: true,
		})
		return () => watch.disconnect()
	})

	// made in code, not written as a tag: preprocessors read any style tag in this file as CSS
	$effect(() => {
		if (!resolved) return
		const tag = document.createElement("style")
		tag.dataset.storyloco = "accent"
		const rules = [
			resolved.accent && `--editor-accent:${resolved.accent};`,
			resolved.ink && `--editor-accent-ink:${resolved.ink};`,
		].filter(Boolean)
		tag.textContent = `:root{${rules.join("")}}`
		document.head.append(tag)
		return () => tag.remove()
	})

	type Corner = "tl" | "tr" | "bl" | "br"

	const KEY = "storyloco-edit-bar"

	/* Inside Storyblok's visual editor the story is already open, and it has its own UI */
	let framed = $state(true)
	let open = $state(false)
	let corner = $state<Corner>("bl")
	/* How far to sit off the corner to clear Next.js's badge when they share one */
	let clear = $state(0)
	let bar = $state<HTMLElement>()

	const shown = $derived(!framed && (editor.draft || editor.staging || Boolean(editor.user)))
	/* Editing, the badge opens the block settings, which the bar holds, and the bar's row with them */
	const settings = $derived(editor.editing && Boolean(editor.user))
	const card = $derived(settings && editor.settings_open)
	/* how many of the others here show by face; the panel's row has room for fewer */
	const faces = $derived(card ? 2 : 4)
	const opened = $derived(settings ? card : open)

	// edit mode switched off from the open panel leaves its row open, as the switch is in it: the
	// bar would otherwise fold away from under the pointer
	let panel_was_open = false
	$effect(() => {
		if (!settings && panel_was_open) open = true
		panel_was_open = card
	})

	/** The panel's contents arriving one after another, as it opens: from its name, or as edit mode's switched on */
	let unfolding = $state(false)
	let card_was: boolean | undefined
	$effect(() => {
		const shown = card
		// only as it opens, not as a page loads with it open already
		if (card_was === false && shown) {
			clearTimeout(unfolded)
			unfolding = true
			unfolded = setTimeout(() => (unfolding = false), 1400)
		}
		card_was = shown
	})
	let unfolded: ReturnType<typeof setTimeout> | undefined
	let edit_was: boolean | undefined
	$effect(() => {
		const on = settings
		// and only then does the bar ease its height: folding to a name and opening from one are the
		// settings' own morph, which a height easing of the bar's own would pull against
		if (edit_was !== undefined && edit_was !== on) {
			clearTimeout(toggled)
			toggling = true
			toggled = setTimeout(() => (toggling = false), 600)
		}
		edit_was = on
	})
	let toggling = $state(false)
	let toggled: ReturnType<typeof setTimeout> | undefined

	/* Badge, S key and the settings' own button alike */
	function toggle() {
		if (settings) return void import("./overlay.js").then((o) => o.toggle_settings())
		open = !open
		// only as it's opened by hand: its row's there too when edit mode's switched, and shouldn't arrive again
		clearTimeout(arriving_done)
		arriving = open
		if (open) arriving_done = setTimeout(() => (arriving = false), 800)
	}

	/** The row's buttons arriving one after another, as the bar's opened with edit mode off */
	let arriving = $state(false)
	let arriving_done: ReturnType<typeof setTimeout> | undefined

	const story = $derived(editor.story)

	// --- where it sits

	/** Which corner an element at this rect is nearest */
	const corner_of = (x: number, y: number): Corner =>
		`${y < innerHeight / 2 ? "t" : "b"}${x < innerWidth / 2 ? "l" : "r"}` as Corner

	/** Next.js's dev badge, when the page has one: a small fixed box in its shadow root */
	function nextjs() {
		const root = document.querySelector("nextjs-portal")?.shadowRoot
		if (!root) return null
		for (const el of root.querySelectorAll<HTMLElement>("*")) {
			if (getComputedStyle(el).position !== "fixed") continue
			const rect = el.getBoundingClientRect()
			if (rect.width && rect.width < 240 && rect.height < 120)
				return { corner: corner_of(rect.x + rect.width / 2, rect.y + rect.height / 2), rect }
		}
		return null
	}

	/** Something of the site's fixed in this corner, like a cookie banner or a chat button */
	function taken(at: Corner) {
		const o = 24
		const x = at[1] === "l" ? o : innerWidth - o
		const y = at[0] === "t" ? o : innerHeight - o
		for (const el of document.elementsFromPoint(x, y)) {
			if (el === document.documentElement || el === document.body) break
			if (el.closest("[data-storyloco]")) continue
			for (let node: Element | null = el; node && node !== document.body; node = node.parentElement)
				if (["fixed", "sticky"].includes(getComputedStyle(node).position)) {
					const rect = node.getBoundingClientRect()
					// a full-width bar or header isn't in a corner; a box that fills the corner is
					if (rect.width < innerWidth * 0.6) return rect
				}
		}
		return null
	}

	/**
	 * The bar gliding to where it's just been put, from where its badge was: moved clear of a cookie
	 * banner that's appeared, or back once it's gone, it travels there rather than being there at once
	 */
	async function travel(was: DOMRect | undefined) {
		if (!was || !arrived || matchMedia("(prefers-reduced-motion: reduce)").matches) return
		await tick()
		const now = bar?.querySelector(".badge")?.getBoundingClientRect()
		if (!bar || !now) return
		const [dx, dy] = [was.left - now.left, was.top - now.top]
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
		bar.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
			duration: 450,
			easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
		})
	}

	function place(saved: Corner | null) {
		const was = bar?.querySelector(".badge")?.getBoundingClientRect()
		const [corner_was, clear_was] = [corner, clear]
		const theirs = nextjs()
		// a corner of its own unless someone chose to share Next.js's
		if (!saved && theirs?.corner === corner) corner = corner[0] === "b" ? "br" : "tr"
		// a cookie banner or chat button there: the other bottom corner if it's free, else above it
		let widget = taken(corner)
		if (!saved && widget && corner[0] === "b") {
			const other: Corner = corner === "bl" ? "br" : "bl"
			if (!taken(other)) {
				corner = other
				widget = null
			}
		}
		const below = widget ?? (theirs && theirs.corner === corner ? theirs.rect : null)
		// clear of it by 12px, past the bar's own 1rem offset
		const edge = below ? (corner[0] === "b" ? innerHeight - below.top : below.bottom) : 0
		clear = below ? Math.max(edge + 12 - 16, 0) : 0
		// only when this is what moved it: its badge moves as the panel opens and folds too, and a
		// bar dropped in a corner glides there from the drop itself
		if ((corner !== corner_was || clear !== clear_was) && !offset.x && !offset.y) travel(was)
	}

	function remember() {
		try {
			localStorage.setItem(KEY, corner)
		} catch {
			// storage blocked: it just won't be remembered
		}
	}

	/*
	 * The editor in the dark for anyone who prefers it. At no specificity, so a site that sets these
	 * itself keeps its own; made in code for the same reason as the accent's tag below
	 */
	function theme() {
		if (document.querySelector("style[data-storyloco=theme]")) return
		const tag = document.createElement("style")
		tag.dataset.storyloco = "theme"
		tag.textContent = `@media (prefers-color-scheme: dark){:where(:root){--editor-bg:#171c2c;--editor-ink:#e8ecf5;--editor-muted:#98a1b6;--editor-line:rgb(255 255 255/.13);--editor-shadow:0 0 0 1px rgb(255 255 255/.1),0 4px 14px rgb(0 0 0/.45);--editor-pill:#2c3453;--editor-accent:#1fa79e}}`
		document.head.append(tag)
	}

	// a guest lands on the draft with the panel open, so they know what they're looking at
	let greeted = false
	$effect(() => {
		if (!editor.guest || greeted) return
		greeted = true
		open = true
	})

	// the editing itself, for sites whose blocks use Storyblok's own `storyblokEditable` rather than `attrs`
	$effect(() => {
		if (!framed && editor.user) import("./overlay.js").then(({ install }) => install())
		else if (!framed && editor.guest) import("./overlay.js").then(({ welcome }) => welcome())
	})

	onMount(() => {
		framed = window.self !== window.top
		theme()
		let saved: Corner | null = null
		try {
			saved = localStorage.getItem(KEY) as Corner | null
		} catch {
			// storage blocked: start in the default corner
		}
		if (saved && ["tl", "tr", "bl", "br"].includes(saved)) corner = saved
		place(saved)
		// Next.js's badge, cookie banners and chat buttons come and go after the page loads
		const watch = setInterval(() => !drag && place(saved), 2000)
		return () => clearInterval(watch)
	})

	// --- dragging to a corner

	let drag: { id: number; x: number; y: number; moved: boolean; by: "badge" | "header" } | null =
		null
	let offset = $state({ x: 0, y: 0 })

	function press(event: PointerEvent, by: "badge" | "header" = "badge") {
		if (event.button !== 0) return
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, by }
		;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	}

	function move(event: PointerEvent) {
		if (!drag || event.pointerId !== drag.id) return
		// let go somewhere the release wasn't heard: it's dropped where it is, not left following the pointer
		if (!(event.buttons & 1)) return void release(event, false)
		const x = event.clientX - drag.x
		const y = event.clientY - drag.y
		if (!drag.moved && Math.hypot(x, y) < 5) return
		drag.moved = true
		offset = { x, y }
	}

	/** Whether a press is on the open settings' top, clear of its buttons and tabs: that drags the bar too */
	const on_header = (event: PointerEvent) => {
		const at = event.target as Element
		return (
			!!at.closest(".inspector:not(.folded) header") &&
			!at.closest("button, a, input, select, textarea, [role=tab]")
		)
	}

	/** Let go: dropped in a corner if it was dragged; a press that went nowhere opens or folds it, from the badge */
	async function release(event: PointerEvent, tap = true) {
		if (!drag || event.pointerId !== drag.id) return
		const { moved, by } = drag
		drag = null
		if (!moved) return tap ? toggle() : undefined
		// snap to the nearest corner, animating from where it was dropped
		const from = bar!.getBoundingClientRect()
		const nearest = corner_of(from.x + from.width / 2, from.y + from.height / 2)
		// with the panel open it's a tall thing whose middle is half the window away from its row, and
		// turning it over puts its buttons at the far end: it changes sides freely, but keeps to the
		// top or the bottom it's at unless it's carried by the face itself well into the other end
		const far =
			(corner[0] === "b" ? event.clientY / innerHeight : 1 - event.clientY / innerHeight) < 0.25
		const edge = !card
			? nearest[0]
			: by === "badge" && far
				? corner[0] === "b"
					? "t"
					: "b"
				: corner[0]
		corner = `${edge}${nearest[1]}` as Corner
		place(corner)
		remember()
		offset = { x: 0, y: 0 }
		await tick()
		const to = bar!.getBoundingClientRect()
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
		bar!.animate([{ translate: `${from.x - to.x}px ${from.y - to.y}px` }, { translate: "0 0" }], {
			duration: 280,
			easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
		})
	}

	/* Clicking anywhere else, or Escape, folds it back into the badge */
	function outside(event: PointerEvent) {
		if (bar?.contains(event.target as Node)) return
		open = false
		reviewing = null
		inbox_open = false
		everyone_open = false
	}

	function key(event: KeyboardEvent) {
		if (event.key === "Escape" && (reviewing || inbox_open || everyone_open)) {
			reviewing = null
			inbox_open = false
			everyone_open = false
		} else if (open && event.key === "Escape") open = false
		// ⌘K, or Ctrl+K: find a page, a block or something to do; a field's own ⌘K is a link
		const typing =
			event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]")
		if (
			editor.user &&
			!framed &&
			!typing &&
			event.key?.toLowerCase() === "k" &&
			(event.metaKey || event.ctrlKey) &&
			!event.shiftKey &&
			!event.altKey
		) {
			event.preventDefault()
			open = false
			import("./overlay.js").then((o) => o.tool("palette"))
		}
		// ⌘⇧E, or Ctrl+Shift+E: anyone can sign in to edit from the live site, where visitors see no badge
		if (event.code === "KeyE" && event.shiftKey && (event.metaKey || event.ctrlKey) && !framed) {
			event.preventDefault()
			if (editor.user) set_editing(!editor.editing)
			else signin()
		}
	}

	// --- what it shows

	/* only what's waiting to go live: a page with nothing to publish says nothing */
	const LABELS = { draft: "Draft", changed: "Unpublished", published: "", checking: "" }

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

	/* Midnight of a date's own calendar day, so "yesterday" means the day before, not 24 hours ago */
	const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())

	/* "5 minutes ago", "today at 14:32", "3 days ago at 21:42", then the date and time */
	function when(date: string) {
		const then = new Date(date)
		const minutes = Math.round((Date.now() - then.getTime()) / 60_000)
		if (minutes < 1) return "just now"
		if (minutes < 60) return relative.format(-minutes, "minute")
		if (minutes < 6 * 60) return relative.format(-Math.round(minutes / 60), "hour")
		const time = then.toLocaleTimeString(undefined, { timeStyle: "short" })
		const days = Math.round((day(new Date()) - day(then)) / 86_400_000)
		if (days === 0) return `today at ${time}`
		if (days < 30) return `${relative.format(-days, "day")} at ${time}`
		return `on ${then.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
	}

	const title = $derived.by(() => {
		if (!story) return ""
		const saved = story.updated_at ? ` · saved ${when(story.updated_at)}` : ""
		if (!story.published_at) return `Never published${saved}`
		const published = `Published ${when(story.published_at)}`
		return story.status === "changed" ? published + saved : published
	})

	/* A tick for a moment after each save lands */
	let saved = $state(false)
	let was_saving = false
	$effect(() => {
		const saving = editor.saving
		const landed = was_saving && !saving && !editor.problem
		was_saving = saving
		if (!landed) return
		saved = true
		const timer = setTimeout(() => (saved = false), 1800)
		return () => clearTimeout(timer)
	})

	let publishing = $state(false)
	let published = $state(false)

	/* What Publish would send live, story by story, before it does */
	let reviewing = $state<"loading" | Array<Pending> | { problem: string } | null>(null)

	/* Mentions and replies, for everyone signed in: push only reaches those who've allowed it */
	let inbox_open = $state(false)
	/* Everyone else on the page, listed from the +N past the faces, to follow any of them */
	let everyone_open = $state(false)
	const inbox = $derived(editor.inbox)
	const count = (n: number) => (n > 9 ? "9+" : String(n))
	const VERBS: Record<string, string> = {
		mention: "mentioned you",
		reply: "replied",
		review: "asked you to review",
	}

	// once per person: loading changes the editor's state, which would run this again with `editor.user` read here
	const user_id = $derived(editor.user?.id)
	$effect(() => {
		if (user_id) load_inbox()
	})

	/** Staging's switch, shown as soon as it's pressed: what the page will show once it's loaded again */
	let switching = $state<boolean | null>(null)
	const showing_draft = $derived(switching ?? editor.draft)

	/**
	 * On staging, the page again with its drafts or with what's live: the server remembers which on a
	 * cookie, and the content is the server's, so the page loads again, at its own address
	 */
	async function view(draft: boolean) {
		if (draft === showing_draft) return
		switching = draft
		const asking = new URL(location.href)
		asking.searchParams.set("_storyblok", draft ? "" : "off")
		await fetch(asking, { method: "HEAD", credentials: "same-origin" }).catch(() => {})
		const clean = new URL(location.href)
		clean.searchParams.delete("_storyblok")
		location.replace(clean)
	}

	function show_inbox() {
		inbox_open = !inbox_open
		reviewing = null
		everyone_open = false
		if (inbox_open) load_inbox()
	}

	/* To the thread, on whichever page and site it's on, marking it read on the way */
	function go_to(notice: Notice) {
		read_notices({ thread: notice.thread })
		inbox_open = false
		open = false
		const path =
			notice.kind === "review"
				? notice.page
				: `${notice.page}${notice.page.includes("?") ? "&" : "?"}comment=${notice.thread}`
		if (notice.origin === location.origin) kit().goto(path)
		else location.assign(notice.origin + path)
	}
	let picked = $state(new Set<number>())
	let label = $state((name: string) => name)

	async function go_live() {
		inbox_open = false
		if (reviewing) return (reviewing = null)
		everyone_open = false
		reviewing = "loading"
		const overlay = import("./overlay.js").then(async (o) => {
			await o.load_schema().catch(() => {})
			label = o.label_of
		})
		try {
			const [stories] = await Promise.all([review(), overlay])
			if (reviewing !== "loading") return
			picked = new Set(stories.map((s) => s.id))
			reviewing = stories.length ? stories : { problem: "Everything here is already live" }
		} catch (e) {
			if (reviewing === "loading") reviewing = { problem: (e as Error).message }
		}
	}

	async function confirm() {
		publishing = true
		const ok = await publish([...picked])
		publishing = false
		if (!ok) return (reviewing = { problem: editor.problem ?? "Couldn’t publish" })
		reviewing = null
		published = true
		setTimeout(() => (published = false), 2400)
	}

	const KINDS = {
		added: "Added",
		removed: "Removed",
		edited: "Edited",
		reordered: "Reordered",
		renamed: "Renamed",
	}

	/* Unpublished changes show beside the badge too, so publishing doesn't mean opening it first */
	const waiting = $derived(Boolean(editor.user && unpublished()))

	/* Everyone else on this page, from the multiplayer room, as initials in their colours */
	const here = $derived(editor.here)
	/* Those on this page first, then the rest of the site */
	const everyone = $derived([...here.people, ...here.elsewhere])
	$effect(() => {
		if (!everyone.length) everyone_open = false
	})
	const other_site = ({ page }: Person) =>
		!!page && new URL(page, location.origin).origin !== location.origin
	const place_of = ({ page }: Person) => (page ? page_name(page, location.origin) : "")
	const short = (text: string) => (text.length > 28 ? `${text.slice(0, 27)}…` : text)

	/* Follow them, or stop; another site has its own sign-in, so that's opened rather than followed */
	function go_with(person: Person) {
		const id = String(person.user.id)
		if (editor.following === id) return follow(null)
		if (other_site(person)) return void window.open(person.page!, "_blank", "noopener")
		follow(id)
	}
	// whoever's signed in, as soon as they are, not once the multiplayer room has seen them
	const me = $derived(here.me?.user ?? editor.user)
	const initials_of = (name: string | null) =>
		(name ?? "?")
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0])
			.join("")
			.toUpperCase()

	/*
	 * The badge's parts are each found out separately: who's signed in, who else is here, the page's
	 * name, whether there's anything to publish. Shown as each arrived, it would grow and reshuffle
	 * four times in a second, so it waits for them and arrives once, whole; not for long, though,
	 * as any of them may be a while, or never come
	 */
	let arrived = $state(false)
	const known = $derived(
		!editor.user || (here.me !== null && (!story || story.status !== "checking"))
	)
	$effect(() => {
		if (known) arrived = true
	})
	$effect(() => {
		const late = setTimeout(() => (arrived = true), 1500)
		return () => clearTimeout(late)
	})

	/* What the badge's dot says while folded up */
	const signal = $derived(
		editor.problem
			? "problem"
			: story?.status === "draft" || story?.status === "changed"
				? story.status
				: "none"
	)
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

<span
	bind:this={probe}
	hidden
	aria-hidden="true"
	style:color={accent}
	style:background-color={accent_ink}
></span>

{#if shown}
	<div
		bind:this={bar}
		class={[
			"bar",
			{
				open: opened,
				dragging: offset.x || offset.y,
				arriving: !arrived,
				staggered: arriving,
				unfolding,
				toggling,
			},
		]}
		inert={!arrived}
		data-storyloco="bar"
		data-corner={corner}
		style:--clear="{clear}px"
		style:translate={offset.x || offset.y ? `${offset.x}px ${offset.y}px` : undefined}
	>
		<button
			class="badge"
			type="button"
			aria-label={opened ? "Close the site editor" : "Open the site editor"}
			title={story?.status === "published" ? title : undefined}
			aria-expanded={opened}
			onpointerdown={(event) => press(event)}
			onpointermove={move}
			onpointerup={(event) => release(event)}
			onpointercancel={() => (drag = null)}
			onkeydown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					toggle()
				}
			}}
		>
			{#if me}
				<!-- their own face, so nobody takes someone else's beside it for theirs -->
				<span class="own" aria-hidden="true"
					><Face name={me.name} photo={me.photo} gravatar={me.gravatar} /></span
				>
			{:else}
				<svg class="mark" viewBox="0 0 44 44" aria-hidden="true">
					<rect x="11" y="13" width="22" height="18" rx="3" />
					<path d="M11 18h22" />
					<path class="pencil" d="m20 29 7.5-7.5a1.77 1.77 0 0 1 2.5 2.5L22.5 31.5 19 32.5z" />
				</svg>
			{/if}
			{#if editor.saving}<span class="ring" aria-hidden="true"></span>{/if}
			<span class="dot" data-signal={signal} aria-hidden="true"></span>
			{#if inbox.unread && !opened}
				<span class="unread" aria-hidden="true">{count(inbox.unread)}</span>
				<span class="sr">{inbox.unread} unread notifications</span>
			{/if}
		</button>

		<!-- reading rather than editing, the badge is alone until it's opened: who else is here, and
		     publishing, are for whoever's working on the page -->
		{#if everyone.length && (settings || opened)}
			<span class="people" role="group" aria-label="Also on this site">
				{#each everyone.slice(0, faces) as person (person.user.id)}
					{@const name = person.user.name ?? "Someone"}
					{@const followed = editor.following === String(person.user.id)}
					{@const away = here.elsewhere.includes(person)}
					<button
						type="button"
						class="person"
						class:away
						class:idle={person.idle}
						style:--c={person.color}
						aria-pressed={followed}
						onclick={() => go_with(person)}
						animate:flip={{ duration: 350, easing: cubicOut }}
						out:scale={{ start: 0.3, duration: 220, easing: backIn, opacity: 0 }}
					>
						<span class="face" aria-hidden="true"
							><Face
								name={person.user.name}
								photo={person.user.photo}
								gravatar={person.user.gravatar}
								art={person.user.art}
							/></span
						>
						<span class="tip" aria-hidden="true">
							{followed
								? `Following ${name} · click to stop`
								: away
									? `${name} · ${short(place_of(person))}${person.idle ? " · idle" : ""} · ${other_site(person) ? "click to open" : "click to follow"}`
									: `${name}${person.idle ? " · idle" : ""} · click to follow`}
						</span>
						<span class="sr"
							>{followed
								? `Stop following ${name}`
								: `${other_site(person) ? "Open the page of" : "Follow"} ${name}${away ? `, on ${place_of(person)}` : ""}`}</span
						>
					</button>
				{/each}
				{#if everyone.length > faces}
					<button
						type="button"
						class="person more"
						aria-expanded={everyone_open}
						aria-label="Everyone here: {everyone.length - faces} more"
						onclick={() => {
							everyone_open = !everyone_open
							inbox_open = false
							reviewing = null
						}}
					>
						+{everyone.length - faces}
					</button>
				{/if}
			</span>
		{/if}

		{#if editor.user}
			<!-- the block settings: their name beside the badge, or the panel above the row when open -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="settings"
				onpointerdown={(event) => on_header(event) && press(event, "header")}
				onpointermove={move}
				onpointerup={(event) => release(event, false)}
				onlostpointercapture={(event) => release(event, false)}
				onpointercancel={() => (drag = null)}
				{@attach (el) => void import("./overlay.js").then((o) => o.dock(el))}
			></div>
		{/if}

		{#if (waiting || published) && !opened && settings}
			<button
				class="publish outside"
				type="button"
				aria-expanded={Boolean(reviewing)}
				disabled={editor.saving || publishing || published}
				onclick={go_live}
			>
				{published ? "Published" : publishing ? "Publishing…" : "Publish"}
			</button>
		{/if}

		<div class="panel" inert={!opened}>
			<div class="inner">
				{#if editor.staging && !editor.user && !editor.guest}
					<!-- staging's drafts or what's live: behind the badge with Edit, so folded it's the badge alone -->
					<span
						class="versions"
						role="group"
						aria-label="Content to show"
						aria-busy={switching !== null}
					>
						<button type="button" aria-pressed={showing_draft} onclick={() => view(true)}
							>Draft</button
						>
						<button type="button" aria-pressed={!showing_draft} onclick={() => view(false)}
							>Published</button
						>
					</span>
				{/if}
				{#if story && LABELS[story.status]}
					<div class="status" data-status={story.status}>
						{LABELS[story.status]}
						<span class="tip">{title}</span>
					</div>
				{/if}
				{#if waiting}
					<button
						class="publish"
						type="button"
						aria-expanded={Boolean(reviewing)}
						disabled={editor.saving || publishing}
						onclick={go_live}
					>
						{publishing ? "Publishing…" : "Publish"}
					</button>
				{/if}
				{#if editor.user}
					<label class="mode">
						<input
							type="checkbox"
							role="switch"
							aria-label="Edit"
							checked={editor.editing}
							onchange={(event) => set_editing(event.currentTarget.checked)}
						/>
						<span class="label">Edit</span>
						<span class="tip" aria-hidden="true">Edit mode · press E</span>
					</label>
					<span class="state" aria-live="polite">
						{#if editor.saving}
							<svg class="icon spin" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M21 12a9 9 0 1 1-6.22-8.56" />
							</svg>
							<span class="sr">Saving</span>
						{:else if editor.problem}
							<span class="problem" title={editor.problem}>
								<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
									<circle cx="12" cy="12" r="10" />
									<path d="M12 8v4M12 16h.01" />
								</svg>
								<span class="sr">Couldn’t save: {editor.problem}</span>
							</span>
						{:else if saved}
							<svg class="icon saved" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M20 6 9 17l-5-5" />
							</svg>
							<span class="sr">Saved</span>
						{/if}
					</span>
					<span class="control">
						<button
							class="round"
							type="button"
							aria-label={inbox.unread ? `Notifications, ${inbox.unread} unread` : "Notifications"}
							aria-expanded={inbox_open}
							onclick={show_inbox}
						>
							<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
							</svg>
							{#if inbox.unread}<span class="unread small" aria-hidden="true"
									>{count(inbox.unread)}</span
								>{/if}
						</button>
						<span class="tip" aria-hidden="true">Notifications</span>
					</span>
					{#each [true, false] as back (back)}
						{@const what = back ? history.undo : history.redo}
						<span class="control">
							<button
								class="round"
								type="button"
								aria-label={back ? "Undo" : "Redo"}
								disabled={!what}
								onclick={() => import("./overlay.js").then((o) => o.step(back))}
							>
								<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
									<path
										d={back
											? "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
											: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13"}
									/>
								</svg>
							</button>
							<span class="tip" aria-hidden="true">
								{back ? "Undo" : "Redo"}{what ? ` ${what}` : ""} · {back ? "⌘Z" : "⇧⌘Z"}
							</span>
						</span>
					{/each}
					<span class="control">
						<button
							class="round"
							type="button"
							aria-label="More: history, new page, review, preview"
							onclick={() => {
								open = false
								import("./overlay.js").then((o) => o.tool("palette"))
							}}
						>
							<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
							</svg>
						</button>
						<span class="tip" aria-hidden="true">More · ⌘K</span>
					</span>
					{#if waiting}
						<!-- in the open panel, publishing is the row's last button, rather than a label and a pill -->
						<span class="control last">
							<button
								class="round go"
								type="button"
								aria-label={publishing ? "Publishing" : "Publish changes"}
								aria-expanded={Boolean(reviewing)}
								disabled={editor.saving || publishing}
								onclick={go_live}
							>
								<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
								</svg>
							</button>
							<span class="tip" aria-hidden="true">Publish changes</span>
						</span>
					{/if}
				{:else if editor.guest}
					{@const guest = editor.guest}
					<span class="who">
						<span class="avatar initials" aria-hidden="true"
							>{initials_of(guest.name ?? "Guest")}</span
						>
						<span class="name">Draft preview</span>
						<span class="tip" aria-hidden="true">
							{guest.by ? `Shared with you by ${guest.by}` : "Shared with you"} · visitors don't see this
							yet
						</span>
					</span>
					{#if guest.role === "comment"}
						<span class="control">
							<button
								class="round"
								type="button"
								aria-label="Comment"
								onclick={() => {
									open = false
									import("./overlay.js").then((o) => o.comment())
								}}
							>
								<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
								</svg>
							</button>
							<span class="tip" aria-hidden="true">Comment</span>
						</span>
					{/if}
					<span class="control">
						<button class="round" type="button" aria-label="Leave the draft" onclick={leave_share}>
							<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
							</svg>
						</button>
						<span class="tip" aria-hidden="true">Leave: see the site as visitors do</span>
					</span>
				{:else}
					<button class="action last" type="button" onclick={signin}>
						<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M21.17 6.81a1 1 0 0 0-3.99-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"
							/>
						</svg>
						Edit
					</button>
				{/if}
			</div>
		</div>

		{#if everyone_open && everyone.length}
			<div class="review" role="dialog" aria-label="Who’s here">
				{#snippet Row(person: Person)}
					{@const followed = editor.following === String(person.user.id)}
					{@const away = here.elsewhere.includes(person)}
					<li>
						<button
							type="button"
							style:--c={person.color}
							aria-pressed={followed}
							onclick={() => {
								go_with(person)
								everyone_open = false
							}}
						>
							<span class="face" aria-hidden="true"
								><Face
									name={person.user.name}
									photo={person.user.photo}
									gravatar={person.user.gravatar}
									art={person.user.art}
								/></span
							>
							<span class="who">
								<span class="name"
									>{person.user.name ?? "Someone"}<span class="status" class:idle={person.idle}
									></span></span
								>
								{#if away || person.idle}
									<span class="at-page"
										>{[away && place_of(person), person.idle && "Idle"]
											.filter(Boolean)
											.join(" · ")}</span
									>
								{/if}
							</span>
							<span class="follow"
								>{followed ? "Following" : other_site(person) ? "Open" : "Follow"}</span
							>
						</button>
					</li>
				{/snippet}
				{#if here.people.length}
					<p class="heading">On this page</p>
					<ul class="everyone">
						{#each here.people as person (person.user.id)}{@render Row(person)}{/each}
					</ul>
				{/if}
				{#if here.elsewhere.length}
					<p class="heading">Elsewhere</p>
					<ul class="everyone">
						{#each here.elsewhere as person (person.user.id)}{@render Row(person)}{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if inbox_open}
			<div class="review" role="dialog" aria-label="Notifications">
				<div class="inbox-head">
					<p class="heading">Notifications</p>
					{#if inbox.unread}
						<button class="action" type="button" onclick={() => read_notices({ all: true })}>
							Mark all read
						</button>
					{/if}
				</div>
				{#if !inbox.notices.length}
					<p class="note">
						When someone mentions you, replies where you've commented, or asks you to review a page,
						it shows here.
					</p>
				{:else}
					<ul class="notices">
						{#each inbox.notices as notice (notice.id)}
							<li>
								<button
									type="button"
									class={["notice", { fresh: !notice.read_at }]}
									onclick={() => go_to(notice)}
								>
									<span class="avatar initials" aria-hidden="true"
										>{initials_of(notice.author)}</span
									>
									<span class="about">
										<span>
											<b>{notice.author?.split(" ")[0] ?? "Someone"}</b>
											{VERBS[notice.kind] ?? "replied"} on {notice.place ?? notice.page}
										</span>
										<span class="excerpt">{notice.body}</span>
										<span class="when">{when(new Date(notice.created_at).toISOString())}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		{#if reviewing}
			<div class="review" role="dialog" aria-label="Publish changes">
				{#if reviewing === "loading"}
					<p class="heading">Publish changes</p>
					<div class="bones" aria-label="Checking what’s changed">
						<span class="bone"></span><span class="bone"></span><span class="bone short"></span>
					</div>
				{:else if "problem" in reviewing}
					<p class="note">{reviewing.problem}</p>
				{:else}
					<p class="heading">Publish changes</p>
					<ul class="stories">
						{#each reviewing as pending (pending.id)}
							{@const changes = pending.changes ?? []}
							<li>
								<label class="story">
									<input
										type="checkbox"
										checked={picked.has(pending.id)}
										onchange={(event) => {
											const next = new Set(picked)
											if (event.currentTarget.checked) next.add(pending.id)
											else next.delete(pending.id)
											picked = next
										}}
									/>
									<span class="title">{pending.name}</span>
									{#if pending.id === story?.id}
										<span class="where">This page</span>
									{:else}
										<span class="where" title="Shown on other pages too">Shared</span>
									{/if}
								</label>
								{#if !pending.published_at}
									<p class="note">Not on the site yet: publishing puts it live</p>
								{:else if !changes.length}
									<p class="note">No changes to its content</p>
								{:else}
									<ul class="changes">
										{#each changes.slice(0, 6) as change (change.uid)}
											<li>
												<span class="kind" data-kind={change.kind}
													>{KINDS[change.kind as keyof typeof KINDS]}</span
												>
												<span class="what">
													{label(change.component)}{#if change.hint}<span class="hint">
															“{change.hint}”</span
														>{/if}
												</span>
											</li>
										{/each}
										{#if changes.length > 6}
											<li class="more">and {changes.length - 6} more</li>
										{/if}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
					<div class="actions">
						<button class="action" type="button" onclick={() => (reviewing = null)}>Cancel</button>
						{#if story?.published_at}
							<button
								class="action"
								type="button"
								onclick={() => {
									reviewing = null
									open = false
									import("./overlay.js").then((o) => o.tool("compare"))
								}}>Compare with live</button
							>
						{/if}
						<button
							class="publish"
							type="button"
							disabled={!picked.size || publishing || editor.saving}
							onclick={confirm}
						>
							{publishing ? "Publishing…" : picked.size > 1 ? `Publish ${picked.size}` : "Publish"}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/*
	 * A site's list markers, often a positioned ::before, aren't the editor's: in a list of ours
	 * one sizes itself to the nearest positioned box, like a dialog's full-screen scrim, and takes
	 * every click on it. Revert can't reach a pseudo-element, so this goes everywhere we draw, though
	 * not on the site's own rich text while it's typed in, whose lists keep their markers.
	 */
	/* one rule each: in one list Svelte would join them in an :is(), where a pseudo-element can't be */
	:global([data-storyloco]:not([data-storyloco="rich"]) li)::before {
		content: none !important;
	}

	:global([data-storyloco]:not([data-storyloco="rich"]) li)::after {
		content: none !important;
	}

	.bar {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--editor-bg, #fff);
		/* a spring that overshoots a touch, for things arriving */
		--overshoot: cubic-bezier(0.34, 1.56, 0.64, 1);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--good: var(--editor-good, #14b8a6);
		--danger: var(--editor-danger, #e5484d);
		--font: var(--editor-font, 500 0.8125rem/1.25 system-ui, sans-serif);
		--shadow: var(--editor-shadow, 0 0 0 1px var(--line), 0 2px 8px rgb(27 36 63 / 0.08));
		--o: var(--editor-offset, 1rem);

		align-items: center;
		border-radius: 999px;
		color: var(--ink);
		display: flex;
		font: var(--font);
		/* within the screen, whichever corner it's in */
		max-inline-size: calc(100% - 2 * var(--o));
		padding: 0.25rem;
		position: fixed;
		transition:
			background-color 0.25s ease,
			box-shadow 0.25s ease;
		z-index: 2147483000;

		@starting-style {
			opacity: 0;
			scale: 0.8;
		}

		transition-property: background-color, box-shadow, opacity, scale;

		&.open {
			background-color: var(--bg);
			box-shadow: var(--shadow);
		}

		&.dragging {
			cursor: grabbing;
			transition: none;
		}

		/* not yet whole: held back, so it arrives once rather than a piece at a time */
		&.arriving {
			opacity: 0;
			scale: 0.96;
		}

		/* Right-hand corners open towards the page, and top ones show their tooltips below */
		&[data-corner="bl"] {
			inset: auto auto calc(var(--o) + var(--clear)) var(--o);
		}

		&[data-corner="br"] {
			flex-direction: row-reverse;
			inset: auto var(--o) calc(var(--o) + var(--clear)) auto;
		}

		&[data-corner="tl"] {
			inset: calc(var(--o) + var(--clear)) auto auto var(--o);
		}

		&[data-corner="tr"] {
			flex-direction: row-reverse;
			inset: calc(var(--o) + var(--clear)) var(--o) auto auto;
		}

		@media (prefers-reduced-motion: reduce) {
			@starting-style {
				scale: 1;
			}
		}
	}

	/* The block settings: their name beside the badge while folded */
	.settings {
		display: flex;
		min-inline-size: 0;

		&:empty {
			display: none;
		}
	}

	/*
	 * holding the settings' name, the bar is a pill of its own, which morphs whole as it opens: glass,
	 * the page blurred through it, a wash of the accent from the top and a catch of light on its edge.
	 * As it is open on staging's switch, though nothing morphs there, so its row still slides open
	 */
	.bar:has(.settings:not(:empty)),
	/* reading rather than editing, there's no name to hold, but whoever else is here and Publish sit
	   beside the badge all the same: the same pill round them, or they'd float loose over the page */
	.bar:has(.people),
	.bar:has(.publish.outside),
	.bar.open:has(.mode),
	.bar.open:has(.versions) {
		--sheen: inset 0 1px 0 rgb(255 255 255 / 0.1);

		background: none;
		box-shadow: var(--sheen), var(--shadow);

		/* the glass is a layer behind what's in the bar, not the bar itself: blurring what's behind
		   it itself, nothing in it could, and what opens out of it over the page, like what's waiting
		   to publish, would have the page showing sharp through it */
		&::before {
			backdrop-filter: blur(20px) saturate(1.8);
			background:
				linear-gradient(color-mix(in srgb, var(--accent) 9%, transparent), transparent 12rem),
				color-mix(in srgb, var(--bg) 80%, transparent);
			border-radius: inherit;
			content: "";
			inset: 0;
			pointer-events: none;
			position: absolute;
			z-index: -1;
		}
	}

	/* holding the settings' name it morphs whole, so its row doesn't slide as well; open on anything
	   else, with edit mode off or on staging's switch, the row slides out from the badge */
	.bar:has(.settings:not(:empty)) :is(.panel, .inner) {
		transition: none;
	}

	/*
	 * open for someone who edits, with nothing selected, it's the row the panel opens from: as
	 * wide, on the same glass and holding the same buttons spread the same way (the status,
	 * saving and any problem the badge's dot and ring, publishing the last button), so turning
	 * edit mode on grows the panel above it and nothing in the row moves
	 */
	.bar.open:has(.mode):not(:has(:global(.inspector:not(.folded)))) {
		/* as round as the badge it opens from, and no rounder: half its row's height, as the panel's
		   corners are, so that sinking back from the panel it's a panel getting shorter and not a blob */
		border-radius: 1.5rem;
	}

	/*
	 * and with no name to hold, as with edit mode off, nothing morphs it open: its row is laid out
	 * as wide as it will be from the start, folded or not, and only uncovered as the bar opens, so
	 * nothing in it is spaced out again on the way
	 */
	.bar:has(.mode):not(:has(.settings:not(:empty))) {
		/* a height it can grow from, as tall as its row: left to its contents, there'd be nothing to
		   ease from when the settings' panel opens above it */
		/* its row along the edge the panel keeps it at, the bottom, or the top in a top corner: in the
		   middle, as it is at rest, it would drop the height of the panel as that sinks away */
		align-items: flex-end;
		block-size: 3rem;
		border-radius: 1.5rem;
		box-sizing: border-box;

		&[data-corner^="t"] {
			align-items: flex-start;
		}

		/* the room the settings' panel leaves round its row, so the badge is in the same place in both */
		padding: 0.375rem;
	}

	/* edit mode switched on or off with the row open: the panel grows up out of the row, and sinks
	   back into it, rather than being there or gone at once. Only while it's being switched: folding
	   to a name and opening from one are the settings' own morph */
	.bar.toggling:has(.mode) {
		transition:
			background-color 0.25s ease,
			box-shadow 0.25s ease,
			opacity 0.25s ease,
			scale 0.25s ease,
			block-size 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);

		&.dragging {
			transition: none;
		}

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}
	}

	.bar:has(.mode):not(:has(.settings:not(:empty))) .panel {
		/* as tall as the badge beside it, its row in the middle of that: kept to the bar's edge with
		   the badge, the two still line up */
		align-items: center;
		block-size: 2.25rem;
		/* a row of a set width would hold its track open: none of it until it's opened */
		grid-template-columns: minmax(0, 0fr);
	}

	/* and whoever else is here, smaller than the badge, in the middle of it too rather than on the edge */
	.bar:has(.mode):not(:has(.settings:not(:empty))) .people {
		align-items: center;
		block-size: 2.25rem;
	}

	.bar.open:has(.mode):not(:has(.settings:not(:empty))) .panel {
		grid-template-columns: minmax(0, 1fr);
	}

	.bar:has(.mode):not(:has(.settings:not(:empty))) .inner {
		box-sizing: border-box;
		/* the settings' row exactly: no gap but the spare room, across the same width, so each
		   button is where it is with the panel open above it */
		gap: 0;
		inline-size: calc(min(22rem, 100vw - 2 * var(--o)) - 3rem);
		justify-content: space-between;
		padding-inline: 0.625rem 0.375rem;

		[data-corner$="r"] & {
			padding-inline: 0.375rem 0.625rem;
		}

		& :is(.status, .publish, .state) {
			display: none;
		}

		& .last {
			display: flex;
		}
	}

	/* opening, each thing in the row arrives a moment after the one before it, out from the badge */
	.bar.staggered.open:has(.mode):not(:has(.settings:not(:empty))) .inner > * {
		animation: arrive 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;

		&:nth-child(2) {
			animation-delay: 40ms;
		}

		&:nth-child(3) {
			animation-delay: 80ms;
		}

		&:nth-child(4) {
			animation-delay: 120ms;
		}

		&:nth-child(5) {
			animation-delay: 160ms;
		}

		&:nth-child(6) {
			animation-delay: 200ms;
		}

		&:nth-child(7) {
			animation-delay: 240ms;
		}

		&:nth-child(n + 8) {
			animation-delay: 280ms;
		}

		@media (prefers-reduced-motion: reduce) {
			animation: none;
		}
	}

	/* edit mode switched on: the panel's fields, and the blocks in a list of them, come in one after
	   another as it grows up from the row, rather than all being there in a box that's still opening */
	.bar.unfolding :global(.inspector :is(.fields > *, .kids > li)) {
		animation: settle 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;

		@media (prefers-reduced-motion: reduce) {
			animation: none;
		}
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(1)) {
		animation-delay: 60ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(2)) {
		animation-delay: 130ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(3)) {
		animation-delay: 200ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(4)) {
		animation-delay: 270ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(5)) {
		animation-delay: 340ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(6)) {
		animation-delay: 410ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(7)) {
		animation-delay: 480ms;
	}

	.bar.unfolding :global(.inspector .fields > :nth-child(8)) {
		animation-delay: 550ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(1)) {
		animation-delay: 120ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(2)) {
		animation-delay: 155ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(3)) {
		animation-delay: 190ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(4)) {
		animation-delay: 225ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(5)) {
		animation-delay: 260ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(6)) {
		animation-delay: 295ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(7)) {
		animation-delay: 330ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(8)) {
		animation-delay: 365ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(9)) {
		animation-delay: 400ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(10)) {
		animation-delay: 435ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(11)) {
		animation-delay: 470ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(12)) {
		animation-delay: 505ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(13)) {
		animation-delay: 540ms;
	}

	.bar.unfolding :global(.inspector .kids > li:nth-child(14)) {
		animation-delay: 575ms;
	}

	@keyframes settle {
		from {
			opacity: 0;
			translate: 0 0.5rem;
		}
	}

	@keyframes arrive {
		from {
			opacity: 0;
			scale: 0.7;
			translate: -0.5rem 0;
		}
	}

	/*
	 * Open, one panel in the bar's corner: the settings, then the row along the bottom edge, or
	 * the top in a top corner, so the badge stays put. A sheet across a phone's screen
	 */
	.bar:has(:global(.inspector:not(.folded))) {
		align-items: center;
		block-size: calc(100dvh - 2 * var(--o) - var(--clear));
		/* round the badge in its corner: the row's own radius, as when it's a pill with no panel */
		border-radius: 1.5rem;
		box-shadow:
			var(--sheen),
			var(--shadow),
			0 16px 48px rgb(0 0 0 / 0.16);
		display: grid;
		grid-template: minmax(0, 1fr) auto / auto auto minmax(0, 1fr);
		inline-size: min(22rem, 100% - 2 * var(--o));
		padding: 0 0.375rem 0.375rem;

		/* where there's room, wide enough for a rich text field's whole toolbar on one line */
		@media (min-width: 1100px) {
			inline-size: min(24rem, 100% - 2 * var(--o));
		}

		& > * {
			grid-row: 2;
		}

		/* the settings keep to the rounded corners they're in; the row's tips may stand past the edge */
		& .settings {
			align-self: stretch;
			border-block-end: 1px solid var(--line);
			border-radius: 1.5rem 1.5rem 0 0;
			grid-area: 1 / 1 / 2 / -1;
			margin: 0 -0.375rem 0.375rem;
			overflow: hidden;
		}

		/* the people here tuck under the badge's edge, smaller, so they don't push the row onto two lines */
		& .badge {
			z-index: 1;
		}

		& .people {
			grid-column: 2;
			margin-inline: -0.5rem 0.25rem;
		}

		/* pointed at, they come out from under it, or the one beside the badge is half hidden: by
		   room inside it, which is still it under the pointer, where a margin would let go of it */
		& .people:is(:hover, :focus-within) {
			padding-inline-start: 0.625rem;
		}

		& .person {
			--lap: 0.5rem;
			--size: 1.5rem;

			font-size: 0.5625rem;
		}

		& .panel {
			grid-column: 3;
		}

		/*
		 * always one line, spread across the panel: the status, saving and any problem are the badge's
		 * dot and ring, and publishing the row's last button. No gap but the spare room, as the fullest
		 * row has people beside the badge
		 */
		& .inner {
			gap: 0;
			justify-content: space-between;

			& :is(.status, .publish, .state) {
				display: none;
			}

			& .last {
				display: flex;
			}
		}

		/* clear of the row, over the settings */
		& .review {
			grid-row: auto;
			inset-block: auto 3rem;
		}

		&[data-corner^="t"] {
			grid-template-rows: auto minmax(0, 1fr);
			padding: 0.375rem 0.375rem 0;

			& > * {
				grid-row: 1;
			}

			& .settings {
				border-block: 1px solid var(--line) 0;
				border-radius: 0 0 1rem 1rem;
				grid-row: 2;
				margin: 0.375rem -0.375rem 0;
			}

			& .review {
				inset-block: 3rem auto;
			}
		}

		&[data-corner$="r"] {
			grid-template-columns: minmax(0, 1fr) auto auto;

			& .badge {
				grid-column: 3;
			}

			& .people {
				margin-inline: 0.25rem -0.5rem;
			}

			& .people:is(:hover, :focus-within) {
				padding-inline: 0 0.625rem;
			}

			& .panel {
				grid-column: 1;
			}
		}

		@media (width < 40rem) {
			block-size: auto;
			inline-size: auto;
			inset-inline: 0.5rem;
			max-block-size: 65dvh;
			max-inline-size: none;
		}
	}

	.badge {
		background: var(--editor-badge, var(--accent));
		block-size: 2.25rem;
		border: 0;
		/* round, like the pill it opens into */
		border-radius: 50%;
		box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent);
		color: var(--editor-accent-ink, #fff);
		cursor: grab;
		display: grid;
		flex: none;
		inline-size: 2.25rem;
		padding: 0;
		place-items: center;
		position: relative;
		touch-action: none;
		transition:
			scale 0.2s ease,
			box-shadow 0.2s ease;

		&:hover {
			scale: 1.05;
		}

		&:active {
			scale: 0.96;
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}
	}

	.own {
		block-size: 100%;
		border-radius: 50%;
		display: grid;
		inline-size: 100%;
		overflow: hidden;
		/* their colour round it, as the others see them */
		box-shadow: inset 0 0 0 2px var(--editor-badge, var(--accent));
		transition:
			scale 0.5s var(--overshoot),
			opacity 0.3s ease;

		@starting-style {
			opacity: 0;
			scale: 0.5;
		}
	}

	.mark {
		block-size: 1.625rem;
		fill: none;
		inline-size: 1.625rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2.25;

		& .pencil {
			fill: var(--accent);
			stroke-width: 1.9;
		}
	}

	/* The status, or a problem, while folded up; ringed in the page's colour so it reads on the badge */
	.dot {
		block-size: 0.625rem;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--bg);
		inline-size: 0.625rem;
		inset: 0 0 auto auto;
		position: absolute;

		/* only when something's wrong: what's waiting to publish, and what's live, the Publish
		   button says already */
		&:not([data-signal="problem"]) {
			display: none;
		}

		&[data-signal="problem"] {
			background-color: var(--danger);
		}
	}

	.ring {
		animation: spin 0.9s linear infinite;
		border: 2px solid transparent;
		border-radius: 50%;
		border-top-color: var(--accent);
		inset: -0.25rem;
		position: absolute;
	}

	/* Opens sideways from the badge: the track grows to fit, and the clip reveals it */
	.panel {
		display: grid;
		grid-template-columns: 0fr;
		min-inline-size: 0;
		transition: grid-template-columns 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);

		/* folding, the clip below starts from 40rem out, so the track keeps the buttons in; and inert
		   doesn't stop hover, so the buttons sliding under the pointer would flash their tips, folding
		   or opening (a tip's visibility waits for it to open) */
		&:not(.open *) {
			overflow-x: clip;

			.tip {
				transition: none;
				visibility: hidden;
			}
		}

		.open & {
			grid-template-columns: 1fr;
		}
	}

	.inner {
		align-items: center;
		clip-path: inset(-10rem 100% -10rem 0);
		display: flex;
		gap: 0.625rem;
		min-inline-size: 0;

		/* on a phone the row is wider than the screen: it scrolls, rather than running off the edge */
		@media (hover: none), (width < 40rem) {
			.open & {
				overflow-x: auto;
				overscroll-behavior-x: contain;
				scrollbar-width: none;
			}

			/* laid out, if unseen, they'd scroll the row past its last button */
			.tip {
				display: none;
			}
		}
		transition:
			clip-path 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
			padding 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
		white-space: nowrap;

		[data-corner$="r"] & {
			clip-path: inset(-10rem 0 -10rem 100%);
		}

		/* padded only when open, so the folded badge is just the badge */
		.open & {
			clip-path: inset(-10rem -40rem);
			padding-inline: 0.625rem 0.375rem;
		}

		.open[data-corner$="r"] & {
			padding-inline: 0.375rem 0.625rem;
		}
	}

	.status {
		align-items: center;
		color: var(--muted);
		display: flex;
		gap: 0.375rem;
		position: relative;

		&::before {
			background-color: var(--muted);
			block-size: 0.375rem;
			border-radius: 50%;
			content: "";
			inline-size: 0.375rem;
		}

		&[data-status="changed"]::before {
			background-color: var(--accent);
		}

		&[data-status="published"]::before {
			background-color: var(--good);
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}
		}

		&:has(+ *) {
			border-inline-end: 1px solid var(--line);
			padding-inline-end: 0.625rem;
		}
	}

	.tip {
		background-color: var(--ink);
		border-radius: 0.5rem;
		color: var(--bg);
		inset: auto auto calc(100% + 0.75rem) -0.75rem;
		opacity: 0;
		padding: 0.5rem 0.625rem;
		pointer-events: none;
		position: absolute;
		transition:
			opacity 0.2s ease,
			translate 0.2s ease,
			visibility 0s 0.3s;
		translate: 0 0.25rem;
		white-space: nowrap;

		&::after {
			background-color: inherit;
			block-size: 0.3125rem;
			clip-path: polygon(0 0, 100% 0, 50% 100%);
			content: "";
			inline-size: 0.625rem;
			inset: 100% auto auto 0.625rem;
			position: absolute;
		}

		[data-corner^="t"] & {
			inset: calc(100% + 0.75rem) auto auto -0.75rem;
			translate: 0 -0.25rem;

			&::after {
				clip-path: polygon(50% 0, 100% 100%, 0 100%);
				inset: auto auto 100% 0.625rem;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			translate: none;
		}
	}

	.action {
		align-items: center;
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		display: flex;
		font: inherit;
		gap: 0.375rem;
		padding: 0.25rem 0;

		&:hover {
			color: var(--accent);
		}

		/* the row's last thing: off the pill's rounded end, as far as the switch is from the badge */
		&.last {
			margin-inline-end: 0.75rem;
		}
	}

	/* staging's switch between its drafts and what's live */
	.versions {
		background: color-mix(in srgb, var(--ink) 6%, transparent);
		border-radius: 999px;
		display: flex;
		flex: none;
		margin-inline: 0.375rem;
		padding: 0.125rem;

		&[aria-busy="true"] {
			cursor: progress;
		}

		& button {
			background: none;
			border: 0;
			border-radius: 999px;
			color: var(--muted);
			cursor: pointer;
			font: inherit;
			padding: 0.1875rem 0.625rem;
			transition:
				background-color 0.2s,
				color 0.2s;

			&:hover {
				color: var(--ink);
			}

			&[aria-pressed="true"] {
				background: color-mix(in srgb, var(--ink) 12%, transparent);
				color: var(--ink);
				cursor: default;
			}
		}
	}

	.publish {
		background: var(--accent);
		border: 0;
		border-radius: 999px;
		color: var(--editor-accent-ink, #fff);
		cursor: pointer;
		font: inherit;
		padding: 0.3125rem 0.75rem;
		transition:
			filter 0.2s ease,
			opacity 0.2s ease;

		&:hover {
			filter: brightness(1.08);
		}

		&:disabled {
			cursor: progress;
			opacity: 0.6;
		}
	}

	.publish.outside {
		box-shadow: var(--shadow);
		margin-inline: 0.5rem;

		@starting-style {
			opacity: 0;
			scale: 0.9;
		}

		transition-property: filter, opacity, scale;
	}

	.mode {
		align-items: center;
		cursor: pointer;
		display: flex;
		gap: 0.375rem;
		position: relative;

		/* every box property its knob is placed by, set here: a site's form styles (a forms plugin's
		   `[type="checkbox"]` gives it a border and a ring) would move the knob off its track */
		& input {
			appearance: none;
			background: color-mix(in srgb, var(--ink) 18%, transparent);
			block-size: 1rem;
			border: 0;
			border-radius: 999px;
			box-shadow: none;
			box-sizing: border-box;
			cursor: inherit;
			flex: none;
			inline-size: 1.75rem;
			margin: 0;
			padding: 0;
			position: relative;
			transition: background-color 0.2s ease;

			&::after {
				background: #fff;
				block-size: 0.75rem;
				border-radius: 50%;
				box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
				content: "";
				inline-size: 0.75rem;
				inset: 0.125rem auto auto 0.125rem;
				position: absolute;
				transition: translate 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
			}

			&:checked {
				background: var(--accent);

				&::after {
					translate: 0.75rem 0;
				}
			}

			&:focus-visible {
				outline: 2px solid var(--accent);
				outline-offset: 2px;
			}
		}

		&:has(:focus-visible) .tip {
			opacity: 1;
			translate: 0 0;
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}
		}
	}

	.who {
		align-items: center;
		display: flex;
		gap: 0.375rem;
	}

	.avatar {
		block-size: 1.25rem;
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--line);
		flex: none;
		inline-size: 1.25rem;
		object-fit: cover;
	}

	.initials {
		background-color: color-mix(in srgb, var(--accent) 16%, var(--bg));
		color: var(--accent);
		display: grid;
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		place-items: center;
	}

	.name {
		max-inline-size: 8rem;
		margin-block: -0.15em;
		overflow: hidden;
		padding-block: 0.15em;
		text-overflow: ellipsis;
	}

	/* Collapses when idle; Svelte's comment anchors still count as empty */
	.state {
		display: flex;

		&:empty {
			display: none;
		}
	}

	.icon {
		block-size: 0.875rem;
		fill: none;
		flex: none;
		inline-size: 0.875rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	.spin {
		animation: spin 0.8s linear infinite;
		color: var(--muted);
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin,
		.ring {
			animation-duration: 2.4s;
		}
	}

	.saved {
		color: var(--good);
		transition:
			opacity 0.2s ease,
			scale 0.2s ease;

		@starting-style {
			opacity: 0;
			scale: 0.6;
		}
	}

	.problem {
		color: var(--danger);
		display: flex;
	}

	.control {
		display: flex;
		position: relative;

		/* only in the open panel */
		&.last {
			display: none;
		}

		/* right at the edge, its tip lines up with it rather than running past */
		&.last .tip {
			inset-inline: auto calc(50% - 0.9375rem);

			&::after {
				inset-inline: auto 0.625rem;
			}
		}

		.tip {
			inset-inline-start: calc(50% - 0.9375rem);
		}

		&:has(:focus-visible) .tip {
			opacity: 1;
			translate: 0 0;
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}
		}
	}

	.round {
		align-items: center;
		background: none;
		block-size: 1.5rem;
		border: 0;
		border-radius: 50%;
		color: var(--muted);
		cursor: pointer;
		display: flex;
		inline-size: 1.5rem;
		justify-content: center;
		padding: 0;
		transition:
			background-color 0.2s ease,
			color 0.2s ease;

		&:hover {
			background-color: color-mix(in srgb, var(--accent) 15%, transparent);
			color: var(--accent);
		}

		/* publishing: the accent, filled, the one thing on the row asking to be pressed */
		&.go {
			background-color: var(--accent);
			color: var(--editor-accent-ink, #fff);

			&:hover {
				background-color: color-mix(in srgb, var(--accent) 85%, #fff);
				color: var(--editor-accent-ink, #fff);
			}

			&:disabled {
				opacity: 0.5;
			}
		}
	}

	.people {
		display: flex;
		flex: none;
		margin-inline: 0.375rem;
		transition: padding 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);

		[data-corner$="r"] & {
			flex-direction: row-reverse;
		}
	}

	/* pointed at, or tabbed into, the faces stand apart, each one whole and easy to press: lapped,
	   all but the last is a sliver */
	.people:is(:hover, :focus-within) .person {
		& + & {
			margin-inline-start: 0.125rem;
		}

		[data-corner$="r"] & + & {
			margin-inline: 0 0.125rem;
		}

		/* whole, with no bite out of it for the next one, which no longer sits over it */
		&:has(+ .person) .face,
		& .face {
			mask: none;
		}
	}

	.person {
		/* how big each face is, how far the next sits over it, and the clear space left between the two */
		--size: 1.75rem;
		--lap: 0.4375rem;
		--gap: 0.15625rem;
		/* where the next face's middle is, from this one's leading edge */
		--next: calc(var(--size) * 1.5 - var(--lap));

		align-items: center;
		background: none;
		block-size: var(--size);
		border: 0;
		border-radius: 50%;
		color: #fff;
		cursor: pointer;
		display: flex;
		font: inherit;
		padding: 0;
		font-size: 0.6875rem;
		font-weight: 600;
		inline-size: var(--size);
		justify-content: center;
		position: relative;
		/* someone arriving springs in; leaving shrinks away, and the rest close up */
		transition:
			scale 0.5s var(--overshoot),
			opacity 0.3s ease,
			margin 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);

		@starting-style {
			opacity: 0;
			scale: 0.3;
		}

		& + & {
			margin-inline-start: calc(-1 * var(--lap));
		}

		/* right to left in the right-hand corners, so each sits over the one on its right */
		[data-corner$="r"] & {
			--next: calc(var(--lap) - var(--size) / 2);

			/* by the window's edge, their tip opens back over the bar rather than running off it */
			.tip {
				inset-inline: auto calc(50% - 1rem);

				&::after {
					inset-inline: auto 0.625rem;
				}
			}

			& + & {
				margin-inline: 0 calc(-1 * var(--lap));
			}
		}

		&.more {
			background: color-mix(in srgb, var(--ink) 14%, transparent);
			color: var(--ink);
		}

		& .face {
			background: var(--c, var(--muted));
			block-size: 100%;
			border-radius: 50%;
			display: grid;
			inline-size: 100%;
			overflow: hidden;
			place-items: center;
			position: relative;
			transition: filter 0.3s ease;

			/* how they are, as a ring round the face, so it's never anyone else's: green while they're
			   at it, muted once they've looked away (below). Their colour is the face's own ground */
			&::after {
				border: 2px solid var(--good, #2fa36b);
				border-radius: inherit;
				content: "";
				inset: 0;
				pointer-events: none;
				position: absolute;
			}
		}

		/* the next face sits over this one: a bite out of this one where it does, with clear space
		   round it, so the glass shows between them rather than a ring painted in its colour */
		&:has(+ &) .face {
			mask: radial-gradient(
				circle calc(var(--size) / 2 + var(--gap)) at var(--next) 50%,
				transparent calc(100% - 0.5px),
				#000 100%
			);
		}

		&:focus-visible .tip {
			opacity: 1;
			translate: 0 0;
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}
		}

		/* followed: their colour, heavier, and in front of the others */
		&[aria-pressed="true"] {
			z-index: 1;

			& .face::after {
				border-color: var(--c, var(--muted));
				border-width: 2.5px;
			}
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 3px;
		}

		/* looked away from their page: their ring goes muted, which stays when they're pointed at, and
		   their face fades back among the others until then */
		&.idle:not([aria-pressed="true"]) .face::after {
			border-color: var(--muted);
		}

		&.idle:not(:hover, :focus-visible, [aria-pressed="true"]) .face {
			filter: saturate(0.3) opacity(0.6);
		}

		/* elsewhere on the site: there, but not here with you; their ring still says how they are */
		&.away:not(:hover, :focus-visible, [aria-pressed="true"]) .face {
			filter: saturate(0.4) opacity(0.75);
		}

		.tip {
			font-weight: 500;
			inset-inline-start: calc(50% - 1rem);
		}

		@starting-style {
			opacity: 0;
			scale: 0.6;
		}

		transition:
			opacity 0.2s ease,
			scale 0.2s ease,
			margin 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.round {
		position: relative;
	}

	/* How many notifications are unread: on the badge folded up, and on the bell */
	.unread {
		background: var(--danger);
		border-radius: 999px;
		box-shadow: 0 0 0 2px var(--bg);
		color: #fff;
		font:
			600 0.625rem/1 system-ui,
			sans-serif;
		inset: -0.25rem auto auto -0.25rem;
		min-inline-size: 1rem;
		padding: 0.1875rem 0.25rem;
		position: absolute;
		text-align: center;

		&.small {
			inset: -0.25rem -0.375rem auto auto;
			min-inline-size: 0.875rem;
			padding: 0.125rem 0.1875rem;
		}
	}

	.inbox-head {
		align-items: baseline;
		display: flex;
		justify-content: space-between;
	}

	.notices {
		display: grid;
		gap: 0.125rem;
		margin-inline: -0.5rem !important;
	}

	.notice {
		align-items: flex-start;
		background: none;
		border: 0;
		border-radius: 0.5rem;
		color: inherit;
		cursor: pointer;
		display: flex;
		font: inherit;
		gap: 0.625rem;
		inline-size: 100%;
		padding: 0.5rem;
		position: relative;
		text-align: start;

		&:hover,
		&:focus-visible {
			background: color-mix(in srgb, var(--accent) 9%, transparent);
		}

		&.fresh::after {
			background: var(--accent);
			block-size: 0.5rem;
			border-radius: 50%;
			content: "";
			inline-size: 0.5rem;
			inset: 0.875rem 0.5rem auto auto;
			position: absolute;
		}

		.avatar {
			block-size: 1.75rem;
			font-size: 0.6875rem;
			inline-size: 1.75rem;
		}
	}

	.about {
		display: grid;
		gap: 0.125rem;
		min-inline-size: 0;
		padding-inline-end: 1rem;
	}

	.excerpt {
		color: var(--muted);
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}

	.when {
		color: var(--muted);
		font-size: 0.6875rem;
	}

	.round:disabled {
		cursor: default;
		opacity: 0.35;
		pointer-events: none;
	}

	.review {
		backdrop-filter: blur(20px) saturate(1.8);
		background:
			linear-gradient(color-mix(in srgb, var(--accent) 9%, transparent), transparent 12rem),
			color-mix(in srgb, var(--bg) 80%, transparent);
		border-radius: 0.875rem;
		box-shadow:
			var(--shadow),
			0 12px 32px rgb(27 36 63 / 0.14);
		inline-size: min(21rem, calc(100vw - 2 * var(--o)));
		inset: auto auto calc(100% + 0.5rem) 0;
		max-block-size: min(28rem, 70vh);
		overflow: auto;
		padding: 0.875rem;
		position: absolute;
		/* over the settings it opens across, whose faded buttons would otherwise show through it */
		z-index: 3;

		@starting-style {
			opacity: 0;
			translate: 0 0.25rem;
		}

		transition:
			opacity 0.2s ease,
			translate 0.2s ease;

		[data-corner^="t"] & {
			inset-block: calc(100% + 0.5rem) auto;
		}

		[data-corner$="r"] & {
			inset-inline: auto 0;
		}

		ul {
			list-style: none;
			margin: 0;
			padding: 0;
		}
	}

	/* Everyone on the page, a row each: their face in their colour, then their name, to follow */
	.review .everyone {
		display: grid;
		gap: 0.125rem;
		margin-block: 0.5rem 0.75rem;

		&:last-child {
			margin-block-end: 0;
		}

		& .who {
			display: grid;
			flex: 1;
			min-inline-size: 0;
		}

		/* here and at it, a small green light after their name; looked away, only its ring */
		& .status {
			background: var(--good, #2fa36b);
			block-size: 0.375rem;
			border-radius: 50%;
			display: inline-block;
			inline-size: 0.375rem;
			margin-inline-start: 0.375rem;
			vertical-align: middle;

			&.idle {
				background: none;
				box-shadow: inset 0 0 0 1px var(--muted);
			}
		}

		& .at-page {
			color: var(--muted);
			font-size: 0.75rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		& button {
			align-items: center;
			background: none;
			border: 0;
			border-radius: 0.5rem;
			color: inherit;
			cursor: pointer;
			display: flex;
			font: inherit;
			gap: 0.625rem;
			inline-size: 100%;
			padding: 0.375rem 0.5rem;
			text-align: start;

			&:hover,
			&:focus-visible {
				background: color-mix(in srgb, var(--ink) 7%, transparent);
			}

			&:focus-visible {
				outline: 2px solid var(--accent);
				outline-offset: -2px;
			}
		}

		& .face {
			background: var(--c, var(--muted));
			block-size: 1.75rem;
			border-radius: 50%;
			box-shadow: 0 0 0 2px var(--c, var(--muted));
			color: #fff;
			display: grid;
			flex: none;
			font-size: 0.6875rem;
			font-weight: 600;
			inline-size: 1.75rem;
			overflow: hidden;
			place-items: center;
		}

		& .name {
			font-weight: 500;
			min-inline-size: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		& .follow {
			color: var(--muted);
			font-size: 0.75rem;
		}

		& [aria-pressed="true"] .follow {
			color: var(--accent);
			font-weight: 600;
		}
	}

	.heading {
		font-weight: 600;
		margin: 0 0 0.625rem;
	}

	.stories {
		display: grid;
		gap: 0.75rem;
	}

	.story {
		align-items: center;
		cursor: pointer;
		display: flex;
		gap: 0.5rem;

		input {
			accent-color: var(--accent);
			margin: 0;
		}
	}

	.title {
		flex: 1;
		font-weight: 600;
		min-inline-size: 0;
		margin-block: -0.15em;
		overflow: hidden;
		padding-block: 0.15em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.where {
		background: color-mix(in srgb, var(--ink) 7%, transparent);
		border-radius: 999px;
		color: var(--muted);
		font-size: 0.6875rem;
		padding: 0.0625rem 0.4375rem;
	}

	.changes {
		display: grid;
		gap: 0.3125rem;
		margin: 0.4375rem 0 0 1.375rem !important;
	}

	.changes li {
		align-items: baseline;
		display: flex;
		gap: 0.5rem;
	}

	.kind {
		color: var(--muted);
		flex: none;
		font-size: 0.6875rem;
		inline-size: 4.25rem;

		&[data-kind="added"] {
			color: var(--good);
		}

		&[data-kind="removed"] {
			color: var(--danger);
		}
	}

	.what {
		min-inline-size: 0;
		margin-block: -0.15em;
		overflow: hidden;
		padding-block: 0.15em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hint,
	.note,
	li.more {
		color: var(--muted);
	}

	.note {
		margin: 0.25rem 0 0 1.375rem;
	}

	.review > .note {
		margin: 0;
	}

	/* the changes past those listed; not the faces' +N */
	li.more {
		padding-inline-start: 4.75rem;
	}

	.actions {
		align-items: center;
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-block-start: 0.875rem;
	}

	.bones {
		display: grid;
		gap: 0.5rem;
	}

	.bone {
		animation: storyloco-pulse 1.2s ease-in-out infinite alternate;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		block-size: 0.875rem;
		border-radius: 0.25rem;

		&.short {
			inline-size: 60%;
		}
	}

	@keyframes storyloco-pulse {
		to {
			opacity: 0.45;
		}
	}

	.sr {
		block-size: 1px;
		clip-path: inset(50%);
		inline-size: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
	}
</style>
