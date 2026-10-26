<!--
	@component
	Comments on the page, for everyone editing the space: a pin on the block each thread is about,
	where on it someone clicked, and the thread beside it to reply to, mention someone in, or
	resolve. C (or the edit bar) places a new one. Anyone in a thread, or mentioned in it, hears
	about replies by a browser notification once they've allowed it. Mounted by the overlay.
-->
<script lang="ts">
	import { onMount, tick } from "svelte"
	import { fly } from "svelte/transition"
	import { createSubscriber } from "svelte/reactivity"
	import { goto, replaceState } from "$app/navigation"
	import { page } from "$app/state"
	import { call, editor, on_navigate, read_notices } from "./client.js"
	import { on_comments } from "./live.js"
	import Face from "./face.svelte"
	import { anchored, type Anchor } from "./anchor.js"

	type Comment = {
		id: string
		thread: string | null
		story_id: number
		uid: string
		rx: number
		ry: number
		anchor: Anchor | null
		page: string
		user_id: string
		user_name: string | null
		body: string
		mentions: Array<string>
		created_at: number
		resolved_at: number | null
	}
	type Person = { id: string; name: string; photo?: string | null; gravatar?: string | null }
	type Spot = { story: number; uid: string; rx: number; ry: number; anchor: Anchor | null }

	let {
		element_of,
		spot_at,
		color_of,
	}: {
		element_of: (uid: string) => HTMLElement | null | undefined
		/** The block under a point on screen, and where on it, for a new comment */
		spot_at: (x: number, y: number) => Spot | null
		/** An author's colour, when they're editing right now */
		color_of: (user: string) => string | null
	} = $props()

	let comments = $state.raw<Array<Comment>>([])
	/** Every other page's comments, for the list of them all */
	let elsewhere = $state.raw<Array<Comment>>([])
	let people = $state.raw<Array<Person>>([])
	let me = $state("")
	let placing = $state(false)
	let draft = $state<Spot | null>(null)
	let opened = $state<string | null>(null)
	let problem = $state<string | null>(null)
	let busy = $state(false)
	let key = $state<string | null>(null)
	let subscribed = $state(false)

	const ask = <T>(action: string, values: Record<string, unknown> = {}) =>
		call<T>({ op: "comments", do: action, ...values })

	/** Conversations, resolved ones too, each with its replies, the latest word first */
	const threads_of = (some: Array<Comment>) =>
		some
			.filter((c) => !c.thread)
			.map((root) => {
				const replies = some.filter((c) => c.thread === root.id)
				const latest = Math.max(root.created_at, ...replies.map((r) => r.created_at))
				return { root, replies, latest }
			})
			.sort((a, b) => b.latest - a.latest)
	type Thread = ReturnType<typeof threads_of>[number]
	const all_threads = $derived(threads_of(comments))
	/** Those with pins: the open ones, and a resolved one while it's being looked at */
	const threads = $derived(all_threads.filter((t) => !t.root.resolved_at || t.root.id === opened))
	const open_thread = $derived(all_threads.find((t) => t.root.id === opened) ?? null)

	// --- the list of them all, beside the page, as Figma has it

	let listing = $state(false)
	let showing_resolved = $state(false)
	let search = $state("")
	/** The thread whose row the pointer's over, its pin picked out */
	let lit = $state<string | null>(null)

	export function list(on = !listing) {
		listing = on
	}

	const shown = (thread: Thread) => {
		const words = search.trim().toLowerCase()
		return (
			!!thread.root.resolved_at === showing_resolved &&
			(!words ||
				[thread.root, ...thread.replies].some((c) =>
					`${c.body} ${c.user_name ?? ""}`.toLowerCase().includes(words)
				))
		)
	}
	const listed = $derived(all_threads.filter(shown))
	const other_threads = $derived(threads_of(elsewhere))
	/** Other pages' conversations, by page, the page with the latest word first */
	const listed_elsewhere = $derived.by(() => {
		const pages = new Map<string, Array<Thread>>()
		for (const thread of other_threads.filter(shown))
			pages.set(thread.root.page, [...(pages.get(thread.root.page) ?? []), thread])
		return [...pages]
	})
	const everything = $derived([...all_threads, ...other_threads])
	const open_count = $derived(everything.filter((t) => !t.root.resolved_at).length)
	const resolved_count = $derived(everything.length - open_count)
	/** Conversations with something this person hasn't seen, from their notifications */
	const unseen = $derived(
		new Set(editor.inbox.notices.filter((n) => !n.read_at).map((n) => n.thread))
	)

	/** Everyone in a conversation, whoever started it first */
	const voices = (thread: Thread) => {
		const seen = new Map<string, string | null>()
		for (const c of [thread.root, ...thread.replies])
			if (!seen.has(c.user_id)) seen.set(c.user_id, c.user_name)
		return [...seen]
	}

	/** The conversation open, its pin brought smoothly into view if it's off screen */
	function go_to(root: Comment) {
		opened = root.id
		draft = null
		text = ""
		const at = point(root)
		if (at && (at.y < 96 || at.y > innerHeight - 200))
			scrollBy({ top: at.y - innerHeight * 0.4, behavior: "smooth" })
	}

	async function load() {
		const page = location.pathname
		const { comments: found } = await ask<{ comments: Array<Comment> }>("list", {
			// the page too, which a moxy from before every page's were listed answers with that page's
			page,
			all: true,
		}).catch(() => ({ comments: [] as Array<Comment> }))
		if (page !== location.pathname) return
		comments = found.filter((c) => c.page === page)
		elsewhere = found.filter((c) => c.page !== page)
	}

	// the page scrolls and reflows under the pins, so they follow it each frame while any are drawn
	const frames = createSubscriber((update) => {
		let id = requestAnimationFrame(function again() {
			update()
			id = requestAnimationFrame(again)
		})
		return () => cancelAnimationFrame(id)
	})

	/** Where on screen a spot on a block is now; null when the block isn't on the page */
	function point(spot: { uid: string; rx: number; ry: number; anchor: Anchor | null }) {
		frames()
		const node = element_of(spot.uid)
		if (!node) return null
		// on the element or word it was put on; where on the block, when the block's changed too much to find it
		const on = spot.anchor && anchored(node, spot.anchor)
		if (on) return on
		const box = node.getBoundingClientRect()
		return { x: box.left + spot.rx * box.width, y: box.top + spot.ry * box.height }
	}

	// --- moving a pin, as it's being written or once it's there

	/** A pin being dragged: the thread's id, or null for the one being written; where it is now */
	let moving = $state<{ id: string | null; x: number; y: number } | null>(null)
	/** A drag just ended on a pin, so the click that follows it isn't taken as opening it */
	let dragged = false

	const may_move = (comment: Comment) => !editor.guest || comment.user_id === me

	function grab(event: PointerEvent, id: string | null, at: { x: number; y: number }) {
		if (event.button !== 0) return
		// focus stays where it was, in the comment being written
		event.preventDefault()
		const pin = event.currentTarget as HTMLElement
		const start = { x: event.clientX, y: event.clientY }
		let moved = false
		pin.setPointerCapture(event.pointerId)
		const move = (e: PointerEvent) => {
			const dx = e.clientX - start.x
			const dy = e.clientY - start.y
			// a few pixels either way is still a click
			if (!moved && Math.hypot(dx, dy) < 4) return
			moved = true
			moving = { id, x: at.x + dx, y: at.y + dy }
		}
		const done = async (keep: boolean) => {
			pin.removeEventListener("pointermove", move)
			const to = moving
			moving = null
			if (!moved || !to || !keep) return
			dragged = true
			setTimeout(() => (dragged = false))
			const spot = spot_at(to.x, to.y)
			if (!spot) return
			if (id === null) {
				draft = spot
				await tick()
				return document
					.querySelector<HTMLTextAreaElement>("[data-storyloco=comments] .new textarea")
					?.focus()
			}
			// where it was dropped straight away; the save follows
			const was = comments
			comments = comments.map((c) =>
				c.id === id
					? {
							...c,
							story_id: spot.story,
							uid: spot.uid,
							rx: spot.rx,
							ry: spot.ry,
							anchor: spot.anchor,
						}
					: c
			)
			const { story, uid, rx, ry, anchor } = spot
			await ask("move", { id, story, uid, rx, ry, anchor }).catch((e: Error) => {
				comments = was
				problem = e.message
			})
		}
		pin.addEventListener("pointermove", move)
		pin.addEventListener("pointerup", () => done(true), { once: true })
		pin.addEventListener("pointercancel", () => done(false), { once: true })
	}

	/** Where a pin shows: under the pointer while it's dragged, else on its spot */
	const shown_at = (id: string | null, at: { x: number; y: number }) =>
		moving && moving.id === id ? moving : at

	// --- placing a new comment

	export function place(on = !placing) {
		placing = on
		// commenting brings the page's conversations alongside, like Figma
		if (on) listing = true
		document.documentElement.toggleAttribute("data-storyloco-commenting", on)
	}

	function press(event: PointerEvent) {
		if (!placing || (event.target as Element).closest("[data-storyloco]")) return
		event.preventDefault()
		event.stopPropagation()
	}

	function choose(event: MouseEvent) {
		if (!placing || (event.target as Element).closest("[data-storyloco]")) return
		event.preventDefault()
		event.stopPropagation()
		const spot = spot_at(event.clientX, event.clientY)
		place(false)
		if (!spot) return
		draft = spot
		opened = null
		tick().then(() =>
			document
				.querySelector<HTMLTextAreaElement>("[data-storyloco=comments] .new textarea")
				?.focus()
		)
	}

	function key_down(event: KeyboardEvent) {
		if (event.key !== "Escape") return
		if (placing) place(false)
		else if (draft) draft = null
		else if (opened) opened = null
		else if (listing) listing = false
		else return
		event.preventDefault()
	}

	// --- writing, with @mentions

	let text = $state("")
	let mentioned = $state(new Set<string>())
	let suggest = $state<{ query: string; at: number } | null>(null)
	/** Which suggestion Enter takes */
	let chosen = $state(0)
	/** Where the suggestions show: fixed beside the text box, so a card that scrolls can't cut them off */
	let menu = $state<{ left: number; width: number; top?: number; bottom?: number } | null>(null)
	/** The text box the suggestions are for */
	let area: HTMLTextAreaElement | null = null
	const matches = $derived.by(() => {
		if (!suggest) return []
		const query = suggest.query.toLowerCase()
		// any word of a name, so "@smi" finds Jo Smith
		return people
			.filter(
				(p) =>
					p.id !== me &&
					(!query ||
						p.name
							.toLowerCase()
							.split(/\s+/)
							.some((word) => word.startsWith(query)))
			)
			.slice(0, 6)
	})

	function typed(event: Event) {
		area = event.currentTarget as HTMLTextAreaElement
		text = area.value
		const before = area.value.slice(0, area.selectionStart)
		const found = before.match(/(?:^|\s)@([\p{L}'-]*)$/u)
		const was = suggest?.query
		suggest = found ? { query: found[1], at: before.length - found[1].length - 1 } : null
		if (suggest?.query !== was) chosen = 0
		if (!suggest) return (menu = null)
		const box = area.getBoundingClientRect()
		// below the box when there's room, above it when not
		menu =
			innerHeight - box.bottom > 220
				? { left: box.left, width: box.width, top: box.bottom + 4 }
				: { left: box.left, width: box.width, bottom: innerHeight - box.top + 4 }
	}

	function mention(person: Person, area: HTMLTextAreaElement | null) {
		if (!suggest || !area) return
		const end = suggest.at + 1 + suggest.query.length
		const inserted = `@${person.name} `
		const caret = suggest.at + inserted.length
		text = text.slice(0, suggest.at) + inserted + text.slice(end)
		mentioned = new Set([...mentioned, person.id])
		suggest = null
		menu = null
		area.value = text
		area.focus()
		area.setSelectionRange(caret, caret)
	}

	function keys(event: KeyboardEvent, send: () => void) {
		if (suggest && matches.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
			event.preventDefault()
			const step = event.key === "ArrowDown" ? 1 : -1
			chosen = (chosen + step + matches.length) % matches.length
			return
		}
		if (suggest && matches.length && (event.key === "Enter" || event.key === "Tab")) {
			event.preventDefault()
			mention(matches[chosen] ?? matches[0], event.currentTarget as HTMLTextAreaElement)
			return
		}
		if (suggest && event.key === "Escape") {
			// the suggestions first, before Escape closes anything else
			event.preventDefault()
			event.stopPropagation()
			suggest = null
			menu = null
			return
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault()
			send()
		}
	}

	/** Mentions still in the text, by the names put there */
	const kept = () =>
		people.filter((p) => mentioned.has(p.id) && text.includes(`@${p.name}`)).map((p) => p.id)

	async function post(thread?: string) {
		const body = text.trim()
		if (!body || busy) return
		// someone who came by the share's link says who they are first; what they wrote waits for them
		if (editor.guest && !editor.guest.named)
			return void import("./overlay.js").then((o) => o.tool("verify"))
		const spot = thread ? comments.find((c) => c.id === thread) : draft
		if (!spot) return
		busy = true
		problem = null
		try {
			const { comment } = await ask<{ comment: Comment }>("add", {
				story: "story_id" in spot ? spot.story_id : spot.story,
				uid: spot.uid,
				rx: spot.rx,
				ry: spot.ry,
				anchor: spot.anchor,
				page: location.pathname,
				thread,
				body,
				mentions: kept(),
				where: editor.story?.name ?? document.title,
			})
			comments = [...comments, comment]
			opened = comment.thread ?? comment.id
			draft = null
			text = ""
			mentioned = new Set()
		} catch (e) {
			problem = (e as Error).message
		} finally {
			busy = false
		}
	}

	async function resolve(id: string, resolved = true) {
		await ask("resolve", { id, resolved }).catch((e) => (problem = e.message))
		if (resolved) opened = null
		load()
	}

	async function remove(id: string) {
		await ask("remove", { id }).catch((e) => (problem = e.message))
		if (opened === id) opened = null
		load()
	}

	// --- notifications

	const bytes = (key: string) =>
		Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))

	async function worker() {
		const registration = await navigator.serviceWorker.register("/__storyloco/sw.js")
		// its scope isn't the page's, so `serviceWorker.ready` would never settle for it
		if (!registration.active)
			await new Promise<void>((done) => {
				const pending = registration.installing ?? registration.waiting
				pending?.addEventListener("statechange", () => pending.state === "activated" && done())
			})
		return registration
	}

	async function notify_me() {
		if (!key) return
		problem = null
		try {
			if ((await Notification.requestPermission()) !== "granted")
				return (problem = "Notifications are blocked for this site in the browser")
			const registration = await worker()
			const subscription =
				(await registration.pushManager.getSubscription()) ??
				(await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: bytes(key) as BufferSource,
				}))
			await ask("subscribe", { subscription: subscription.toJSON() })
			subscribed = true
		} catch (e) {
			problem = (e as Error).message
		}
	}

	// --- reading

	const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
	function when(at: number) {
		const minutes = Math.round((Date.now() - at) / 60_000)
		if (minutes < 1) return "just now"
		if (minutes < 60) return relative.format(-minutes, "minute")
		if (minutes < 1440) return relative.format(-Math.round(minutes / 60), "hour")
		return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
	}

	/** Someone's photo and Gravatar, from the space's people, for their comments */
	const face_of = (id: string) => {
		const found = people.find((p) => p.id === id)
		return { photo: found?.photo ?? null, gravatar: found?.gravatar ?? null }
	}

	/** The text in pieces, the people mentioned in it picked out */
	function pieces(comment: Comment) {
		const names = people.filter((p) => comment.mentions.includes(p.id)).map((p) => `@${p.name}`)
		if (!names.length) return [{ text: comment.body, mention: false }]
		const pattern = new RegExp(
			`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`
		)
		return comment.body
			.split(pattern)
			.map((part) => ({ text: part, mention: names.includes(part) }))
	}

	/** A card beside its pin, kept on screen while the pin is */
	function card_at(at: { x: number; y: number } | null) {
		if (!at) return ""
		const width = Math.min(320, innerWidth - 32)
		// clear of the list, when it's open beside the page
		const right = innerWidth - (listing && innerWidth > 720 ? 372 : 16)
		const x = at.x + 24 + width > right ? Math.max(at.x - width - 16, 16) : at.x + 24
		// beside the pin, lifted to stay on screen near the bottom, and going off screen with it either way
		const y = Math.min(at.y - 16, Math.max(innerHeight - 200, at.y - 184))
		return `translate: ${x}px ${y}px; width: ${width}px`
	}

	/** Open the thread a notification's link names, from the push or the bell, and take it out of the address */
	function linked() {
		const url = new URL(location.href)
		const wanted = url.searchParams.get("comment")
		if (!wanted) return false
		opened = wanted
		url.searchParams.delete("comment")
		replaceState(url, page.state)
		load().then(() => {
			const root = comments.find((c) => c.id === wanted)
			const node = root && element_of(root.uid)
			node?.scrollIntoView({ block: "center", behavior: "smooth" })
		})
		return true
	}

	// a thread opened, however it was: its notifications have been seen
	$effect(() => {
		const thread = opened
		if (thread && editor.inbox.notices.some((n) => n.thread === thread && !n.read_at))
			read_notices({ thread })
	})

	onMount(() => {
		load()
		ask<{ people: Array<Person>; me: string }>("people")
			.then((found) => ((people = found.people), (me = found.me)))
			.catch(() => {})
		ask<{ key: string | null }>("key")
			.then(async (found) => {
				key = found.key
				if (!key || !("serviceWorker" in navigator) || Notification.permission !== "granted") return
				// already allowed on this browser: keep moxy's copy of the subscription current
				const registration = await navigator.serviceWorker.getRegistration("/__storyloco/")
				const subscription = await registration?.pushManager.getSubscription()
				if (subscription) {
					subscribed = true
					ask("subscribe", { subscription: subscription.toJSON() }).catch(() => {})
				}
			})
			.catch(() => {})

		linked()
		const stop_live = on_comments((path) => (path === location.pathname || listing) && load())
		const stop_nav = on_navigate(() => {
			opened = null
			draft = null
			comments = []
			// arriving from a notification on this site brings its thread, as a first load does
			if (!linked()) load()
		})
		addEventListener("pointerdown", press, true)
		addEventListener("click", choose, true)
		addEventListener("keydown", key_down, true)
		return () => {
			stop_live()
			stop_nav()
			removeEventListener("pointerdown", press, true)
			removeEventListener("click", choose, true)
			removeEventListener("keydown", key_down, true)
			place(false)
		}
	})
