<!--
	@component
	The editor's sheets that don't belong to a block: ⌘K to find anything, the page's history,
	a new page, asking someone for a review, and the page at phone and tablet sizes.
-->
<script lang="ts">
	import { tick } from "svelte"
	import { goto } from "$app/navigation"
	import { call, editor, set_editing, set_guest, signout, type SharedWith } from "./client.js"
	import Compare from "./compare.svelte"
	import Face from "./face.svelte"
	import TimeMachine from "./time_machine.svelte"

	type Block = { uid: string; story: number; name: string }
	type View =
		| "palette"
		| "history"
		| "compare"
		| "new_page"
		| "review"
		| "share"
		| "verify"
		| "phone"
		| "tablet"

	let {
		blocks,
		pick,
		label,
		comment,
	}: {
		/** The blocks on the page, in order */
		blocks: () => Array<Block>
		/** Select a block and bring it into view */
		pick: (block: Block) => void
		label: (name: string) => string
		comment: () => void
	} = $props()

	let view = $state<View | null>(null)
	let problem = $state<string | null>(null)
	let busy = $state(false)

	export async function open(next: View) {
		const was = view
		if (!was) {
			back = document.activeElement as HTMLElement | null
			tall = 0
		}
		view = view === next ? null : next
		problem = null
		if (view === "palette") {
			query = ""
			active = 0
			found = []
			looking = false
			await tick()
			sheet?.querySelector("input")?.focus()
		}
		if (view === "new_page") load_new_page()
		if (view === "review") load_people()
		if (view === "share") load_share()
		if (view === "verify") who = { name: "", email: "", code: "", stage: "who" }
		if (view === "new_page" || view === "review" || view === "share" || view === "verify") {
			await tick()
			if (!sheet?.contains(document.activeElement)) sheet?.focus()
		}
		if ((view === "phone" || view === "tablet") && was !== "phone" && was !== "tablet") {
			await tick()
			preview?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus()
		}
	}

	const close = () => (view = null)
	let sheet = $state<HTMLElement>()
	let preview = $state<HTMLElement>()

	/** Where focus was before the editor's sheets took it */
	let back: HTMLElement | null = null
	$effect(() => {
		if (view || !back) return
		if (back.isConnected) back.focus({ preventScroll: true })
		back = null
	})

	function trap(event: KeyboardEvent, box: HTMLElement | undefined) {
		const stops = [
			...(box?.querySelectorAll<HTMLElement>(
				"button:not(:disabled), input:not(:disabled), select, textarea, iframe"
			) ?? []),
		]
		const first = stops[0]
		const last = stops.at(-1)
		if (!first || !last) return
		const at = document.activeElement
		if (event.shiftKey ? at === first || at === box : at === last) {
			event.preventDefault()
			;(event.shiftKey ? last : first).focus()
		}
	}

	/** What a call says went wrong, shown in the sheet */
	async function attempt<T>(run: () => Promise<T>) {
		busy = true
		problem = null
		try {
			return await run()
		} catch (e) {
			problem = (e as Error).message
		} finally {
			busy = false
		}
	}

	const path_of = (full_slug: string) =>
		full_slug === "home" ? "/" : `/${full_slug.replace(/\/home$/, "").replace(/\/$/, "")}`

	// --- motion

	const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches
	const spring = (t: number) => 1 - Math.exp(-6 * t) * Math.cos(7 * t)
	const SPRING = `linear(${Array.from({ length: 25 }, (_, i) => (i === 24 ? 1 : +spring(i / 24).toFixed(4))).join(", ")})`

	/** Rises into place on a spring, and leaves quicker than it came */
	function rise(_: Element, { y = 8, from = 0.97, delay = 0, exit = false } = {}) {
		if (calm()) return { duration: exit ? 100 : 160, css: (t: number) => `opacity: ${t}` }
		return {
			delay,
			duration: exit ? 150 : 420,
			easing: exit ? (p: number) => p * (2 - p) : spring,
			css: (t: number) =>
				`opacity: ${exit ? t : Math.min(1, t * 1.8)}; translate: 0 ${(1 - t) * y}px; scale: ${from + (1 - from) * t}`,
		}
	}

	const veil = (_: Element, { exit = false } = {}) => ({
		duration: exit ? 160 : 220,
		css: (t: number) => `opacity: ${t}`,
	})

	// --- ⌘K

	type Item = {
		id: string
		title: string
		group: string
		icon: string
		hint?: string
		run: () => void
	}
	let query = $state("")
	let active = $state(0)
	let found = $state<Array<{ id: number; name: string; full_slug: string }>>([])
	let looking = $state(false)
	let searching: ReturnType<typeof setTimeout> | undefined

	const ICONS = {
		new: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6",
		history: "M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5M12 7v5l3 2",
		compare: "M12 3v18M5 7H3v10h2M19 7h2v10h-2M8 12H5m11 0h3",
		review:
			"M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M16 11l2 2 4-4",
		phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
		tablet: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
		comment: "M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z",
		edit: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
		block:
			"M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM5 15h6v5H5zM15 15h4v5h-4z",
		page: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
		search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
		rotate: "M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5",
		check: "M20 6 9 17l-5-5",
		spin: "M21 12a9 9 0 1 1-6.22-8.56",
		chevron: "m6 9 6 6 6-6",
		alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4M12 16h.01",
		share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13",
		lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
		globe:
			"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
		link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
		close: "M18 6 6 18M6 6l12 12",
		signout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
		mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6",
	}

	const ACTIONS: Array<Omit<Item, "group">> = [
		{ id: "new", title: "New page", icon: ICONS.new, run: () => open("new_page") },
		{ id: "history", title: "Page history", icon: ICONS.history, run: () => open("history") },
		{
			id: "compare",
			title: "Compare with live",
			icon: ICONS.compare,
			run: () => open("compare"),
		},
		{ id: "review", title: "Ask for a review", icon: ICONS.review, run: () => open("review") },
		{ id: "share", title: "Share the draft", icon: ICONS.share, run: () => open("share") },
		{ id: "phone", title: "Preview on a phone", icon: ICONS.phone, run: () => open("phone") },
		{ id: "tablet", title: "Preview on a tablet", icon: ICONS.tablet, run: () => open("tablet") },
		{ id: "comment", title: "Comment", icon: ICONS.comment, run: () => (close(), comment()) },
		{
			id: "edit",
			title: "Stop editing",
			icon: ICONS.edit,
			run: () => (close(), set_editing(false)),
		},
		{
			id: "signout",
			// who's signed in, now the edit bar keeps to its controls
			title: editor.user?.name ? `Sign out · ${editor.user.name}` : "Sign out",
			icon: ICONS.signout,
			run: () => (close(), signout()),
		},
	]

	const items = $derived.by(() => {
		const words = query.trim().toLowerCase()
		const matches = (title: string) => title.toLowerCase().includes(words)
		const actions = ACTIONS.filter((a) => matches(a.title)).map((a) => ({ ...a, group: "Actions" }))
		const on_page = view === "palette" ? blocks() : []
		const seen = new Set<string>()
		const here = on_page
			.map((block) => ({ block, title: label(block.name) }))
			.filter(({ block, title }) => !seen.has(block.uid) && seen.add(block.uid) && matches(title))
			.slice(0, 8)
			.map(({ block, title }) => ({
				id: block.uid,
				title,
				group: "On this page",
				icon: ICONS.block,
				run: () => (close(), pick(block)),
			}))
		const pages = found.map((story) => ({
			id: `story-${story.id}`,
			title: story.name,
			group: "Pages",
			icon: ICONS.page,
			hint: path_of(story.full_slug),
			run: () => (close(), goto(path_of(story.full_slug))),
		}))
		return [...actions, ...here, ...pages] as Array<Item>
	})

	const groups = $derived.by(() => {
		const out: Array<{ name: string; rows: Array<{ item: Item; i: number }> }> = []
		items.forEach((item, i) => {
			if (out.at(-1)?.name !== item.group) out.push({ name: item.group, rows: [] })
			out.at(-1)!.rows.push({ item, i })
		})
		return out
	})

	/** The title split around what's typed, so the match can stand out */
	function marked(title: string) {
		const words = query.trim()
		const at = words ? title.toLowerCase().indexOf(words.toLowerCase()) : -1
		if (at < 0) return [title, "", ""]
		return [title.slice(0, at), title.slice(at, at + words.length), title.slice(at + words.length)]
	}

	// One highlight that glides between rows, rather than each row lighting up
	let list = $state<HTMLElement>()
	let glow = $state<{ y: number; h: number } | null>(null)
	$effect(() => {
		void groups
		const row = list?.querySelectorAll<HTMLElement>("[role=option]")[active]
		glow = row ? { y: row.offsetTop, h: row.offsetHeight } : null
	})

	function search() {
		active = 0
		clearTimeout(searching)
		const words = query.trim()
		if (!words) {
			looking = false
			return (found = [])
		}
		looking = true
		searching = setTimeout(async () => {
			const reply = await call<{ stories: typeof found }>({ op: "stories", search: words }).catch(
				() => null
			)
			// Storyblok searches the text too: pages named for what's typed come first
			const named = (name: string) => (name.toLowerCase().includes(words.toLowerCase()) ? 0 : 1)
			if (query.trim() !== words) return
			looking = false
			if (reply) found = reply.stories.sort((a, b) => named(a.name) - named(b.name)).slice(0, 8)
		}, 200)
	}

	function palette_keys(event: KeyboardEvent) {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault()
			const step = event.key === "ArrowDown" ? 1 : -1
			active = (active + step + items.length) % Math.max(items.length, 1)
			sheet?.querySelectorAll("[role=option]")[active]?.scrollIntoView({ block: "nearest" })
		}
		if (event.key === "Enter" && items[active]) {
			event.preventDefault()
			items[active].run()
		}
	}

	// The sheet eases to its content's height as it changes from one view to another
	let tall = $state(0)

	// --- a new page

	type Folder = { id: number; name: string; full_slug: string }
	let options = $state<{
		folders: Array<Folder>
		components: Array<{ name: string; display_name: string }>
	} | null>(null)
	let page = $state({ name: "", slug: "", parent: 0, component: "" })
	let slug_edited = false

	const slugify = (name: string) =>
		name
			.toLowerCase()
			.normalize("NFKD")
			.replace(/\p{Diacritic}/gu, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")

	const prefix = $derived.by(() => {
		const folder = options?.folders.find((f) => f.id === page.parent)
		return folder ? `/${folder.full_slug.replace(/\/$/, "")}/` : "/"
	})

	async function load_new_page() {
		options = null
		page = { name: "", slug: "", parent: 0, component: "" }
		slug_edited = false
		const reply = await attempt(() => call<NonNullable<typeof options>>({ op: "new_page" }))
		if (!reply) return
		options = reply
		// most spaces call their usual kind of page "page"
		page.component =
			(reply.components.find((c) => c.name === "page") ?? reply.components[0])?.name ?? ""
		await tick()
		sheet?.querySelector("input")?.focus()
	}

	async function create(event: SubmitEvent) {
		event.preventDefault()
		const reply = await attempt(() =>
			call<{ story: { full_slug: string } }>({ op: "create_page", ...page })
		)
		if (!reply) return
		close()
		goto(path_of(reply.story.full_slug))
	}

	// --- asking for a review

	type Person = { id: string; name: string; photo?: string | null; gravatar?: string | null }
	let people = $state<Array<Person> | null>(null)
	let asked = $state(new Set<string>())
	let note = $state("")
	let sent = $state(0)

	const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

	async function load_people() {
		people = null
		asked = new Set()
		note = ""
		sent = 0
		const reply = await attempt(() =>
			call<{ people: Array<Person>; me: string }>({
				op: "comments",
				do: "people",
			})
		)
		if (!reply) return
		people = reply.people.filter((p) => p.id !== reply.me)
		await tick()
		sheet?.querySelector("input")?.focus()
	}

	async function ask(event: SubmitEvent) {
		event.preventDefault()
		const reply = await attempt(() =>
			call<{ asked: number }>({
				op: "comments",
				do: "review",
				page: location.pathname,
				where: editor.story?.name ?? document.title,
				people: [...asked],
				note,
			})
		)
		if (reply) sent = reply.asked
	}

	// --- sharing the draft

	type Role = "view" | "comment"
	type ShareGuest = {
		id: string
		email: string
		name: string | null
		role: Role
		invited_by: string | null
		verified_at: number | null
		last_seen_at: number | null
	}
	type ShareState = {
		access: "restricted" | "link"
		role: Role
		expires_at: number | null
		link: string
		guests: Array<ShareGuest>
		sent?: Array<{ email: string; sent: boolean; url: string }>
	}
	let share = $state<ShareState | null>(null)
	let invitees = $state("")
	let invite_role = $state<Role>("comment")
	let invite_note = $state("")
	let copied = $state<string | null>(null)
	/** Invitations that couldn't be emailed, with their links to pass on by hand */
	let unsent = $state<Array<{ email: string; url: string }>>([])

	const share_op = (action: string, values: Record<string, unknown> = {}) =>
		attempt(() => call<ShareState>({ op: "share", do: action, ...values })).then((reply) => {
			if (reply) share = reply
			return reply
		})

	async function load_share() {
		share = null
		unsent = []
		await share_op("get")
	}

	async function send_invites(event: SubmitEvent) {
		event.preventDefault()
		const emails = invitees.split(/[\s,;]+/).filter(Boolean)
		if (!emails.length) return
		const reply = await share_op("invite", {
			emails,
			role: invite_role,
			note: invite_note,
			page: location.pathname,
		})
		if (!reply) return
		invitees = ""
		invite_note = ""
		unsent = (reply.sent ?? []).filter((s) => !s.sent)
	}

	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text).catch(() => {})
		copied = what
		setTimeout(() => copied === what && (copied = null), 1600)
	}

	const ago_format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
	function ago(at: number) {
		const minutes = Math.round((Date.now() - at) / 60_000)
		if (minutes < 60) return ago_format.format(-Math.max(minutes, 0), "minute")
		if (minutes < 48 * 60) return ago_format.format(-Math.round(minutes / 60), "hour")
		return ago_format.format(-Math.round(minutes / 1440), "day")
	}

	/** When the link stops working, in words */
	const lasts = (at: number | null) => {
		if (!at) return "Never expires"
		const days = Math.ceil((at - Date.now()) / 86_400_000)
		return days <= 0 ? "Expired" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`
	}

	// --- saying who you are, for a guest from the link

	let who = $state({ name: "", email: "", code: "", stage: "who" as "who" | "code" | "done" })

	async function send_code(event: SubmitEvent) {
		event.preventDefault()
		const reply = await attempt(() =>
			call({ op: "guest_code", name: who.name.trim(), email: who.email.trim() })
		)
		if (!reply) return
		who.stage = "code"
		await tick()
		sheet?.querySelector<HTMLInputElement>("input[autocomplete=one-time-code]")?.focus()
	}

	async function check_code(event: SubmitEvent) {
		event.preventDefault()
		const reply = await attempt(() =>
			call<{ guest: SharedWith }>({ op: "guest_verify", code: who.code })
		)
		if (!reply) return
		set_guest(reply.guest)
		who.stage = "done"
		// on to what they came to do
		setTimeout(() => {
			close()
			comment()
		}, 900)
	}

	// --- phone and tablet

	const DEVICES = {
		phone: { w: 390, h: 844, bezel: 14, radius: 56 },
		tablet: { w: 820, h: 1180, bezel: 18, radius: 38 },
	}
	let landscape = $state(false)
	let turning = $state(false)
	let frame = $state<HTMLElement>()
	let window_w = $state(0)
	let window_h = $state(0)
	const device = $derived(view === "tablet" ? DEVICES.tablet : DEVICES.phone)
	const screen = $derived(landscape ? { w: device.h, h: device.w } : { w: device.w, h: device.h })
	// Real device sizes, scaled down to fit above the bar
	const fit = $derived(
		Math.max(
			0.2,
			Math.min(
				1,
				(window_w - 32) / (screen.w + device.bezel * 2),
				(window_h - 112) / (screen.h + device.bezel * 2)
			)
		)
	)

	async function turn() {
		const before = fit
		turning = !calm()
		landscape = !landscape
		if (!turning) return
		await tick()
		// The new shape starts turned back to the old one, then rotates into place
		await frame
			?.animate(
				[
					{ rotate: `${landscape ? 90 : -90}deg`, scale: `${before}` },
					{ rotate: "0deg", scale: `${fit}` },
				],
				{ duration: 620, easing: SPRING }
			)
			.finished.catch(() => {})
		turning = false
	}
</script>

<svelte:window
	bind:innerWidth={window_w}
	bind:innerHeight={window_h}
	onkeydown={(event) => {
		if (!view || view === "history" || view === "compare") return
		if (event.key === "Escape") {
			event.preventDefault()
			close()
		}
		if (event.key === "Tab") trap(event, view === "phone" || view === "tablet" ? preview : sheet)
	}}
/>

{#snippet Icon(d: string, extra?: string)}
	<svg class={["icon", extra]} viewBox="0 0 24 24" aria-hidden="true"><path {d} /></svg>
{/snippet}

{#snippet Heading(icon: string, title: string, sub: string)}
	<header class="heading">
		<span class="badge">{@render Icon(icon)}</span>
		<span class="titles">
			<span class="title">{title}</span>
			<span class="sub">{sub}</span>
		</span>
	</header>
{/snippet}

{#snippet Loading(rows: number)}
	<div class="skeleton" role="status">
		<span class="sr">Loading…</span>
		{#each { length: rows }, i (i)}
			<span class="bone" style:--i={i}></span>
		{/each}
	</div>
{/snippet}

{#if view === "history"}
	<TimeMachine {label} {close} />
{:else if view === "compare"}
	<Compare {label} {close} />
{:else if view === "phone" || view === "tablet"}
	<div
		bind:this={preview}
		class="device"
		data-storyloco="preview"
		role="dialog"
		aria-modal="true"
		aria-label="This page on a {view}"
		style:--spring={SPRING}
		in:veil
		out:veil={{ exit: true }}
	>
		<div class="stage" in:rise={{ y: 40, from: 0.92 }} out:rise={{ exit: true, y: 24, from: 0.96 }}>
			<div
				bind:this={frame}
				class={["frame", { landscape, turning }]}
				style:inline-size="{screen.w + device.bezel * 2}px"
				style:block-size="{screen.h + device.bezel * 2}px"
				style:padding="{device.bezel}px"
				style:border-radius="{device.radius}px"
				style:scale={fit}
				style:--bezel="{device.bezel}px"
				style:--inner="{device.radius - device.bezel}px"
			>
				<iframe
					title="This page on a {view}"
					src={location.href}
					onload={(e) =>
						// Escape still closes once the page inside has focus
						(e.currentTarget as HTMLIFrameElement).contentWindow?.addEventListener(
							"keydown",
							(key: KeyboardEvent) => key.key === "Escape" && close()
						)}
				></iframe>
			</div>
		</div>
		<div class="device-bar" in:rise={{ y: 16, delay: 60 }} out:rise={{ exit: true, y: 8 }}>
			<div class={["segments", view]}>
				{#each ["phone", "tablet"] as const as size (size)}
					<button type="button" aria-pressed={view === size} onclick={() => (view = size)}>
						{@render Icon(ICONS[size])}
						{size === "phone" ? "Phone" : "Tablet"}
					</button>
				{/each}
			</div>
			<button
				type="button"
				class="turn"
				aria-pressed={landscape}
				aria-label="Turn it sideways"
				title="Turn it sideways"
				onclick={turn}
			>
				{@render Icon(ICONS.rotate)}
			</button>
			<span class="size" aria-hidden="true">{screen.w} × {screen.h}</span>
			<button type="button" class="done" onclick={close}>Done <kbd>esc</kbd></button>
		</div>
	</div>
{:else if view}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="scrim"
		data-storyloco="tools"
		style:--spring={SPRING}
		onclick={(e) => e.target === e.currentTarget && close()}
		in:veil
		out:veil={{ exit: true }}
	>
		<div
			bind:this={sheet}
			class={["sheet", view]}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			aria-label={{
				palette: "Find anything",
				new_page: "New page",
				review: "Ask for a review",
				share: "Share the draft",
				verify: "Say who you are",
			}[view]}
			style:block-size={tall ? `${tall}px` : undefined}
			in:rise={{ y: -10, from: 0.96 }}
			out:rise={{ exit: true, y: -6, from: 0.98 }}
		>
			<div class="body" bind:offsetHeight={tall}>
				{#if view === "palette"}
					<div class="view">
						<div class="search">
							{@render Icon(ICONS.search)}
							<input
								class="find"
								type="search"
								role="combobox"
								autocomplete="off"
								spellcheck="false"
								placeholder="Find a page, a block or an action"
								aria-label="Find a page, a block or an action"
								aria-controls="storyloco-tools-list"
								aria-expanded="true"
								aria-autocomplete="list"
								aria-activedescendant={items[active] ? `storyloco-tools-${active}` : undefined}
								bind:value={query}
								oninput={search}
								onkeydown={palette_keys}
							/>
							{#if looking}
								{@render Icon(ICONS.spin, "spin")}
							{/if}
							<kbd>esc</kbd>
						</div>
						<ul bind:this={list} id="storyloco-tools-list" role="listbox" aria-label="Results">
							{#if glow}
								<li
									class="glow"
									role="presentation"
									style:translate="0 {glow.y}px"
									style:block-size="{glow.h}px"
								></li>
							{/if}
							{#each groups as group (group.name)}
								<li role="presentation">
									<span class="group" id="storyloco-tools-{group.name.replace(/\W+/g, '-')}">
										{group.name}
									</span>
									<ul
										role="group"
										aria-labelledby="storyloco-tools-{group.name.replace(/\W+/g, '-')}"
									>
										{#each group.rows as { item, i } (item.id)}
											{@const [before, match, after] = marked(item.title)}
											<li
												id="storyloco-tools-{i}"
												class="option"
												role="option"
												tabindex="-1"
												aria-selected={i === active}
												onpointermove={() => (active = i)}
												onmousedown={(e) => e.preventDefault()}
												onclick={item.run}
											>
												<span class="tile">{@render Icon(item.icon)}</span>
												<span class="label">{before}<mark>{match}</mark>{after}</span>
												{#if item.hint}<span class="hint">{item.hint}</span>{/if}
												<kbd class="enter" aria-hidden="true">↵</kbd>
											</li>
										{/each}
									</ul>
								</li>
							{/each}
						</ul>
						{#if !items.length}
							<div class="empty" role="status">
								{@render Icon(ICONS.search)}
								{#if looking}
									Looking for pages…
								{:else}
									Nothing matches “{query.trim()}”
								{/if}
							</div>
						{/if}
						<div class="keys" aria-hidden="true">
							<span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
							<span><kbd>↵</kbd> to open</span>
							<span><kbd>esc</kbd> to close</span>
						</div>
					</div>
				{:else if view === "new_page"}
					<div class="view" in:rise={{ y: 6, from: 1 }}>
						{@render Heading(ICONS.new, "New page", "It starts as a draft")}
						{#if !options}
							{#if !problem}{@render Loading(3)}{/if}
						{:else}
							<form onsubmit={create}>
								<label class="field">
									<span>Name</span>
									<input
										required
										maxlength="200"
										placeholder="Our story"
										value={page.name}
										oninput={(e) => {
											page.name = e.currentTarget.value
											// the slug follows the name until it's typed in itself
											if (!slug_edited) page.slug = slugify(page.name)
										}}
									/>
								</label>
								<label class="field">
									<span>Slug</span>
									<span class="joined">
										{#key prefix}
											<span class="prefix" in:rise={{ y: -4, from: 1 }}>{prefix}</span>
										{/key}
										<input
											required
											maxlength="200"
											pattern="[a-z0-9][a-z0-9\-]*"
											placeholder="our-story"
											bind:value={page.slug}
											oninput={(e) => (slug_edited = e.currentTarget.value !== "")}
										/>
									</span>
								</label>
								<div class="pair">
									<label class="field">
										<span>In</span>
										<span class="select">
											<select bind:value={page.parent}>
												<option value={0}>The top level</option>
												{#each options.folders as folder (folder.id)}
													<option value={folder.id}>{folder.full_slug}</option>
												{/each}
											</select>
											{@render Icon(ICONS.chevron)}
										</span>
									</label>
									{#if options.components.length > 1}
										<label class="field">
											<span>Kind</span>
											<span class="select">
												<select bind:value={page.component}>
													{#each options.components as component (component.name)}
														<option value={component.name}>{component.display_name}</option>
													{/each}
												</select>
												{@render Icon(ICONS.chevron)}
											</span>
										</label>
									{/if}
								</div>
								<p class="note">Nobody else sees it until it's published.</p>
								<div class="actions">
									<button type="button" class="ghost" onclick={close}>Cancel</button>
									<button type="submit" class="primary" disabled={busy || !page.component}>
										{#if busy}{@render Icon(ICONS.spin, "spin")}{/if}
										{busy ? "Making it…" : "Make the page"}
									</button>
								</div>
							</form>
						{/if}
					</div>
				{:else if view === "share"}
					<div class="view" in:rise={{ y: 6, from: 1 }}>
						{@render Heading(
							ICONS.share,
							"Share the draft",
							`Of ${location.host}, for people who don't edit it`
						)}
						{#if !share}
							{#if !problem}{@render Loading(3)}{/if}
						{:else}
							<form class="invite" onsubmit={send_invites}>
								<span class="joined">
									<input
										type="text"
										inputmode="email"
										autocomplete="off"
										aria-label="Emails to invite"
										placeholder="Add people by email"
										bind:value={invitees}
									/>
									<span class="select inline">
										<select aria-label="What they can do" bind:value={invite_role}>
											<option value="comment">Can comment</option>
											<option value="view">Can view</option>
										</select>
										{@render Icon(ICONS.chevron)}
									</span>
								</span>
								{#if invitees.trim()}
									<div class="more" in:rise={{ y: -4, from: 1 }}>
										<textarea
											rows="2"
											maxlength="1000"
											aria-label="A note for them"
											placeholder="A note for them, if it helps"
											bind:value={invite_note}
										></textarea>
										<div class="actions">
											<button type="submit" class="primary" disabled={busy}>
												{#if busy}{@render Icon(ICONS.spin, "spin")}{/if}
												{busy ? "Inviting…" : "Invite"}
											</button>
										</div>
									</div>
								{/if}
							</form>

							{#if unsent.length}
								<div class="unsent" role="status">
									<p class="note">
										Couldn't email {unsent.length === 1 ? "them" : "these"}: send the sign-in link
										yourself.
									</p>
									{#each unsent as person (person.email)}
										<button
											type="button"
											class="ghost"
											onclick={() => copy(person.url, person.email)}
										>
											{@render Icon(ICONS.link)}
											{copied === person.email ? "Copied" : `Copy ${person.email}'s link`}
										</button>
									{/each}
								</div>
							{/if}

							<p class="section">People with access</p>
							<ul class="access">
								{#each share.guests as guest (guest.id)}
									{@const name = guest.name ?? guest.email}
									<li style:--hue={hue(guest.id)} in:rise={{ y: 4, from: 1 }}>
										<span class="avatar" aria-hidden="true"
											><Face name={guest.name ?? guest.email} email={guest.email} /></span
										>
										<span class="titles">
											<span class="title">{name}</span>
											<span class="sub">
												{guest.name ? `${guest.email} · ` : ""}{guest.last_seen_at
													? `Seen ${ago(guest.last_seen_at)}`
													: guest.verified_at
														? "Signed in"
														: "Hasn't opened it yet"}{guest.invited_by
													? ` · invited by ${guest.invited_by.split(" ")[0]}`
													: " · came by the link"}
											</span>
										</span>
										<span class="select inline">
											<select
												aria-label="What {name} can do"
												value={guest.role}
												onchange={(e) =>
													share_op("role", { id: guest.id, role: e.currentTarget.value })}
											>
												<option value="comment">Can comment</option>
												<option value="view">Can view</option>
											</select>
											{@render Icon(ICONS.chevron)}
										</span>
										<button
											type="button"
											class="ghost square"
											aria-label="Remove {name}"
											title="Remove"
											disabled={busy}
											onclick={() => share_op("remove", { id: guest.id })}
										>
											{@render Icon(ICONS.close)}
										</button>
									</li>
								{:else}
									<li class="empty">
										Nobody yet. Invite people by email, or let anyone with the link look.
									</li>
								{/each}
							</ul>

							<p class="section">General access</p>
							<div class={["general", { on: share.access === "link" }]}>
								<span class="badge">
									{@render Icon(share.access === "link" ? ICONS.globe : ICONS.lock)}
								</span>
								<span class="titles">
									<span class="select bare">
										<select
											aria-label="Who can open the link"
											value={share.access}
											onchange={(e) => share_op("set", { access: e.currentTarget.value })}
										>
											<option value="restricted">Only people invited</option>
											<option value="link">Anyone with the link</option>
										</select>
										{@render Icon(ICONS.chevron)}
									</span>
									<span class="sub">
										{share.access === "link"
											? `${share.role === "comment" ? "Can comment, once they've confirmed their email" : "Can look, not comment"} · ${lasts(share.expires_at)}`
											: "Nobody else can open it, link or not"}
									</span>
								</span>
								{#if share.access === "link"}
									<span class="select inline">
										<select
											aria-label="What anyone with the link can do"
											value={share.role}
											onchange={(e) => share_op("set", { role: e.currentTarget.value })}
										>
											<option value="view">Can view</option>
											<option value="comment">Can comment</option>
										</select>
										{@render Icon(ICONS.chevron)}
									</span>
								{/if}
							</div>
							{#if share.access === "link"}
								<div class="expiry" in:rise={{ y: -4, from: 1 }}>
									<span class="select inline">
										<select
											aria-label="How long the link works"
											value=""
											onchange={(e) => {
												const days = e.currentTarget.value
												e.currentTarget.value = ""
												share_op("set", { days: days === "never" ? null : Number(days) })
											}}
										>
											<option value="" disabled>{lasts(share.expires_at)}</option>
											<option value="7">Expire in a week</option>
											<option value="30">Expire in 30 days</option>
											<option value="never">Never expire</option>
										</select>
										{@render Icon(ICONS.chevron)}
									</span>
								</div>
							{/if}

							<div class="actions">
								{#if share.access === "link"}
									<button
										type="button"
										class="ghost"
										title="The old link stops working"
										disabled={busy}
										onclick={() => share_op("reset")}>Reset link</button
									>
								{/if}
								<button
									type="button"
									class="primary"
									disabled={share.access !== "link"}
									title={share.access === "link" ? "" : "Let anyone with the link look first"}
									onclick={() => share && copy(share.link, "link")}
								>
									{@render Icon(copied === "link" ? ICONS.check : ICONS.link)}
									{copied === "link" ? "Copied" : "Copy link"}
								</button>
							</div>
						{/if}
					</div>
				{:else if view === "verify"}
					<div class="view" in:rise={{ y: 6, from: 1 }}>
						{#if who.stage === "done"}
							<div class="sent" role="status" in:rise={{ y: 8, from: 0.94 }}>
								<svg class="tick" viewBox="0 0 48 48" aria-hidden="true">
									<circle cx="24" cy="24" r="21" pathLength="1" />
									<path d="m15 24.5 6 6 12-13" pathLength="1" />
								</svg>
								<p class="title">Thanks, {who.name.split(" ")[0]}</p>
								<p class="note">Click where your comment goes.</p>
							</div>
						{:else}
							{@render Heading(
								ICONS.comment,
								"Who's commenting?",
								"So everyone knows who said what"
							)}
							{#if who.stage === "who"}
								<form onsubmit={send_code}>
									<label class="field">
										<span>Your name</span>
										<input required maxlength="80" autocomplete="name" bind:value={who.name} />
									</label>
									<label class="field">
										<span>Email</span>
										<input
											required
											type="email"
											maxlength="254"
											autocomplete="email"
											bind:value={who.email}
										/>
									</label>
									<p class="note">We'll email you six digits to confirm it's you. Nothing else.</p>
									<div class="actions">
										<button type="button" class="ghost" onclick={close}>Cancel</button>
										<button type="submit" class="primary" disabled={busy}>
											{#if busy}{@render Icon(ICONS.spin, "spin")}{/if}
											{busy ? "Sending…" : "Send me a code"}
										</button>
									</div>
								</form>
							{:else}
								<form onsubmit={check_code}>
									<label class="field">
										<span>The code we sent to {who.email}</span>
										<input
											class="code"
											required
											inputmode="numeric"
											autocomplete="one-time-code"
											pattern="[0-9 ]{'{'}6,7}"
											maxlength="7"
											placeholder="000000"
											bind:value={who.code}
										/>
									</label>
									<div class="actions">
										<button type="button" class="ghost" onclick={() => (who.stage = "who")}
											>Use another email</button
										>
										<button type="submit" class="primary" disabled={busy}>
											{#if busy}{@render Icon(ICONS.spin, "spin")}{/if}
											{busy ? "Checking…" : "Confirm"}
										</button>
									</div>
								</form>
							{/if}
						{/if}
					</div>
				{:else if view === "review"}
					<div class="view" in:rise={{ y: 6, from: 1 }}>
						{#if sent}
							<div class="sent" role="status" in:rise={{ y: 8, from: 0.94 }}>
								<svg class="tick" viewBox="0 0 48 48" aria-hidden="true">
									<circle cx="24" cy="24" r="21" pathLength="1" />
									<path d="m15 24.5 6 6 12-13" pathLength="1" />
								</svg>
								<p class="title">Asked {sent === 1 ? "them" : `all ${sent}`}</p>
								<p class="note">
									It's in their notifications, and on their phone if they've allowed it.
								</p>
							</div>
							<div class="actions">
								<button type="button" class="primary" onclick={close} {@attach (b) => b.focus()}>
									Done
								</button>
							</div>
						{:else}
							{@render Heading(ICONS.review, "Ask for a review", "They'll get a link to this page")}
							{#if !people}
								{#if !problem}{@render Loading(2)}{/if}
							{:else if !people.length}
								<p class="note">Nobody else has signed in to edit this site yet.</p>
							{:else}
								<form onsubmit={ask}>
									<ul class="people" aria-label="Who to ask">
										{#each people as person (person.id)}
											<li>
												<label class="person" style:--hue={hue(person.id)}>
													<input
														type="checkbox"
														checked={asked.has(person.id)}
														onchange={(e) => {
															const next = new Set(asked)
															if (e.currentTarget.checked) next.add(person.id)
															else next.delete(person.id)
															asked = next
														}}
													/>
													<span class="avatar" aria-hidden="true">
														<Face
															name={person.name}
															photo={person.photo}
															gravatar={person.gravatar}
														/>
														{@render Icon(ICONS.check, "picked")}
													</span>
													{person.name}
												</label>
											</li>
										{/each}
									</ul>
									<label class="field">
										<span>A note, if it helps</span>
										<textarea
											rows="3"
											maxlength="1000"
											placeholder="Anything you'd like them to look at?"
											bind:value={note}
										></textarea>
									</label>
									<div class="actions">
										<button type="button" class="ghost" onclick={close}>Cancel</button>
										<button type="submit" class="primary" disabled={busy || !asked.size}>
											{#if busy}{@render Icon(ICONS.spin, "spin")}{/if}
											{busy ? "Asking…" : asked.size > 1 ? `Ask ${asked.size} people` : "Ask"}
										</button>
									</div>
								</form>
							{/if}
						{/if}
					</div>
				{/if}
				{#if problem}
					<p class="problem" role="alert" in:rise={{ y: -4, from: 1 }}>
						{@render Icon(ICONS.alert)}
						{problem}
					</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.scrim, .device) :not(svg, svg *) {
		all: revert;
	}

	.scrim,
	.device {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--storyloco-bar-bg, #fff);
		--ink: var(--storyloco-bar-ink, #1b243f);
		--muted: var(--storyloco-bar-muted, #6b7280);
		--line: var(--storyloco-bar-line, rgb(27 36 63 / 0.12));
		--accent: var(--storyloco-accent, #05807f);
		--accent-ink: var(--storyloco-accent-ink, #fff);
		--danger: var(--storyloco-danger, #e5484d);
		--wash: color-mix(in oklab, var(--ink) 6%, transparent);
		--tint: color-mix(in oklab, var(--accent) 12%, transparent);
		--ease: cubic-bezier(0.2, 0.8, 0.2, 1);

		color: var(--ink);
		font: var(--storyloco-bar-font, 500 0.8125rem/1.4 system-ui, sans-serif);
		inset: 0;
		position: fixed;
		z-index: 2147483000;

		& * {
			box-sizing: border-box;
		}
	}

	.scrim {
		background: rgb(15 20 35 / 0.32);
		display: grid;
		padding: 12vh 1rem 1rem;
		place-items: start center;
	}

	.sheet {
		--w: 30rem;

		background: var(--bg);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 1px 2px rgb(0 0 0 / 0.06),
			0 12px 24px -8px rgb(15 20 35 / 0.18),
			0 32px 80px -16px rgb(15 20 35 / 0.32);
		inline-size: min(var(--w), 100%);
		max-block-size: min(76vh, 36rem);
		outline: none;
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		transition:
			inline-size 0.42s var(--spring),
			block-size 0.3s var(--ease);

		&.palette {
			--w: 38rem;
		}
	}

	.body {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;

		.palette & {
			padding: 0;
		}
	}

	.view {
		display: grid;
		gap: 0.875rem;

		.palette & {
			gap: 0;
		}
	}

	.icon {
		block-size: 1.125rem;
		fill: none;
		flex: none;
		inline-size: 1.125rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.75;
	}

	.spin {
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}

	kbd {
		background: var(--bg);
		border-radius: 0.3125rem;
		box-shadow:
			inset 0 0 0 1px var(--line),
			inset 0 -1px 0 var(--line);
		color: var(--muted);
		display: inline-grid;
		font:
			600 0.6875rem/1 system-ui,
			sans-serif;
		min-inline-size: 1.25rem;
		padding: 0.25rem 0.3125rem;
		place-items: center;
	}

	.sr {
		block-size: 1px;
		clip-path: inset(50%);
		inline-size: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
	}

	/* --- ⌘K */

	.search {
		align-items: center;
		background: var(--bg);
		border-block-end: 1px solid var(--line);
		color: var(--muted);
		display: flex;
		gap: 0.625rem;
		inset-block-start: 0;
		padding: 0.875rem 1rem;
		position: sticky;
		z-index: 2;

		& .icon {
			block-size: 1.25rem;
			inline-size: 1.25rem;
		}
	}

	.find {
		background: none;
		border: 0;
		color: var(--ink);
		flex: 1;
		font: inherit;
		font-size: 1rem;
		font-weight: 450;
		min-inline-size: 0;
		outline: none;
		padding: 0;

		&::placeholder {
			color: var(--muted);
			opacity: 0.8;
		}

		&::-webkit-search-cancel-button {
			display: none;
		}
	}

	ul {
		display: grid;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	[role="listbox"] {
		padding: 0.375rem;
		position: relative;
	}

	.glow {
		background: var(--wash);
		border-radius: 0.625rem;
		inset-block-start: 0;
		inset-inline: 0.375rem;
		pointer-events: none;
		position: absolute;
		transition:
			translate 0.36s var(--spring),
			block-size 0.2s var(--ease);
	}

	.group {
		color: var(--muted);
		display: block;
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		padding: 0.625rem 0.625rem 0.3125rem;
	}

	.option {
		align-items: center;
		border-radius: 0.625rem;
		cursor: pointer;
		display: grid;
		gap: 0.75rem;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		outline: none;
		padding: 0.4375rem 0.625rem 0.4375rem 0.4375rem;
		position: relative;
		scroll-margin-block: 3.75rem 2.75rem;
		z-index: 1;
	}

	.tile {
		background: var(--bg);
		border-radius: 0.5rem;
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--muted);
		display: grid;
		block-size: 1.875rem;
		inline-size: 1.875rem;
		place-items: center;
		transition:
			color 0.2s,
			background-color 0.2s,
			box-shadow 0.2s;

		& .icon {
			block-size: 1rem;
			inline-size: 1rem;
		}

		[aria-selected="true"] > & {
			background: var(--tint);
			box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 24%, transparent);
			color: var(--accent);
		}
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	mark {
		background: none;
		color: var(--accent);
		font-weight: 650;
	}

	.hint {
		color: var(--muted);
		font-size: 0.75rem;
		max-inline-size: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.enter {
		opacity: 0;
		scale: 0.85;
		transition:
			opacity 0.15s,
			scale 0.25s var(--spring);

		[aria-selected="true"] > & {
			opacity: 1;
			scale: 1;
		}
	}

	.empty {
		align-items: center;
		color: var(--muted);
		display: grid;
		gap: 0.5rem;
		justify-items: center;
		padding: 1.5rem 1rem 2rem;

		& .icon {
			block-size: 1.5rem;
			inline-size: 1.5rem;
			opacity: 0.6;
		}
	}

	.keys {
		background: color-mix(in oklab, var(--bg) 92%, var(--ink));
		border-block-start: 1px solid var(--line);
		color: var(--muted);
		display: flex;
		font-size: 0.75rem;
		gap: 1rem;
		inset-block-end: 0;
		justify-content: flex-end;
		padding: 0.5rem 1rem;
		position: sticky;
		z-index: 2;

		& span {
			align-items: center;
			display: flex;
			gap: 0.25rem;
		}

		& kbd {
			font-size: 0.625rem;
			min-inline-size: 1.125rem;
			padding: 0.1875rem 0.25rem;
		}
	}

	/* --- sheets */

	.heading {
		align-items: center;
		display: flex;
		gap: 0.75rem;
	}

	.badge {
		background: var(--tint);
		border-radius: 0.625rem;
		block-size: 2.25rem;
		color: var(--accent);
		display: grid;
		flex: none;
		inline-size: 2.25rem;
		place-items: center;
	}

	.titles {
		display: grid;
	}

	.title {
		font-size: 0.9375rem;
		font-weight: 650;
		margin: 0;
	}

	.sub,
	.note {
		color: var(--muted);
		margin: 0;
	}

	.problem {
		align-items: center;
		background: color-mix(in oklab, var(--danger) 9%, transparent);
		border-radius: 0.625rem;
		color: var(--danger);
		display: flex;
		gap: 0.5rem;
		margin: 0;
		padding: 0.5rem 0.625rem;

		.palette & {
			margin: 0 0.75rem 0.75rem;
		}
	}

	.skeleton {
		display: grid;
		gap: 0.625rem;
	}

	.bone {
		animation: shimmer 1.4s ease-in-out infinite;
		animation-delay: calc(var(--i) * 0.12s);
		background: linear-gradient(90deg, var(--wash) 30%, transparent 50%, var(--wash) 70%) 100% 0 /
			300% 100%;
		block-size: 2.25rem;
		border-radius: 0.5rem;
		display: block;

		&:last-child {
			inline-size: 60%;
		}
	}

	@keyframes shimmer {
		to {
			background-position: 0 0;
		}
	}

	button,
	input,
	select,
	textarea {
		font: inherit;
	}

	form {
		display: grid;
		gap: 0.875rem;
		margin: 0;
	}

	.field {
		display: grid;
		gap: 0.3125rem;

		& > span:first-child {
			font-size: 0.75rem;
			font-weight: 600;
		}
	}

	.pair {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
	}

	form input:not([type="checkbox"]),
	select,
	textarea,
	.joined {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 0.5625rem;
		color: var(--ink);
		font-weight: 500;
		inline-size: 100%;
		outline: none;
		padding: 0.5rem 0.625rem;
		transition:
			border-color 0.15s,
			box-shadow 0.2s;

		&:focus,
		&:focus-within {
			border-color: var(--accent);
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 20%, transparent);
		}

		&::placeholder {
			color: var(--muted);
			opacity: 0.6;
		}
	}

	textarea {
		resize: vertical;
	}

	.joined {
		align-items: baseline;
		display: flex;

		& input:not([type="checkbox"]),
		& input:not([type="checkbox"]):focus {
			border: 0;
			box-shadow: none;
			flex: 1;
			min-inline-size: 0;
			padding: 0;
		}
	}

	.prefix {
		color: var(--muted);
		display: inline-block;
		max-inline-size: 55%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select {
		display: grid;

		& > * {
			grid-area: 1 / 1;
		}

		& select {
			appearance: none;
			cursor: pointer;
			padding-inline-end: 2rem;
		}

		& .icon {
			align-self: center;
			color: var(--muted);
			justify-self: end;
			margin-inline-end: 0.625rem;
			pointer-events: none;
		}
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.actions button,
	.device-bar button {
		align-items: center;
		background: var(--wash);
		border: 0;
		border-radius: 0.5625rem;
		color: inherit;
		cursor: pointer;
		display: inline-flex;
		font-weight: 600;
		gap: 0.375rem;
		padding: 0.5rem 0.875rem;
		transition:
			background-color 0.15s,
			color 0.15s,
			scale 0.2s var(--spring),
			opacity 0.15s;

		&:hover:not(:disabled) {
			background: color-mix(in oklab, var(--ink) 10%, transparent);
		}

		&:active:not(:disabled) {
			scale: 0.97;
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}

		&.primary {
			background: var(--accent);
			box-shadow:
				inset 0 1px 0 rgb(255 255 255 / 0.16),
				0 1px 2px color-mix(in oklab, var(--accent) 40%, transparent);
			color: var(--accent-ink);

			&:hover:not(:disabled) {
				background: color-mix(in oklab, var(--accent) 88%, black);
			}
		}

		&.ghost {
			background: none;

			&:hover {
				background: var(--wash);
			}
		}

		&:disabled {
			cursor: default;
			opacity: 0.45;
		}
	}

	/* --- sharing */

	.invite {
		display: grid;
		gap: 0.5rem;

		& .joined {
			align-items: center;
			padding-block: 0.25rem;
			padding-inline-end: 0.25rem;
		}

		& .more {
			display: grid;
			gap: 0.5rem;
		}
	}

	/* a select that sits in a row, quietly, until it's used */
	.select.inline select,
	.select.bare select {
		background: none;
		border-color: transparent;
		box-shadow: none;
		font-weight: 600;
		inline-size: auto;
		padding-block: 0.3125rem;

		&:hover {
			background: var(--wash);
		}

		&:focus {
			border-color: var(--accent);
		}
	}

	.select.bare select {
		font-size: 0.875rem;
		padding-inline-start: 0.375rem;
		margin-inline-start: -0.375rem;
	}

	.section {
		color: var(--muted);
		font-size: 0.6875rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		margin: 0.5rem 0 -0.25rem;
		text-transform: uppercase;
	}

	.access {
		display: grid;
		gap: 0.125rem;
		list-style: none;
		margin: 0;
		padding: 0;

		& li {
			align-items: center;
			border-radius: 0.625rem;
			display: flex;
			gap: 0.625rem;
			padding: 0.375rem 0.25rem 0.375rem 0.375rem;
			transition: background-color 0.15s;

			&:hover {
				background: var(--wash);
			}
		}

		& .empty {
			color: var(--muted);
			padding: 0.5rem 0.25rem;

			&:hover {
				background: none;
			}
		}

		& .titles {
			display: grid;
			flex: 1;
			min-inline-size: 0;
		}

		& .title {
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		& .sub {
			color: var(--muted);
			font-size: 0.75rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.square {
		align-items: center;
		background: none;
		block-size: 1.875rem;
		border: 0;
		border-radius: 0.5rem;
		color: var(--muted);
		cursor: pointer;
		display: inline-flex;
		inline-size: 1.875rem;
		justify-content: center;
		padding: 0;
		transition:
			background-color 0.15s,
			color 0.15s;

		&:hover:not(:disabled) {
			background: color-mix(in oklab, var(--danger) 12%, transparent);
			color: var(--danger);
		}

		&:focus-visible {
			outline: 2px solid var(--accent);
		}
	}

	.general {
		align-items: center;
		border-radius: 0.75rem;
		box-shadow: inset 0 0 0 1px var(--line);
		display: flex;
		gap: 0.75rem;
		padding: 0.625rem 0.5rem 0.625rem 0.625rem;
		transition:
			background-color 0.3s,
			box-shadow 0.3s;

		&.on {
			background: var(--tint);
			box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
		}

		& .badge {
			background: var(--wash);
			block-size: 2.25rem;
			border-radius: 50%;
			color: var(--muted);
			display: grid;
			flex: none;
			inline-size: 2.25rem;
			place-items: center;
			transition:
				background-color 0.3s,
				color 0.3s,
				rotate 0.5s var(--spring);
		}

		&.on .badge {
			background: var(--accent);
			color: var(--accent-ink);
			rotate: 360deg;
		}

		& .titles {
			display: grid;
			flex: 1;
			min-inline-size: 0;
		}

		& .sub {
			color: var(--muted);
			font-size: 0.75rem;
		}
	}

	.expiry {
		display: flex;
		justify-content: flex-end;
		margin-block-start: -0.25rem;
	}

	.unsent {
		background: color-mix(in oklab, #ffb224 14%, transparent);
		border-radius: 0.75rem;
		display: grid;
		gap: 0.25rem;
		justify-items: start;
		padding: 0.625rem 0.75rem;

		& button {
			align-items: center;
			background: none;
			border: 0;
			color: var(--ink);
			cursor: pointer;
			display: inline-flex;
			font-weight: 600;
			gap: 0.375rem;
			padding: 0.25rem 0;
		}
	}

	input.code {
		font:
			700 1.5rem/1 ui-monospace,
			monospace;
		letter-spacing: 0.5em;
		text-align: center;
	}

	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.person {
		align-items: center;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: pointer;
		display: flex;
		gap: 0.5rem;
		padding: 0.25rem 0.75rem 0.25rem 0.25rem;
		position: relative;
		transition:
			background-color 0.15s,
			box-shadow 0.15s,
			scale 0.25s var(--spring);
		user-select: none;

		&:hover {
			background: var(--wash);
		}

		&:active {
			scale: 0.97;
		}

		& input {
			inset: 0;
			margin: 0;
			opacity: 0;
			pointer-events: none;
			position: absolute;
		}

		&:has(:checked) {
			background: var(--tint);
			box-shadow: inset 0 0 0 1.5px var(--accent);
		}

		&:has(:focus-visible) {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}
	}

	.avatar {
		overflow: hidden;
		background: light-dark(oklch(0.93 0.05 var(--hue)), oklch(0.36 0.07 var(--hue)));
		block-size: 1.75rem;
		border-radius: 50%;
		color: light-dark(oklch(0.42 0.12 var(--hue)), oklch(0.88 0.06 var(--hue)));
		display: grid;
		font-size: 0.6875rem;
		font-weight: 700;
		inline-size: 1.75rem;
		place-items: center;
		position: relative;
		transition: background-color 0.2s;

		/* a photo gives way to the tick when they're picked */
		.person:has(:checked) & :global(img) {
			opacity: 0;
		}

		.person:has(:checked) & {
			background: var(--accent);
			color: transparent;
		}

		& .picked {
			color: var(--accent-ink);
			inset: 0;
			margin: auto;
			opacity: 0;
			position: absolute;
			scale: 0.4;
			stroke-width: 2.5;
			transition:
				opacity 0.15s,
				scale 0.35s var(--spring);

			.person:has(:checked) & {
				opacity: 1;
				scale: 1;
			}
		}
	}

	.sent {
		display: grid;
		gap: 0.25rem;
		justify-items: center;
		padding: 0.75rem 0.5rem 0.25rem;
		text-align: center;
	}

	.tick {
		block-size: 3rem;
		fill: none;
		inline-size: 3rem;
		margin-block-end: 0.5rem;
		stroke: var(--accent);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2.5;

		& circle,
		& path {
			animation: draw 0.5s var(--ease) both;
			stroke-dasharray: 1;
		}

		& circle {
			fill: var(--tint);
			stroke-width: 2;
		}

		& path {
			animation-delay: 0.25s;
		}
	}

	@keyframes draw {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}

	/* --- phone and tablet */

	.device {
		backdrop-filter: blur(10px);
		background: radial-gradient(ellipse at 50% 35%, rgb(32 40 64 / 0.88), rgb(6 9 20 / 0.95));
		overflow: hidden;
	}

	.stage {
		inset: 0 0 5rem;
		position: absolute;
	}

	.frame {
		background: linear-gradient(150deg, #2a2f3a, #0d1016 40%, #161a22);
		box-shadow:
			0 0 0 1.5px #3b414e,
			inset 0 0 0 1px rgb(255 255 255 / 0.07),
			0 2px 6px rgb(0 0 0 / 0.4),
			0 40px 100px -30px rgb(0 0 0 / 0.8);
		inset-block-start: 50%;
		inset-inline-start: 50%;
		position: absolute;
		translate: -50% -50%;
		transition:
			inline-size 0.6s var(--spring),
			block-size 0.6s var(--spring),
			padding 0.6s var(--spring),
			border-radius 0.6s var(--spring),
			scale 0.6s var(--spring);

		&.turning {
			transition: none;
		}

		/* the camera */
		&::before {
			background: #1b1f29;
			block-size: 6px;
			border-radius: 50%;
			box-shadow:
				inset 0 0 0 1.5px #0a0c11,
				0 0 0 1px rgb(255 255 255 / 0.05);
			content: "";
			inline-size: 6px;
			inset-block-start: calc(var(--bezel) / 2 - 3px);
			inset-inline-start: calc(50% - 3px);
			position: absolute;
		}

		&.landscape::before {
			inset-block-start: calc(50% - 3px);
			inset-inline-start: calc(var(--bezel) / 2 - 3px);
		}

		/* the side button */
		&::after {
			background: #3b414e;
			block-size: 9%;
			border-radius: 0 2px 2px 0;
			content: "";
			inline-size: 3px;
			inset-block-start: 22%;
			inset-inline-start: 100%;
			position: absolute;
		}

		&.landscape::after {
			block-size: 3px;
			border-radius: 2px 2px 0 0;
			inline-size: 9%;
			inset-block-start: -3px;
			inset-inline-start: 22%;
		}
	}

	iframe {
		background: #fff;
		block-size: 100%;
		border: 0;
		border-radius: var(--inner);
		display: block;
		inline-size: 100%;
		transition: border-radius 0.6s var(--spring);
	}

	.device-bar {
		align-items: center;
		background: var(--bg);
		border-radius: 0.875rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 16px 40px rgb(0 0 0 / 0.35);
		display: flex;
		gap: 0.25rem;
		inline-size: fit-content;
		inset-block-end: max(1rem, env(safe-area-inset-bottom));
		inset-inline: 0;
		margin-inline: auto;
		max-inline-size: calc(100% - 1rem);
		padding: 0.3125rem;
		position: absolute;

		& .icon {
			block-size: 1rem;
			inline-size: 1rem;
		}

		& .turn {
			background: none;
			padding: 0.5rem;

			& .icon {
				transition: rotate 0.5s var(--spring);
			}

			&[aria-pressed="true"] {
				color: var(--accent);

				& .icon {
					rotate: 90deg;
				}
			}
		}

		& .done {
			background: none;

			& kbd {
				background: none;
			}
		}
	}

	.segments {
		background: var(--wash);
		border-radius: 0.625rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 0.1875rem;
		position: relative;

		/* the thumb */
		&::before {
			background: var(--accent);
			border-radius: 0.5rem;
			box-shadow: 0 1px 3px color-mix(in oklab, var(--accent) 45%, transparent);
			content: "";
			inset: 0.1875rem auto 0.1875rem 0.1875rem;
			inline-size: calc(50% - 0.1875rem);
			position: absolute;
			transition: translate 0.4s var(--spring);
		}

		&.tablet::before {
			translate: 100% 0;
		}

		.device-bar & button {
			background: none;
			justify-content: center;
			padding: 0.4375rem 0.75rem;
			position: relative;

			&[aria-pressed="true"] {
				color: var(--accent-ink);
			}
		}
	}

	.size {
		color: var(--muted);
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		padding-inline: 0.375rem;
		white-space: nowrap;
	}

	/* --- small screens, touch and calm */

	@media (max-width: 40rem) {
		.scrim {
			padding: max(0.5rem, env(safe-area-inset-top)) 0.5rem 0.5rem;
		}

		.sheet {
			max-block-size: 80dvh;
		}

		.size {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.keys,
		.enter,
		.search kbd,
		.done kbd {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.device {
			--spring: ease;
		}

		.sheet,
		.glow,
		.frame,
		iframe,
		.segments::before {
			transition-duration: 0s;
		}

		.bone {
			animation: none;
		}
	}
</style>