</script>

{#snippet Row(thread: Thread, path: string | null)}
	{@const { root, replies, latest } = thread}
	{@const here = path === null && !!element_of(root.uid)}
	<li>
		<button
			type="button"
			class={["thread", { active: opened === root.id, away: path === null && !here }]}
			onclick={() =>
				path === null ? go_to(root) : goto(`${path}?comment=${encodeURIComponent(root.id)}`)}
			onpointerenter={() => (lit = root.id)}
			onpointerleave={() => (lit = null)}
		>
			<span class="voices" aria-hidden="true">
				{#each voices(thread).slice(0, 4) as [id, name] (id)}
					<span class="avatar" style:--c={color_of(id) ?? "var(--muted)"}
						><Face {name} {...face_of(id)} /></span
					>
				{/each}
			</span>
			<span class="meta"
				><b>{root.user_name ?? "Someone"}</b> <span>{when(latest)}</span>
				{#if unseen.has(root.id)}<span class="unseen" aria-label="Unread"></span>{/if}</span
			>
			<span class="body">
				{#each pieces(root) as piece, i (i)}{#if piece.mention}<mark>{piece.text}</mark
						>{:else}{piece.text}{/if}{/each}
			</span>
			{#if replies.length}
				<span class="replies">{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
			{/if}
			{#if path === null && !here}<span class="gone">Its block isn’t showing on the page</span>{/if}
		</button>
	</li>
{/snippet}

{#snippet Writer(thread?: string)}
	<div class="writer">
		<textarea
			rows="2"
			placeholder={thread ? "Reply" : "Add a comment, @ to mention"}
			value={text}
			oninput={typed}
			onkeydown={(event) => keys(event, () => post(thread))}
			onblur={() => ((suggest = null), (menu = null))}
			aria-label={thread ? "Reply" : "Comment"}
		></textarea>
		<div class="row">
			{#if key && !subscribed && "Notification" in globalThis}
				<button type="button" class="quiet" onclick={notify_me}>Notify me of replies</button>
			{/if}
			<button
				type="button"
				class="send"
				disabled={!text.trim() || busy}
				onclick={() => post(thread)}
			>
				{busy ? "Posting…" : thread ? "Reply" : "Comment"}
			</button>
		</div>
	</div>
{/snippet}

<div class="comments" data-storyloco="comments">
	<!-- out here rather than in its card, which scrolls and is moved into place, so would cut it off -->
	{#if suggest && menu}
		<ul
			class="mentions"
			role="listbox"
			aria-label="Mention"
			style:left="{menu.left}px"
			style:width="{Math.max(menu.width, 220)}px"
			style:top={menu.top === undefined ? undefined : `${menu.top}px`}
			style:bottom={menu.bottom === undefined ? undefined : `${menu.bottom}px`}
		>
			{#each matches as person, i (person.id)}
				<li role="option" aria-selected={i === chosen}>
					<button
						type="button"
						class:active={i === chosen}
						onpointerdown={(event) => event.preventDefault()}
						onpointermove={() => (chosen = i)}
						onclick={() => mention(person, area)}
					>
						<span class="face" style:--c={color_of(person.id) ?? "var(--accent)"} aria-hidden="true"
							><Face name={person.name} photo={person.photo} gravatar={person.gravatar} /></span
						>
						<span class="who">{person.name}</span>
						{#if person.id.startsWith("g_")}<span class="guest">Guest</span>{/if}
					</button>
				</li>
			{:else}
				<li class="none">
					{suggest.query
						? `Nobody called “${suggest.query}”`
						: "Nobody else to mention yet: they show here once they've signed in"}
				</li>
			{/each}
		</ul>
	{/if}
	{#each threads as { root, replies } (root.id)}
		{@const spot = point(root)}
		{#if spot}
			{@const at = shown_at(root.id, spot)}
			<button
				type="button"
				class={[
					"pin",
					{
						open: opened === root.id,
						moving: moving?.id === root.id,
						lit: lit === root.id,
						resolved: !!root.resolved_at,
					},
				]}
				class:movable={may_move(root)}
				style:translate="{at.x}px {at.y}px"
				style:--c={color_of(root.user_id) ?? "var(--accent)"}
				aria-label="Comment from {root.user_name ?? 'someone'}{replies.length
					? `, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
					: ''}"
				onpointerdown={(e) => may_move(root) && grab(e, root.id, spot)}
				onclick={() => {
					if (dragged) return
					opened = opened === root.id ? null : root.id
					draft = null
					text = ""
				}}
			>
				<span class="face"><Face name={root.user_name} {...face_of(root.user_id)} /></span>
				{#if replies.length}<span class="count">{replies.length + 1}</span>{/if}
			</button>
		{/if}
	{/each}

	{#if draft}
		{@const spot = point(draft)}
		{#if spot}
			{@const at = shown_at(null, spot)}
			<span
				class={["pin new-pin movable", { moving: moving?.id === null }]}
				style:translate="{at.x}px {at.y}px"
				aria-hidden="true"
				title="Drag to move"
				onpointerdown={(e) => grab(e, null, spot)}>+</span
			>
			<div class="card new" role="dialog" aria-label="New comment" style={card_at(at)}>
				{@render Writer()}
				{#if problem}<p class="problem">{problem}</p>{/if}
			</div>
		{/if}
	{/if}

	{#if open_thread}
		{@const spot = point(open_thread.root)}
		{@const at = spot && shown_at(open_thread.root.id, spot)}
		<div class="card" role="dialog" aria-label="Comments" style={card_at(at)}>
			<div class="head">
				<span>Comments</span>
				{#if !editor.guest}
					{#if open_thread.root.resolved_at}
						<button type="button" class="quiet" onclick={() => resolve(open_thread.root.id, false)}
							>Reopen</button
						>
					{:else}
						<button type="button" class="quiet" onclick={() => resolve(open_thread.root.id)}
							>Resolve</button
						>
					{/if}
				{/if}
				<button type="button" class="close" aria-label="Close" onclick={() => (opened = null)}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
				</button>
			</div>
			<ol class="list">
				{#each [open_thread.root, ...open_thread.replies] as comment (comment.id)}
					<li>
						<span class="avatar" style:--c={color_of(comment.user_id) ?? "var(--muted)"}>
							<Face name={comment.user_name} {...face_of(comment.user_id)} />
						</span>
						<div>
							<p class="meta">
								<b>{comment.user_name ?? "Someone"}</b>
								<span>{when(comment.created_at)}</span>
								{#if comment.user_id === me}
									<button type="button" class="quiet small" onclick={() => remove(comment.id)}>
										Delete
									</button>
								{/if}
							</p>
							<p class="body">
								{#each pieces(comment) as piece, i (i)}{#if piece.mention}<mark>{piece.text}</mark
										>{:else}{piece.text}{/if}{/each}
							</p>
						</div>
					</li>
				{/each}
			</ol>
			{@render Writer(open_thread.root.id)}
			{#if problem}<p class="problem">{problem}</p>{/if}
		</div>
	{/if}

	{#if listing}
		<aside
			class="panel"
			aria-label="Comments on this page"
			transition:fly={{ x: 24, duration: 180 }}
		>
			<header>
				<h2>Comments</h2>
				<button type="button" class="close" aria-label="Close comments" onclick={() => list(false)}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
				</button>
			</header>
			<div class="filters">
				<input
					type="search"
					placeholder="Search"
					aria-label="Search comments"
					bind:value={search}
				/>
				<div class="tabs" role="tablist" aria-label="Which comments">
					<button
						type="button"
						role="tab"
						aria-selected={!showing_resolved}
						onclick={() => (showing_resolved = false)}>Open <span>{open_count}</span></button
					>
					<button
						type="button"
						role="tab"
						aria-selected={showing_resolved}
						onclick={() => (showing_resolved = true)}>Resolved <span>{resolved_count}</span></button
					>
				</div>
			</div>
			<ol class="threads">
				{#each listed as thread (thread.root.id)}
					{@render Row(thread, null)}
				{:else}
					<li class="empty">
						{search.trim()
							? `Nothing here matches “${search.trim()}”`
							: showing_resolved
								? "Nothing resolved on this page"
								: "No comments on this page yet. Click anywhere on it to add one."}
					</li>
				{/each}
				{#each listed_elsewhere as [path, threads] (path)}
					<li class="page-name">{path === "/" ? "Home" : path}</li>
					{#each threads as thread (thread.root.id)}
						{@render Row(thread, path)}
					{/each}
				{/each}
			</ol>
		</aside>
	{/if}

	{#if placing}
		<p class="hint" role="status">Click where the comment goes · Esc to cancel</p>
	{/if}
</div>

<style>
	.comments {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--editor-bg, #fff);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--danger: var(--editor-danger, #e5484d);

		color: var(--ink);
		font:
			500 0.8125rem/1.4 system-ui,
			sans-serif;
		inset: 0;
		pointer-events: none;
		position: fixed;
		z-index: 2147482995;

		& > * {
			pointer-events: auto;
		}
	}

	:global(html[data-storyloco-commenting]),
	:global(html[data-storyloco-commenting] *) {
		cursor: crosshair !important;
	}

	/* a photo fills the pin, keeping its shape */
	.pin .face {
		block-size: 100%;
		border-radius: inherit;
		display: grid;
		inline-size: 100%;
		overflow: hidden;
		place-items: center;
	}

	.pin {
		align-items: center;
		background: var(--c, var(--accent));
		block-size: 1.75rem;
		border: 2px solid #fff;
		border-radius: 50% 50% 50% 0.25rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
		color: #fff;
		cursor: pointer;
		display: flex;
		font:
			600 0.6875rem/1 system-ui,
			sans-serif;
		inline-size: 1.75rem;
		justify-content: center;
		left: 0;
		padding: 0;
		position: absolute;
		top: 0;
		transition: scale 0.15s ease;
		translate: 0 0;
		margin: -1.75rem 0 0 0;

		&:hover,
		&.open {
			scale: 1.12;
		}

		@starting-style {
			scale: 0.4;
		}
	}

	.new-pin {
		background: var(--accent);
		font-size: 1rem;
	}

	/* grabbed and carried, lifted off the page a little */
	.movable {
		cursor: grab;
		touch-action: none;
	}

	.moving {
		cursor: grabbing;
		scale: 1.15;
		transition: scale 0.15s ease;
		z-index: 1;
		box-shadow: 0 8px 20px rgb(0 0 0 / 0.3);
	}

	.count {
		/* the edit bar's own dark, in a light theme or a dark one, so white reads on it */
		background: var(--editor-pill, #1b243f);
		color: #fff;
		border-radius: 999px;
		font-size: 0.5625rem;
		inset: -0.375rem -0.5rem auto auto;
		padding: 0.0625rem 0.3125rem;
		position: absolute;
	}

	.card {
		background: var(--bg);
		border-radius: 0.875rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 12px 32px rgb(27 36 63 / 0.18);
		left: 0;
		max-block-size: min(32rem, calc(100dvh - 2rem));
		overflow: auto;
		padding: 0.75rem;
		position: absolute;
		top: 0;

		@starting-style {
			opacity: 0;
		}

		transition: opacity 0.15s ease;
	}

	.head {
		align-items: center;
		display: flex;
		font-weight: 600;
		gap: 0.5rem;
		margin-block-end: 0.5rem;

		span {
			flex: 1;
		}
	}

	.list {
		display: grid;
		gap: 0.75rem;
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;

		li {
			display: flex;
			gap: 0.5rem;
		}
	}

	.avatar {
		overflow: hidden;
		align-items: center;
		background: var(--c);
		block-size: 1.5rem;
		border-radius: 50%;
		color: #fff;
		display: flex;
		flex: none;
		font-size: 0.625rem;
		font-weight: 600;
		inline-size: 1.5rem;
		justify-content: center;
	}

	.meta {
		align-items: baseline;
		display: flex;
		gap: 0.375rem;
		margin: 0;

		span {
			color: var(--muted);
			font-size: 0.75rem;
		}
	}

	.body {
		margin: 0.125rem 0 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;

		mark {
			background: color-mix(in srgb, var(--accent) 14%, transparent);
			border-radius: 0.25rem;
			color: var(--accent);
			padding: 0 0.125rem;
		}
	}

	.writer {
		position: relative;
	}

	textarea {
		background: color-mix(in srgb, var(--ink) 4%, transparent);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		box-sizing: border-box;
		color: inherit;
		field-sizing: content;
		font: inherit;
		inline-size: 100%;
		max-block-size: 10rem;
		min-block-size: 2.75rem;
		padding: 0.5rem 0.625rem;
		resize: none;

		&:focus-visible {
			background: var(--bg);
			border-color: var(--accent);
			outline: 3px solid color-mix(in srgb, var(--accent) 18%, transparent);
		}
	}

	.mentions {
		background: var(--bg);
		border-radius: 0.625rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 12px 28px rgb(27 36 63 / 0.18);
		box-sizing: border-box;
		list-style: none;
		margin: 0;
		max-block-size: 14rem;
		overflow: auto;
		padding: 0.25rem;
		position: fixed;
		z-index: 2147483001;

		@starting-style {
			opacity: 0;
			translate: 0 -0.25rem;
		}
		transition:
			opacity 0.15s ease,
			translate 0.2s cubic-bezier(0.2, 0.9, 0.25, 1.15);

		button {
			align-items: center;
			background: none;
			border: 0;
			border-radius: 0.4375rem;
			color: inherit;
			cursor: pointer;
			display: flex;
			font: inherit;
			gap: 0.5rem;
			inline-size: 100%;
			padding: 0.375rem 0.5rem;
			text-align: start;

			&.active {
				background: color-mix(in srgb, var(--accent) 12%, transparent);
			}
		}

		.face {
			background: var(--c);
			overflow: hidden;
			block-size: 1.375rem;
			border-radius: 50%;
			color: #fff;
			display: grid;
			flex: none;
			font-size: 0.625rem;
			font-weight: 700;
			inline-size: 1.375rem;
			place-items: center;
		}

		.who {
			flex: 1;
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.guest {
			color: var(--muted);
			font-size: 0.6875rem;
		}

		.none {
			color: var(--muted);
			padding: 0.5rem;
		}
	}

	.row {
		align-items: center;
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		margin-block-start: 0.5rem;
	}

	.send {
		background: var(--accent);
		border: 0;
		border-radius: 999px;
		color: var(--editor-accent-ink, #fff);
		cursor: pointer;
		font: inherit;
		padding: 0.3125rem 0.875rem;

		&:disabled {
			cursor: default;
			opacity: 0.5;
		}
	}

	.quiet {
		background: none;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		font: inherit;
		margin-inline-end: auto;
		padding: 0.25rem;

		&:hover {
			color: var(--accent);
		}

		&.small {
			font-size: 0.75rem;
			margin-inline: auto 0;
		}
	}

	.head .quiet {
		margin: 0;
	}

	.close {
		background: none;
		block-size: 1.5rem;
		border: 0;
		border-radius: 50%;
		color: var(--muted);
		cursor: pointer;
		display: grid;
		inline-size: 1.5rem;
		padding: 0;
		place-items: center;

		svg {
			block-size: 0.875rem;
			fill: none;
			inline-size: 0.875rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-width: 2.25;
		}
	}

	.problem {
		color: var(--danger);
		margin: 0.5rem 0 0;
	}

	.panel {
		background: var(--bg);
		border-radius: 0.875rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 16px 40px rgb(27 36 63 / 0.2);
		display: flex;
		flex-direction: column;
		inline-size: min(22rem, calc(100vw - 1.5rem));
		inset: 0.75rem 0.75rem 0.75rem auto;
		overflow: hidden;
		position: absolute;

		header {
			align-items: center;
			display: flex;
			justify-content: space-between;
			padding: 0.875rem 0.875rem 0.5rem 1rem;
		}

		h2 {
			font-size: 0.9375rem;
			font-weight: 650;
			margin: 0;
		}
	}

	.filters {
		border-block-end: 1px solid var(--line);
		display: grid;
		gap: 0.5rem;
		padding: 0 0.875rem 0.75rem;

		input {
			background: color-mix(in srgb, var(--ink) 5%, transparent);
			border: 0;
			border-radius: 0.5rem;
			color: inherit;
			font: inherit;
			padding: 0.4375rem 0.625rem;

			&:focus-visible {
				outline: 2px solid var(--accent);
			}
		}
	}

	.tabs {
		display: flex;
		gap: 0.25rem;

		button {
			background: none;
			border: 0;
			border-radius: 999px;
			color: var(--muted);
			cursor: pointer;
			font: inherit;
			padding: 0.25rem 0.625rem;
			transition:
				background-color 0.15s,
				color 0.15s;

			&[aria-selected="true"] {
				background: color-mix(in srgb, var(--ink) 8%, transparent);
				color: var(--ink);
			}

			span {
				opacity: 0.6;
			}
		}
	}

	.threads {
		flex: 1;
		list-style: none;
		margin: 0;
		overflow: auto;
		overscroll-behavior: contain;
		padding: 0.375rem;
	}

	.thread {
		background: none;
		border: 0;
		border-radius: 0.625rem;
		color: inherit;
		cursor: pointer;
		display: grid;
		font: inherit;
		gap: 0.25rem;
		inline-size: 100%;
		padding: 0.75rem 0.625rem;
		text-align: start;
		transition: background-color 0.15s;

		&:hover {
			background: color-mix(in srgb, var(--ink) 5%, transparent);
		}

		&.active {
			background: color-mix(in srgb, var(--accent) 12%, transparent);
		}

		&.away {
			opacity: 0.6;
		}

		.voices {
			display: flex;
			margin-block-end: 0.25rem;

			.avatar {
				box-shadow: 0 0 0 2px var(--bg);

				& + .avatar {
					margin-inline-start: -0.375rem;
				}
			}
		}

		.meta span {
			color: var(--muted);
		}

		.body {
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 3;
			display: -webkit-box;
			line-clamp: 3;
			overflow: hidden;
			overflow-wrap: anywhere;
		}

		.replies {
			color: var(--accent);
			font-size: 0.75rem;
			font-weight: 600;
		}

		.gone {
			color: var(--muted);
			font-size: 0.75rem;
		}
	}

	.page-name {
		color: var(--muted);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		overflow: hidden;
		padding: 1rem 0.625rem 0.25rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.thread .meta {
		align-items: center;
		display: flex;
		gap: 0.375rem;
	}

	.unseen {
		background: var(--accent);
		block-size: 0.5rem;
		border-radius: 50%;
		inline-size: 0.5rem;
		margin-inline-start: auto;
	}

	.empty {
		color: var(--muted);
		padding: 1.5rem 1rem;
		text-align: center;
	}

	.pin.lit {
		scale: 1.2;
	}

	.pin.resolved {
		filter: grayscale(1);
		opacity: 0.7;
	}

	.hint {
		background: var(--editor-pill, #1b243f);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
		border-radius: 999px;
		bottom: 1rem;
		color: #fff;
		left: 50%;
		margin: 0;
		padding: 0.5rem 0.875rem;
		pointer-events: none;
		position: absolute;
		translate: -50% 0;
	}
</style>
