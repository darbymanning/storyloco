<!--
	@component
	The selected blok's fields, from its schema, in a panel beside the page, or the page's own story's
	with nothing selected. Folded to its name by default, out of the page's way; it opens on a click
	or S, and each browser remembers which. Each change saves as a draft as it's made and the page
	shows it. Mounted by the overlay; nothing for a site to add.
-->
<script lang="ts">
	import { SvelteMap } from "svelte/reactivity"
	import { tick, untrack } from "svelte"
	import type { Attachment } from "svelte/attachments"
	import {
		call,
		editor,
		last_problem,
		preview_change,
		preview_move,
		send,
		set_settings_open,
	} from "./client.js"
	import {
		blok_choices,
		is_heading,
		is_video,
		plugin_of,
		rich_supported,
		same,
		theme_choices,
	} from "./content.js"
	import { link_types_of, plugin_link } from "../link.js"
	import type { Inserts, RichDoc, RichField } from "./richtext.js"
	import type { Selection } from "./overlay.js"
	import { enter, leave, quietly, select as live_select, shared } from "./live.js"
	import { share_text, type Surface } from "./together.js"

	type Field = {
		type: string
		display_name?: string | null
		description?: string | null
		pos?: number
		field_type?: string
		required?: boolean
		max_length?: number | string | null
		keys?: Array<string> | null
		disable_time?: boolean
		filetypes?: Array<string> | null
		options?: Array<{ name: string; value: string }> | null
		source?: string | null
	}
	type Component = {
		name: string
		display_name: string | null
		preview_field?: string | null
		schema: Record<string, Field>
	}
	type Blok = Record<string, unknown> & { _uid: string; component: string }
	type Story = {
		id: number
		uuid: string
		name: string
		full_slug: string
		published_at: string | null
	}
	type Loaded = { story: Story; blok: Blok; trail: Array<{ uid: string; component: string }> }
	type Asset = {
		id?: number | string | null
		filename?: string | null
		alt?: string | null
		focus?: string | null
	}
	type Link = {
		linktype?: string
		id?: string
		url?: string
		cached_url?: string
		email?: string
		target?: string
		story?: { name?: string; full_slug?: string }
	}

	let {
		select,
		highlight,
		picker,
		inserts,
		schema,
		deleted,
		peek,
		gliding,
	}: {
		select: (selection: Selection | null) => void
		highlight: (uid: string | null) => void
		picker: (options: {
			current: Asset
			images?: boolean
			/** An R2 Assets field's, whose files are in its own bucket rather than Storyblok's library */
			r2?: { component: string; field: string }
			save: (choice: {
				asset: number | string
				alt: string
				focus: string
				filename?: string
			}) => Promise<string | null>
		}) => void
		/** What a richtext field can have put into it */
		inserts: (field: Field) => Promise<Inserts>
		schema: () => Promise<Map<string, Component>>
		/** Says a blok was deleted, with Undo */
		deleted: (name: string, story: number, undo: unknown, after?: () => void) => void
		/** The blok as the page already has it, to show before the server's copy arrives */
		peek: (
			selection: Selection
		) =>
			| { blok: Record<string, unknown>; trail: Loaded["trail"]; components: Map<string, unknown> }
			| undefined
		/** Notes where the page's blocks are; called once a change shows, they glide to where it left them */
		gliding: () => () => void
	} = $props()

	let selection = $state.raw<Selection | null>(null)
	let loaded = $state.raw<Loaded | null>(null)
	let components = $state<Map<string, Component>>(new Map())
	let problem = $state<string | null>(null)
	let tab = $state("")

	/** What each field holds as it's edited here, ahead of the page */
	let values = $state<Record<string, unknown>>({})
	/** Fields with a save on its way, and why the last one failed */
	let saving = $state<Record<string, boolean>>({})
	let failed = $state<Record<string, string>>({})
	/** Asset fields whose alt text AI is writing */
	let describing = $state<Record<string, boolean>>({})
	/** The field being typed in, which a reload mustn't overwrite */
	let focused: string | null = null

	/** Whether a blok is showing, for the overlay */
	export const showing = () => selection !== null

	// --- folded to its name in the edit bar, or open as the bar's panel

	const folded = $derived(!editor.settings_open)

	let panel_el = $state<HTMLElement>()
	let fold_el = $state<HTMLElement>()

	/**
	 * Folding or opening morphs the edit bar from one shape into the other: its box before the
	 * change grows or shrinks into the one after. Shrinking, it's placed by its corner for the
	 * animation, since open on a phone it's pinned to both sides.
	 */
	let morphing: Animation | undefined
	const shape = (el: HTMLElement) => {
		const rect = el.getBoundingClientRect()
		return {
			rect,
			radius: Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius), rect.height / 2),
		}
	}
	const frame = ({ rect, radius }: ReturnType<typeof shape>) => ({
		boxSizing: "border-box",
		inset: "auto",
		top: `${rect.top}px`,
		left: `${rect.left}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
		maxWidth: "none",
		maxHeight: "none",
		borderRadius: `${radius}px`,
	})
	async function morph(change: () => void) {
		const bar = panel_el?.closest<HTMLElement>("[data-storyloco=bar]")
		// mid-morph, it measures where it's got to, so a second toggle turns back from there
		const from = bar && shape(bar)
		const badge = bar?.querySelector<HTMLElement>(".badge")
		const was = badge?.getBoundingClientRect()
		change()
		await tick()
		if (!bar || !from || matchMedia("(prefers-reduced-motion: reduce)").matches) return
		morphing?.cancel()
		const to = shape(bar)
		const [a, b] = [from.rect, to.rect]
		const top = bar.dataset.corner?.startsWith("t")
		// growing, it's laid out whole at once and uncovered from the old shape, so nothing inside
		// reflows or wraps on the way; shrinking to the pill, whose name fits any size it passes.
		// By height alone: a long name's pill can be wider than the panel it opens into
		const grows = b.height >= a.height
		const pad = parseFloat(getComputedStyle(bar).paddingBlockStart)
		const keyframes = grows
			? // clipped, the bar's what its glass layer sees behind it, and that's nothing: the bar blurs
				// the page itself on the way, or it'd open clear and frost over at the end
				[
					{
						clipPath: `inset(${a.top - b.top}px ${b.right - a.right}px ${b.bottom - a.bottom}px ${a.left - b.left}px round ${from.radius}px)`,
					},
					{ clipPath: `inset(0 round ${to.radius}px)`, offset: 0.8 },
					// then on past its edges, uncovering its shadow too rather than it landing at the end
					{ clipPath: `inset(-80px round ${to.radius + 80}px)` },
				].map((f) => ({ ...f, backdropFilter: "blur(20px) saturate(1.8)" }))
			: // the pill's row waits in its corner, not the middle of the box closing on it: the height
				// still to go is padding on the far side, so the row is on one line, as it ends up, throughout
				[from, to].map((f) => ({
					...frame(f),
					[top ? "paddingBottom" : "paddingTop"]: `${f.rect.height - b.height + pad}px`,
				}))
		// ponytail: turned back mid-grow, it starts from the whole box, not the uncovered part
		const timing = { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
		morphing = bar.animate(keyframes, timing)
		// what the new shape adds arrives after it: opening, the bar's buttons one after another,
		// and folding, the name once the pill has nearly closed, each rising from the edge it's on
		const arriving = grows
			? [...bar.querySelectorAll<HTMLElement>(".panel .inner > *")]
			: [title_el, fold_el].filter((el) => !!el)
		arriving.forEach((el, i) =>
			el.animate(
				[
					{ opacity: 0, translate: `0 ${top ? -6 : 6}px` },
					{ opacity: 1, translate: "0 0" },
				],
				{ duration: 240, delay: grows ? 120 + i * 35 : 160, easing: "ease-out", fill: "backwards" }
			)
		)
		// the face glides to where it sits in the new shape, rather than stepping there
		const now = badge?.getBoundingClientRect()
		if (badge && was && now && (was.left !== now.left || was.top !== now.top))
			badge.animate(
				[{ translate: `${was.left - now.left}px ${was.top - now.top}px` }, { translate: "0 0" }],
				timing
			)
	}

	/** Open or fold it; from the keyboard, focus goes with it */
	export async function toggle(keyboard = false) {
		const inside = panel_el?.contains(document.activeElement)
		await morph(() => {
			set_settings_open(!editor.settings_open)
			if (!editor.settings_open) flush()
			else if (selection) load(selection, false)
		})
		if (!folded && keyboard) title_el?.focus()
		else if (inside && !panel_el?.contains(document.activeElement)) fold_el?.focus()
	}

	/** The page's own story, which the panel shows with nothing selected, so it's never empty */
	const page = $derived(
		editor.story?.uid ? { story: editor.story.id, uid: editor.story.uid } : null
	)
	const is_page = $derived(selection?.uid === page?.uid && selection?.story === page?.story)
	/** Whether the overlay has something selected, rather than the panel falling back on the page */
	let picked = $state(false)

	$effect(() => {
		const at = page
		if (picked || !editor.editing) return
		if (at) return untrack(() => show(at))
		// the page lets go of its story for a moment each time it reads its data again, as after a
		// save: only one that stays gone empties the panel, or its fields would blink out and back
		const gone = setTimeout(clear, 400)
		return () => clearTimeout(gone)
	})

	/** The field typed in on the page, which the settings mark so it's clear what's changing */
	let on_page = $state<{ uid: string; field: string } | null>(null)
	// ponytail: it stays open over text typed in on the page; scroll that clear of it if a sheet on a phone hides it
	export function typing(at: { uid: string; field: string } | null) {
		on_page = at
		// its field may be under another tab than the one showing: that one, so it's there to see
		if (!at || at.uid !== selection?.uid) return
		const group = groups.find((g) => g.fields.some(([key]) => key === at.field))
		if (group && group.name !== tab) tab = group.name
	}
	/** The field being changed here, which the page marks where it shows it */
	const on_panel = (at: { uid: string; field: string; part?: string } | null) =>
		dispatchEvent(new CustomEvent("storyloco:panel-field", { detail: at }))
	/** Which piece of the field an input changes, where the page shows it a piece at a time */
	const part_of = (target: EventTarget | null) =>
		(target as HTMLElement | null)?.closest<HTMLElement>("[data-part]")?.dataset.part
	const typed_here = (key: string) => on_page?.uid === selection?.uid && on_page?.field === key

	const label = (name: string) => {
		const words = name.replace(/[_-]+/g, " ").trim()
		return words.charAt(0).toUpperCase() + words.slice(1)
	}
	const component_label = (name: string) => components.get(name)?.display_name || label(name)
	/** What a block in a list shows of itself beside its kind, as Storyblok's own list does */
	const preview_of = (blok: Record<string, unknown> & { component: string }) => {
		const field = components.get(blok.component)?.preview_field
		const value = field ? blok[field] : undefined
		return typeof value === "string" ? value.trim() : ""
	}
	const field_label = (key: string, field: Field) => field.display_name || label(key)

	const component = $derived(loaded ? components.get(loaded.blok.component) : undefined)

	/** Fields in the schema's order, grouped by its tabs; those outside any tab come first */
	const groups = $derived.by(() => {
		if (!component) return []
		const entries = Object.entries(component.schema).sort(
			([, a], [, b]) => (a.pos ?? 0) - (b.pos ?? 0)
		)
		const tabs = entries.filter(([, f]) => f.type === "tab")
		const in_tab = new Set(tabs.flatMap(([, f]) => f.keys ?? []))
		const shown = (key: string, f: Field) =>
			f.type !== "tab" && f.type !== "section" && !key.startsWith("tab-")
		const general = entries.filter(([key, f]) => shown(key, f) && !in_tab.has(key))
		const out: Array<{ name: string; fields: Array<[string, Field]> }> = []
		if (general.length) out.push({ name: "Content", fields: general })
		for (const [, f] of tabs) {
			const fields = (f.keys ?? [])
				.map((key) => [key, component.schema[key]] as [string, Field])
				.filter(([key, field]) => field && shown(key, field))
			if (!fields.length) continue
			// a tab named like another, say "Content", is the same group rather than a second
			const name = f.display_name || "More"
			const same = out.find((group) => group.name === name)
			if (same) same.fields.push(...fields)
			else out.push({ name, fields })
		}
		return out
	})

	const current = $derived(groups.find((g) => g.name === tab) ?? groups[0])

	/** A blok from another story, like a shared section or a card's article, saves to that story */
	const elsewhere = $derived(
		loaded?.story.name && editor.story && loaded.story.id !== editor.story.id ? loaded.story : null
	)

	async function load(next: Selection, fresh = true) {
		problem = null
		try {
			const [map, result] = await Promise.all([
				schema(),
				call<Loaded>({ op: "blok", story: next.story, uid: next.uid }),
			])
			if (selection !== next) return
			components = map
			const keep = untrack(() => (fresh ? null : focused))
			const kept = keep ? values[keep] : undefined
			values = { ...result.blok }
			for (const [key, resync] of resyncs) resync(result.blok[key])
			if (keep) values[keep] = kept
			loaded = result
			if (fresh) {
				tab = groups[0]?.name ?? ""
				saving = {}
				failed = {}
			}
		} catch (e) {
			if (selection === next) problem = (e as Error).message
		}
	}

	let title_el = $state<HTMLElement>()

	/**
	 * Show the selected blok; from the keyboard, focus moves to the panel's heading so its fields are
	 * next, or to its name when it's folded
	 */
	export function open(next: Selection, keyboard = false) {
		picked = true
		show(next, keyboard)
	}

	/**
	 * Which way the fields change places: 1 going into a block, so its fields come in from the far
	 * side as the last ones leave by the near one, like the next card along; -1 back out to a block
	 * it's in, or the page, the other way; 0 for another of the same block's tabs, which is nowhere
	 * else to go
	 */
	let way = $state(0)
	let way_done: ReturnType<typeof setTimeout> | undefined
	const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
	function pass(_: Element, { leaving = false }: { leaving?: boolean } = {}) {
		const by = way
		return {
			duration: calm ? 0 : leaving ? 180 : 320,
			easing: (t: number) => 1 - (1 - t) ** 3,
			css: (t: number, u: number) =>
				`opacity:${t};translate:${by ? `${(leaving ? -by : by) * u * 2.5}rem 0` : `0 ${u * 0.25}rem`}`,
		}
	}

	function show(next: Selection, keyboard = false) {
		if (keyboard) tick().then(() => (folded ? fold_el : title_el)?.focus())
		if (selection?.story === next.story && selection.uid === next.uid) return
		// one of the blocks this one's in, the page, or back where a picked story was gone into from:
		// back out; anything else is further in
		const returning =
			came_from?.story === next.story && came_from.steps.some((step) => step.uid === next.uid)
		way = returning || loaded?.trail.slice(0, -1).some((step) => step.uid === next.uid) ? -1 : 1
		// out of the story it led into, it's no longer the way anywhere
		if (came_from && next.story !== came_from.into) came_from = null
		clearTimeout(way_done)
		way_done = setTimeout(() => (way = 0), 600)
		flush()
		selection = next
		saving = {}
		failed = {}
		// the page's own copy first, so the fields are there at once; Storyblok's follows quietly, once
		// they're open to see
		const quick = peek(next)
		if (quick) {
			components = quick.components as Map<string, Component>
			values = { ...quick.blok }
			const story = { id: next.story, uuid: "", name: "", full_slug: "", published_at: null }
			loaded = { story, blok: quick.blok as Blok, trail: quick.trail }
			tab = groups[0]?.name ?? ""
			if (editor.settings_open) load(next, false)
		} else {
			loaded = null
			load(next)
		}
	}

	/**
	 * A block was moved among its siblings, from the page's toolbar or from here, a step with `by`
	 * or to a place with `to`: a list of blocks showing here that holds it shows it there at once,
	 * as the page does, rather than once the save has landed
	 */
	export function moved(uid: string, by?: number, to?: number) {
		for (const [key, value] of Object.entries(values)) {
			const list = kids(value)
			const index = list.findIndex((kid) => kid?._uid === uid)
			if (index < 0) continue
			const next = by !== undefined ? index + by : Number(to)
			if (!(next >= 0 && next < list.length) || next === index) return
			const reordered = [...list]
			reordered.splice(next, 0, ...reordered.splice(index, 1))
			values[key] = reordered
			return
		}
	}

	/** The page saved something; the blok may have changed under the panel */
	export function refresh() {
		// folded, it catches up when it's opened
		if (!selection || !editor.settings_open) return
		// mid-save, the reply has the field's own value; anything else changed waits until it lands
		if (Object.values(saving).some(Boolean)) stale = true
		else load(selection, false)
	}

	/** A refresh skipped while a field was saving, made once none are */
	let stale = false
	function caught_up() {
		if (!stale || !selection || Object.values(saving).some(Boolean)) return
		stale = false
		load(selection, false)
	}

	/** Nothing selected: the page's own story, or nothing on a page without one */
	export function close() {
		picked = false
		if (page && editor.editing) show(page)
		else clear()
	}

	function clear() {
		flush()
		selection = null
		loaded = null
	}

	// --- saving

	const timers = new Map<string, ReturnType<typeof setTimeout>>()

	/**
	 * Shared richtext editors, to catch up with a value saved some other way (an undo, or an edit in
	 * Storyblok), which their room's document wouldn't otherwise hear about
	 */
	const resyncs = new Map<string, (value: unknown) => void>()

	/** Fields being typed in together, which their room saves rather than the panel */
	const together = new Set<string>()

	/**
	 * What a field's given here, on the page at once, where the page can show it and the value's
	 * one it shows as it's kept: text, numbers, switches, pictures. Not what the page looks up
	 * before showing, like a link's page or a picked story, which it has to be saved to find
	 */
	const SHOWN_AHEAD = new Set([
		"text",
		"textarea",
		"markdown",
		"number",
		"boolean",
		"richtext",
		"asset",
		"multiasset",
		"custom",
	])
	let ahead: (() => void) | undefined
	/** What's been typed since the page last drew, shown together at its next frame: a fast typist's keys are one redraw, not one each */
	let waiting: { story: number; uid: string; values: Record<string, unknown> } | undefined
	let ahead_too_long: ReturnType<typeof setTimeout> | undefined
	function show_ahead(key: string, value: unknown) {
		if (!selection || !SHOWN_AHEAD.has(component?.schema[key]?.type ?? "")) return
		const { story, uid } = selection
		if (waiting && waiting.uid === uid) return void (waiting.values[key] = $state.snapshot(value))
		waiting = { story, uid, values: { [key]: $state.snapshot(value) } }
		requestAnimationFrame(() => {
			const change = waiting
			waiting = undefined
			if (!change) return
			ahead = preview_change({ op: "fields", ...change }) ?? ahead
			// its save may be someone else's to make, typed in together, or land once another block's
			// showing: left a while with nothing more typed, the page goes back to what's saved anyway
			clearTimeout(ahead_too_long)
			ahead_too_long = setTimeout(show_saved, 8000)
		})
	}
	function show_saved() {
		clearTimeout(ahead_too_long)
		ahead?.()
		ahead = undefined
	}
	/** Every save has landed, or failed: the page shows what's saved again, which is the same or the truth */
	function shown_saved() {
		if (timers.size || waiting || Object.values(saving).some(Boolean)) return
		show_saved()
	}

	/** Save a field now, or after a pause in typing */
	function change(key: string, value: unknown, wait = 0) {
		values[key] = value
		show_ahead(key, value)
		if (together.has(key)) return
		clearTimeout(timers.get(key))
		if (wait)
			timers.set(
				key,
				setTimeout(() => save(key), wait)
			)
		else save(key)
	}

	/** Alt text for an asset field's image, from AI, as the picker suggests it */
	async function describe(key: string, value: Asset) {
		describing[key] = true
		delete failed[key]
		try {
			const { alt } = await call<{ alt: string }>({ op: "ai", do: "alt", url: value.filename })
			change(key, { ...value, alt })
		} catch (e) {
			failed[key] = (e as Error).message
		} finally {
			describing[key] = false
		}
	}

	function flush() {
		for (const [key, timer] of timers) {
			clearTimeout(timer)
			save(key)
		}
	}

	async function save(key: string) {
		timers.delete(key)
		if (!selection || !loaded) return
		const { story, uid } = selection
		saving[key] = true
		delete failed[key]
		const reply = await send({
			op: "fields",
			story,
			uid,
			values: { [key]: $state.snapshot(values[key]) },
		})
		saving[key] = false
		shown_saved()
		if (!reply) failed[key] = last_problem() ?? "Couldn’t save"
		else if (selection?.uid === uid && focused !== key) {
			const saved = (reply as { blok?: Blok }).blok
			if (saved) values[key] = saved[key]
		}
		caught_up()
	}

	// --- tables

	type Cell = { _uid: string; value: string; component: string }
	type Table = {
		fieldtype: "table"
		thead: Array<Cell>
		tbody: Array<{ _uid: string; component: string; body: Array<Cell> }>
	}

	const cell = (component: string): Cell => ({ _uid: crypto.randomUUID(), value: "", component })
	const row = (columns: number) => ({
		_uid: crypto.randomUUID(),
		component: "_table_row",
		body: Array.from({ length: columns }, () => cell("_table_col")),
	})

	function table_of(value: unknown): Table {
		const t = value as Partial<Table> | null
		return t && Array.isArray(t.thead) && Array.isArray(t.tbody)
			? (t as Table)
			: { fieldtype: "table", thead: [], tbody: [] }
	}

	/** Change a copy of the table and save it; typing waits for a pause like any other field */
	function edit_table(key: string, edit: (table: Table) => void, wait = 0) {
		const next = table_of($state.snapshot(values[key]))
		edit(next)
		change(key, next, wait)
	}

	function add_column(table: Table) {
		table.thead.push(cell("_table_head"))
		for (const r of table.tbody) r.body.push(cell("_table_col"))
	}

	// --- choices for option fields, fetched once each

	const choices = new Map<string, Promise<Array<{ name: string; value: string }>>>()
	function choices_for(key: string) {
		const name = loaded!.blok.component
		const id = `${name}.${key}`
		let found = choices.get(id)
		if (!found) {
			found = call<{ choices: Array<{ name: string; value: string }> }>({
				op: "choices",
				component: name,
				field: key,
			})
				.then((r) => r.choices)
				.catch(() => [])
			choices.set(id, found)
		}
		return found
	}

	// --- child bloks

	/** Choose a block to add to a list: at its end, or straight after the one with `after` for its `_uid` */
	async function add_child(key: string, after?: string) {
		if (!selection) return
		const list = await call<{
			full: boolean
			components: Array<{ name: string; display_name: string }>
		}>({
			op: "blocks",
			story: selection.story,
			uid: selection.uid,
			field: key,
		}).catch((e) => ((failed[key] = (e as Error).message), null))
		if (!list) return
		if (list.full) {
			failed[key] = "This list is full"
			return
		}
		adding = { key, after, components: list.components, filter: "" }
		await tick()
		document.querySelector<HTMLInputElement>("[data-storyloco=inspector] .adding input")?.focus()
	}

	let adding = $state<{
		key: string
		/** the block it goes after, when it's put between two rather than at the end */
		after?: string
		components: Array<{ name: string; display_name: string }>
		filter: string
	} | null>(null)

	async function insert(key: string, name: string) {
		if (!selection) return
		const after = adding?.after
		adding = null
		saving[key] = true
		const adding_it = {
			op: "insert",
			story: selection.story,
			// after a block, as the page's own toolbar adds one, or at the end of the field's list
			...(after ? { uid: after } : { uid: selection.uid, field: key }),
			component: name,
		}
		// on the page at once, where the page can show it, and saved behind
		const shown = preview_change(adding_it)
		const reply = (await send(adding_it)) as {
			uid?: string
		} | null
		shown?.()
		saving[key] = false
		if (!reply) failed[key] = last_problem() ?? "Couldn’t add it"
		else if (reply.uid) select({ story: selection.story, uid: reply.uid })
	}

	let acting = $state(false)

	/** Move, copy or delete the selected blok itself, then follow it, its copy, or its parent */
	async function act(op: "move" | "remove" | "duplicate", by?: number) {
		if (!selection || !loaded) return
		const { story, uid } = selection
		const parent = loaded.trail.at(-2)?.uid
		const name = loaded.blok.component
		acting = true
		// a move shows on the page at once, where the page can show it, and saves behind
		const glide = op === "move" ? gliding() : undefined
		const shown = preview_change({ op, story, uid, by })
		if (shown) glide?.()
		const reply = (await send({ op, story, uid, by })) as { uid?: string; undo?: unknown } | null
		shown?.()
		acting = false
		if (!reply) return (problem = last_problem() ?? "Couldn’t change it")
		if (op === "duplicate" && reply.uid) select({ story, uid: reply.uid })
		if (op === "remove") {
			if (parent) select({ story, uid: parent })
			deleted(name, story, reply.undo)
		}
	}

	async function child(
		key: string,
		op: "move" | "remove" | "duplicate",
		uid: string,
		by?: number,
		to?: number
	) {
		if (!selection) return
		saving[key] = true
		const { story } = selection
		const kid_name = kids(values[key]).find((kid) => kid._uid === uid)?.component ?? ""
		// a move shows on the page at once, as it does in the list here, and saves behind
		const glide = op === "move" ? gliding() : undefined
		const shown = preview_change({ op, story, uid, by, to })
		if (op === "move") moved(uid, by, to)
		if (shown) glide?.()
		const reply = (await send({ op, story, uid, by, to })) as { undo?: unknown } | null
		shown?.()
		saving[key] = false
		if (!reply) failed[key] = last_problem() ?? "Couldn’t change it"
		else {
			load(selection, false)
			if (op === "remove")
				deleted(kid_name, story, reply.undo, () => selection && load(selection, false))
		}
	}

	// --- dragging a nested block to another place in its list

	/** The row being dragged, where it would land, and how far the pointer's moved */
	let dragging = $state<{ key: string; from: number; to: number; dy: number; step: number } | null>(
		null
	)

	/** The page showing a dragged block where it would land: the way to have it show what's saved again */
	let landing: (() => void) | undefined

	/** Show the page with a dragged block at this place among its siblings, the others gliding out of its way */
	function land(uid: string, to: number) {
		if (!selection) return
		const glide = gliding()
		const shown = preview_move(selection.story, uid, undefined, to)
		if (!shown) return
		landing = shown
		glide()
	}

	function drag(
		event: PointerEvent,
		key: string,
		from: number,
		moved: (to: number) => unknown,
		/** called as the row passes each place, for whatever follows it live, like the page */
		passing?: (to: number) => void
	) {
		if (event.button !== 0) return
		event.preventDefault()
		const handle = event.currentTarget as HTMLElement
		const rows = [...(handle.closest("ol")?.children ?? [])] as Array<HTMLElement>
		if (rows.length < 2) return
		handle.setPointerCapture(event.pointerId)
		// one row's height and the gap after it, the distance the others step aside by
		const step = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
		const start = event.clientY
		dragging = { key, from, to: from, dy: 0, step }
		const move = (e: PointerEvent) => {
			const dy = e.clientY - start
			const to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)))
			if (to !== dragging?.to) passing?.(to)
			dragging = { key, from, to, dy, step }
		}
		const up = () => done(true)
		const cancel = () => done(false)
		const done = async (keep: boolean) => {
			handle.removeEventListener("pointermove", move)
			handle.removeEventListener("pointerup", up)
			handle.removeEventListener("pointercancel", cancel)
			const ended = dragging
			dragging = null
			if (keep && ended && ended.to !== from) await moved(ended.to)
			// let go where it started, or not let go at all: the page goes back with it
			else if (landing) passing?.(from)
			// what the page was shown while dragging gives way to what's saved
			landing?.()
			landing = undefined
		}
		handle.addEventListener("pointermove", move)
		handle.addEventListener("pointerup", up)
		handle.addEventListener("pointercancel", cancel)
	}

	async function move_kid(key: string, from: number, to: number) {
		const was = values[key]
		const list = [...kids(was)]
		const [kid] = list.splice(from, 1)
		list.splice(to, 0, kid)
		// in its new place at once; the save, and its Undo, follow
		values[key] = list
		delete failed[key]
		await child(key, "move", kid._uid, undefined, to)
		if (failed[key]) values[key] = was
	}

	/** Where a row shows while another is dragged: the dragged one under the pointer, the rest out of its way */
	function shift(key: string, i: number) {
		if (!dragging || dragging.key !== key) return undefined
		const { from, to, dy, step } = dragging
		if (i === from) return `0 ${dy}px`
		if (from < to && i > from && i <= to) return `0 ${-step}px`
		if (from > to && i >= to && i < from) return `0 ${step}px`
		return "0 0"
	}

	// --- links

	let finding = $state<{ key: string; search: string; results: Array<Story> } | null>(null)
	let searching: ReturnType<typeof setTimeout> | undefined
	function find_stories(key: string, search: string) {
		finding = { key, search, results: finding?.key === key ? finding.results : [] }
		clearTimeout(searching)
		searching = setTimeout(async () => {
			const { stories } = await call<{ stories: Array<Story> }>({ op: "stories", search }).catch(
				() => ({ stories: [] })
			)
			if (finding?.key === key && finding.search === search) finding.results = stories
		}, 200)
	}

	// --- stories an option field picks, in the order it keeps them

	/** Names for the stories fields hold, fetched as they're first shown */
	const named = new SvelteMap<string, Story>()
	const asked = new Set<string>()
	function names_for(uuids: Array<string>) {
		const missing = uuids.filter((u) => !asked.has(u))
		if (missing.length) {
			missing.forEach((u) => asked.add(u))
			call<{ stories: Array<Story> }>({ op: "stories", uuids: missing })
				.then(({ stories }) => stories.forEach((story) => named.set(story.uuid, story)))
				.catch(() => missing.forEach((u) => asked.delete(u)))
		}
		return named
	}

	/**
	 * Go into a story a field picks, to edit it: its own fields, as for a block of the page's. It's
	 * the one story wherever it's picked, so what's changed there changes everywhere it shows
	 */
	let opening = $state<string | null>(null)
	async function open_story(story: Story, key: string) {
		opening = story.uuid
		delete failed[key]
		const found = await call<{ content: Blok }>({ op: "content", story: story.id }).catch(
			() => null
		)
		opening = null
		if (!found?.content._uid) return void (failed[key] = `Couldn’t open ${story.name}`)
		// the way back: the blocks down to the one that picked it, as they are in the story it was picked in
		came_from =
			selection && loaded
				? { story: selection.story, into: story.id, steps: loaded.trail, name: story_name(loaded) }
				: null
		select({ story: story.id, uid: found.content._uid })
	}

	/**
	 * Where a story a field picks was gone into from, for as long as the panel's in that story: its
	 * own blocks' trail starts at its own root, which says nothing of how it was got to
	 */
	let came_from = $state.raw<{
		story: number
		into: number
		steps: Array<{ uid: string; component: string }>
		/** the name of the story it was picked in, for the first of its steps */
		name?: string
	} | null>(null)

	/** The name of the story a blok's in, when it's known: the page's own, or as the server gave it */
	const story_name = (of: Loaded) =>
		(of.story.id === editor.story?.id ? editor.story.name : of.story.name) || undefined
	/**
	 * What a step of the trail is called: the first is its story, by its name, as "Page" is only
	 * the kind of thing every page is; the rest are blocks, by theirs
	 */
	const crumb = (step: { component: string }, i: number, name?: string) =>
		(i === 0 && name) || component_label(step.component)
	const back = $derived(came_from && selection?.story === came_from.into ? came_from : null)

	/** Every step above the block, outermost first, each with the story it's in */
	const parents = $derived(
		loaded && selection
			? [
					...(back?.steps ?? []).map((step, i) => ({
						story: back!.story,
						uid: step.uid,
						name: crumb(step, i, back!.name),
					})),
					...loaded.trail.slice(0, -1).map((step, i) => ({
						story: selection!.story,
						uid: step.uid,
						name: crumb(step, i, story_name(loaded!)),
					})),
				]
			: []
	)
	/** How many steps the line has room to spell out: any more and they fold into one list */
	const SPELT = 2

	/** Every step of the header's line, the block itself last */
	const line = $derived([...(back?.steps ?? []), ...(loaded?.trail ?? [])].map((step) => step.uid))
	let line_was: string[] = []
	let fresh_was: string[] = []
	/**
	 * The steps that weren't in the line before it changed, in order: only these come in, one after
	 * the other, so "Home" stays put as "› Hero" arrives beside it
	 */
	const fresh = $derived.by(() => {
		// a block that's still loading has no line yet, and one that's read again has the line it had
		if (!loaded || line.join() === line_was.join()) return fresh_was
		const was = line_was
		line_was = line
		return (fresh_was = line.filter((uid) => !was.includes(uid)))
	})
	/** A step's turn to come in, or nothing when it was there already. Its arrow goes just before it */
	const turn = (uid: string | undefined, arrow = false) => {
		const at = uid ? fresh.indexOf(uid) : -1
		return at < 0 ? undefined : at * 2 + (arrow ? 0 : 1)
	}
	/** The step after one, which the arrow after it leads to */
	const next = (uid: string) => line[line.indexOf(uid) + 1]

	let picking = $state<{
		key: string
		search: string
		results: Array<Story>
		page: number
		more: boolean
	} | null>(null)
	let picking_wait: ReturnType<typeof setTimeout> | undefined
	function pick_stories(key: string, search: string, page = 1) {
		const kept = picking?.key === key && page > 1 ? picking.results : []
		picking = { key, search, results: kept, page, more: false }
		clearTimeout(picking_wait)
		picking_wait = setTimeout(
			async () => {
				const { stories, more } = await call<{ stories: Array<Story>; more: boolean }>({
					op: "stories",
					component: loaded!.blok.component,
					field: key,
					search,
					page,
				}).catch(() => ({ stories: [], more: false }))
				if (picking?.key !== key || picking.search !== search || picking.page !== page) return
				stories.forEach((story) => named.set(story.uuid, story))
				picking.results = [...kept, ...stories]
				picking.more = more
			},
			page > 1 ? 0 : 200
		)
	}

	const uuids = (v: unknown) => (Array.isArray(v) ? (v as Array<string>) : [])
	function reorder<T>(list: Array<T>, from: number, to: number) {
		const next = [...list]
		next.splice(to, 0, ...next.splice(from, 1))
		return next
	}

	// --- helpers for values

	const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

	// --- storyloco's own plugins, edited as their plugins edit them in Storyblok

	type Value = Record<string, unknown>
	const object_of = (v: unknown): Value =>
		v && typeof v === "object" && !Array.isArray(v) ? (v as Value) : {}
	const list_of = <T>(v: unknown) => (Array.isArray(v) ? (v as Array<T>) : [])

	/** A blok select's choices, from its story's content, fetched once a story */
	const blok_lists = new SvelteMap<number, ReturnType<typeof blok_choices>>()
	function bloks_of(story: number) {
		if (!blok_lists.has(story)) {
			blok_lists.set(story, [])
			call<{ content: unknown }>({ op: "content", story })
				.then(({ content }) => blok_lists.set(story, blok_choices(content)))
				.catch(() => blok_lists.delete(story))
		}
		return blok_lists.get(story)!
	}

	const zones =
		typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []
	const here = Intl.DateTimeFormat().resolvedOptions().timeZone

	/** A currency field's codes: its options', else the plugin's own, with the stored one kept */
	function codes_of(field: Field, current: string) {
		const listed = text(field.options?.find((o) => o.name === "currencies")?.value)
			.split(",")
			.map((code) => code.trim().toUpperCase())
			.filter(Boolean)
		const codes = listed.length ? listed : ["GBP", "USD", "EUR"]
		return codes.includes(current) ? codes : [...codes, current]
	}

	type Room = { id: string; name: string; area_m: string; area_ft: string }
	type Floor = {
		id: string
		name: string
		plan?: Asset
		dimensions: Array<{ id: string; name: string; rooms: Array<Room> }>
	}
	type PlanType = { id: string; name?: string; floors: Array<Floor> }
	/** Which house type each plans field is showing */
	let plan_type = $state<Record<string, number>>({})
	/** A plans field's types, changed by `edit` on a copy and saved */
	function plans_edit(key: string, edit: (types: Array<PlanType>) => void, wait = 0) {
		const next = structuredClone($state.snapshot(object_of(values[key]))) as Value
		const types = list_of<PlanType>(next.types)
		edit(types)
		change(key, { ...next, types }, wait)
	}
	const fresh_room = (): Room => ({ id: crypto.randomUUID(), name: "", area_m: "", area_ft: "" })
	const heading = (v: unknown) =>
		v && typeof v === "object" ? (v as { text?: string; level?: number | null }) : {}
	const asset = (v: unknown) => (v && typeof v === "object" ? (v as Asset) : {})
	const link = (v: unknown) => (v && typeof v === "object" ? (v as Link) : {})
	const kids = (v: unknown) => (Array.isArray(v) ? (v as Array<Blok>) : [])
	const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)$/i
	const thumb = (filename: string, width = 160) =>
		/\.(jpe?g|png|gif|webp|avif)$/i.test(filename) ? `${filename}/m/${width}x0` : filename
	const file_name = (filename?: string | null) => filename?.split("/").pop() ?? ""
	const only_images = (field: Field) =>
		!field.filetypes?.length || field.filetypes.every((t) => t === "images")
	const option = (field: Field, name: string) =>
		field.options?.find((found) => found.name === name)?.value
	/** An R2 Assets field: its files, edited as an image field's, are in its own bucket */
	const is_r2 = (field: Field) => plugin_of(field) === "r2" && option(field, "link") !== "true"
	const r2_of = (key: string, field: Field) =>
		is_r2(field) && loaded ? { component: loaded.blok.component, field: key } : undefined
	/** `YYYY-MM-DD HH:mm`, as Storyblok keeps dates, to and from what the input takes */
	const to_input = (v: unknown, date_only?: boolean) => {
		const s = text(v)
		return date_only ? s.slice(0, 10) : s.replace(" ", "T").slice(0, 16)
	}
	const from_input = (v: string) => v.replace("T", " ")

	function richtext_preview(v: unknown): string {
		const out: Array<string> = []
		const walk = (n: unknown) => {
			if (!n || typeof n !== "object") return
			const node = n as { text?: string; content?: Array<unknown> }
			if (typeof node.text === "string") out.push(node.text)
			node.content?.forEach(walk)
		}
		walk(v)
		return out.join(" ").slice(0, 220)
	}

	/** Save a field typed in together, when this browser is the one saving it */
	async function save_shared(target: Selection, key: string, value: unknown, shared: boolean) {
		const showing = () => selection?.uid === target.uid
		if (showing()) {
			saving[key] = true
			delete failed[key]
		}
		const change = { op: "fields", story: target.story, uid: target.uid, values: { [key]: value } }
		const reply = await send(change, shared ? "shared" : "change")
		if (showing()) saving[key] = false
		shown_saved()
		if (showing()) {
			if (!reply) failed[key] = last_problem() ?? "Couldn’t save"
			caught_up()
		}
		return Boolean(reply)
	}

	/** A text input typed in together with anyone else in the same field, while it has focus */
	function share(key: string): Attachment<HTMLInputElement | HTMLTextAreaElement> {
		return (input) => {
			const target = untrack(() => selection)
			let sharing: ReturnType<typeof share_text> | null = null
			const typing = () => document.activeElement === input
			const surface: Surface = {
				typing,
				show(value, at) {
					input.value = value
					if (at !== null && typing()) input.setSelectionRange(at, at)
					values[key] = value
				},
				at: () => (typing() ? input.selectionStart : null),
				// the others' carets go on the page's own copy of the text; an input can't show them
				spot: () => null,
			}
			const focus = () => {
				if (!target || sharing) return
				// the others watch a field someone says they're typing in, on the page as well as here
				live_select({ uid: target.uid, field: key })
				together.add(key)
				sharing = share_text(`${target.story}:${target.uid}:${key}`, surface, {
					initial: input.value,
					save: (value, shared) => save_shared(target, key, value, shared),
					fresh: () =>
						call<Loaded>({ op: "blok", story: target.story, uid: target.uid }).then((found) => {
							const value = found.blok[key]
							return typeof value === "string" ? value : null
						}),
				})
			}
			const typed = () => {
				sharing?.typed(input.value)
				show_ahead(key, input.value)
			}
			const moved = () => sharing?.moved()
			const blur = async () => {
				const was = sharing
				if (was && target) live_select({ uid: target.uid })
				sharing = null
				together.delete(key)
				await was?.stop()
			}
			input.addEventListener("focus", focus)
			input.addEventListener("input", typed)
			input.addEventListener("keyup", moved)
			input.addEventListener("pointerup", moved)
			input.addEventListener("blur", blur)
			return () => {
				input.removeEventListener("focus", focus)
				input.removeEventListener("input", typed)
				input.removeEventListener("keyup", moved)
				input.removeEventListener("pointerup", moved)
				input.removeEventListener("blur", blur)
				blur()
			}
		}
	}

	/**
	 * A richtext editor for the field, its format bar above it, typed in together with anyone else
	 * with it open, on the page or in their settings; its room saves it after a pause
	 */
	function rich(key: string, field: Field): Attachment<HTMLElement> {
		// the same one while the field is the same, so the schema loading again after a save, as a
		// new but equal object, doesn't start the editor over, empty until its room is ready
		const known = `${key}:${JSON.stringify(field)}`
		let attach = riches.get(known)
		if (!attach) riches.set(known, (attach = rich_editor_for(key, field)))
		return attach
	}
	const riches = new Map<string, Attachment<HTMLElement>>()

	function rich_editor_for(key: string, field: Field): Attachment<HTMLElement> {
		return (node) => {
			let stop: (() => void) | undefined
			let gone = false
			type Part = { text?: string; content?: Array<Part> }
			// a field nobody's written in yet is "", or nothing, or a document with nothing in it, none
			// of which is a document the editor can hold: an empty paragraph is, and is what it means
			const whole = (value: unknown) =>
				value && typeof value === "object" && (value as Part).content?.length
					? value
					: { type: "doc", content: [{ type: "paragraph" }] }
			const doc = whole(untrack(() => $state.snapshot(values[key])))
			const target = untrack(() => selection)
			if (!target) return
			// its words straight away, as plain paragraphs, while the editor joins whoever else has it open
			const words = (part: Part): string => part.text ?? (part.content ?? []).map(words).join("")
			// and where its format bar will be, as it will look once it's there
			const bar = document.createElement("div")
			bar.className = "format-bones"
			bar.setAttribute("aria-hidden", "true")
			bar.innerHTML = "<span></span><span></span><span class=wide></span><span></span>"
			const text = document.createElement("div")
			text.className = "words"
			text.textContent = ((doc as Part).content ?? []).map(words).join("\n\n")
			node.replaceChildren(bar, text)
			node.dataset.waiting = ""
			import("./richtext.js").then(async ({ holds, rich_editor, shared_doc }) => {
				if (gone) return
				const room = enter(`${target.story}:${target.uid}:${key}`)
				const first = await room.ready
				// the first one in starts it from what's saved, not what the page last showed
				const saved = first
					? await call<Loaded>({ op: "blok", story: target.story, uid: target.uid })
							.then((found) => whole(found.blok[key]) as RichDoc)
							.catch(() => undefined)
					: undefined
				const extras = await inserts(field).catch(() => undefined)
				if (gone) return void leave(room)
				// what's in the room already, or else what's saved, only if the editor can hold all of it
				const fragment = room.doc.getXmlFragment("rich")
				if (!holds((fragment.length ? shared_doc(room) : (saved ?? doc)) as RichDoc)) {
					leave(room)
					node.textContent =
						"This text has something in it the editor can’t take, so it’s left as it is"
					return
				}
				room.value = () => shared_doc(room)
				room.save = (value, shared) => save_shared(target, key, value, shared)
				together.add(key)
				node.textContent = ""
				delete node.dataset.waiting
				const editor = rich_editor({
					element: node,
					doc: (saved ?? doc) as RichDoc,
					fixed: true,
					field: field as RichField,
					inserts: extras,
					change: (next) => {
						values[key] = next
						show_ahead(key, next)
					},
					together: { room, seed: first && !room.doc.getXmlFragment("rich").length },
				})
				// what's saved: the stored text, or as the editor holds it once it has started the field
				room.saved ??= first ? room.value() : doc
				resyncs.set(key, (value) => {
					// only text nobody has touched since it was saved: anything typed, here, on the page or
					// by someone else, is newer than whatever this save brought
					const untouched = room.saved !== undefined && same(room.value!(), room.saved)
					if (!value || !untouched || room.users > 1 || shared(room) || focused === key) return
					if (same(value, room.value!())) return
					quietly(room, () => editor.editor.commands.setContent(value as RichDoc))
					// as the editor holds it, so its own writing of the same text isn't taken for a change
					room.saved = room.value!()
				})
				editor.editor.on("focus", () => (focused = key))
				editor.editor.on("blur", () => {
					focused = null
					flush()
				})
				stop = () => {
					editor.destroy()
					resyncs.delete(key)
					together.delete(key)
					leave(room)
				}
			})
			return () => {
				gone = true
				stop?.()
			}
		}
	}

	// --- video, uploaded to Mux through the site

	type Video = {
		playback_id?: string
		title?: string
		poster?: string
		autoplay?: boolean
		muted?: boolean
		loop?: boolean
		mux_video?: { duration?: number }
	}
	type MuxAsset = {
		id: string
		status?: string
		duration?: number
		title: string
		playback_id?: string
	}
	let videos = $state<Record<string, { status: string; progress?: number } | undefined>>({})
	let library = $state<{ key: string; assets: Array<MuxAsset> | null } | null>(null)

	const video = (v: unknown) => (v && typeof v === "object" ? (v as Video) : null)
	const mux_thumb = (playback?: string, width = 320) =>
		playback ? `https://image.mux.com/${playback}/thumbnail.jpg?width=${width}` : undefined
	const minutes = (seconds?: number) =>
		seconds
			? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
			: ""

	async function use_video(key: string, asset: string) {
		if (!selection) return
		videos[key] = { status: "Saving…" }
		const reply = await send({
			op: "mux_set",
			story: selection.story,
			uid: selection.uid,
			field: key,
			asset,
		})
		videos[key] = undefined
		if (!reply) failed[key] = last_problem() ?? "Couldn’t save the video"
		else load(selection, false)
	}

	async function upload_video(key: string, file: File) {
		if (!loaded) return
		const component = loaded.blok.component
		delete failed[key]
		try {
			videos[key] = { status: "Starting upload…", progress: 0 }
			const { upload, url } = await call<{ upload: string; url: string }>({
				op: "mux_upload",
				component,
				field: key,
				title: file.name.replace(/\.[^.]+$/, ""),
			})
			await new Promise<void>((resolve, reject) => {
				const request = new XMLHttpRequest()
				request.open("PUT", url)
				request.upload.onprogress = (e) => {
					if (e.lengthComputable)
						videos[key] = { status: "Uploading", progress: e.loaded / e.total }
				}
				request.onload = () =>
					request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status})`))
				request.onerror = () => reject(new Error("Upload failed"))
				request.send(file)
			})
			videos[key] = { status: "Processing…" }
			// Mux makes the asset a moment after the upload lands
			for (let tries = 0; tries < 90; tries++) {
				const { asset } = await call<{ asset?: MuxAsset }>({
					op: "mux_status",
					component,
					field: key,
					upload,
				})
				if (asset) return use_video(key, asset.id)
				await new Promise((r) => setTimeout(r, 2000))
			}
			throw new Error("Mux is taking a while; try choosing it from the library shortly")
		} catch (e) {
			videos[key] = undefined
			failed[key] = (e as Error).message
		}
	}

	async function open_library(key: string) {
		if (!loaded) return
		if (library?.key === key) return (library = null)
		library = { key, assets: null }
		try {
			const { assets } = await call<{ assets: Array<MuxAsset> }>({
				op: "mux_assets",
				component: loaded.blok.component,
				field: key,
			})
			if (library?.key === key) library.assets = assets.filter((a) => a.playback_id)
		} catch (e) {
			library = null
			failed[key] = (e as Error).message
		}
	}

	/** Escape closes the panel's own menus first; the page takes it from there */
	function keydown(event: KeyboardEvent) {
		if (event.key !== "Escape" || (!adding && !finding && !picking && !library)) return
		event.preventDefault()
		adding = null
		finding = null
		picking = null
		library = null
	}
</script>

{#snippet Status(key: string)}
	{#if saving[key]}
		<span class="state" aria-live="polite"
			><span class="spinner" aria-hidden="true"></span><span class="sr">Saving</span></span
		>
	{:else if failed[key]}
		<span class="state bad" role="alert">{failed[key]}</span>
	{/if}
{/snippet}

{#snippet Label(key: string, field: Field, id: string)}
	<div class="head">
		<label for={id}
			>{field_label(key, field)}{#if field.required}<span class="required" aria-hidden="true"
					>*</span
				>{/if}</label
		>
		{@render Status(key)}
	</div>
	{#if field.description}<p class="help">{field.description}</p>{/if}
{/snippet}

{#snippet Text(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<input
		{id}
		{@attach share(key)}
		value={text(values[key])}
		maxlength={Number(field.max_length) || undefined}
		onfocus={() => (focused = key)}
		onblur={() => {
			focused = null
			flush()
		}}
		oninput={(e) => change(key, e.currentTarget.value, 700)}
	/>
{/snippet}

{#snippet Textarea(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<textarea
		{id}
		{@attach share(key)}
		rows="3"
		value={text(values[key])}
		maxlength={Number(field.max_length) || undefined}
		onfocus={() => (focused = key)}
		onblur={() => {
			focused = null
			flush()
		}}
		oninput={(e) => change(key, e.currentTarget.value, 700)}></textarea>
{/snippet}

{#snippet Number_(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<input
		{id}
		type="number"
		value={text(values[key])}
		onfocus={() => (focused = key)}
		onblur={() => {
			focused = null
			flush()
		}}
		oninput={(e) => change(key, e.currentTarget.value, 700)}
	/>
{/snippet}

{#snippet Boolean_(key: string, field: Field, id: string)}
	<div class="switch-row">
		<label for={id}>{field_label(key, field)}</label>
		{@render Status(key)}
		<input
			{id}
			class="switch"
			type="checkbox"
			role="switch"
			checked={values[key] === true}
			onchange={(e) => change(key, e.currentTarget.checked)}
		/>
	</div>
	{#if field.description}<p class="help">{field.description}</p>{/if}
{/snippet}

{#snippet Option(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	{#await choices_for(key)}
		<select {id} disabled><option>Loading…</option></select>
	{:then list}
		<select {id} value={text(values[key])} onchange={(e) => change(key, e.currentTarget.value)}>
			{#if !field.required}<option value="">None</option>{/if}
			{#each list as choice (choice.value)}<option value={choice.value}>{choice.name}</option
				>{/each}
			{#if text(values[key]) && !list.some((c) => c.value === text(values[key]))}
				<option value={text(values[key])}>{text(values[key])}</option>
			{/if}
		</select>
	{/await}
{/snippet}

{#snippet Stories(key: string, field: Field, id: string)}
	{@const chosen = uuids(values[key])}
	{@const names = names_for(chosen)}
	{@render Label(key, field, id)}
	{#if chosen.length}
		<ol class="kids picks">
			{#each chosen as uuid, i (uuid)}
				<li
					class:lifted={dragging?.key === key && dragging.from === i}
					class:shifting={dragging?.key === key}
					style:translate={shift(key, i)}
				>
					{#if chosen.length > 1}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<span
							class="grip"
							title="Drag to reorder"
							onpointerdown={(e) => drag(e, key, i, (to) => change(key, reorder(chosen, i, to)))}
							><svg viewBox="0 0 24 24" aria-hidden="true"
								><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle
									cx="9"
									cy="12"
									r="1.4"
								/><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle
									cx="15"
									cy="18"
									r="1.4"
								/></svg
							></span
						>
					{/if}
					{#if names.get(uuid)}
						{@const story = names.get(uuid)!}
						<!-- a row to go into, as a block in a list is: it looked like one, and went nowhere -->
						<button
							type="button"
							class="pick"
							title="Edit {story.name}: changes show wherever it’s used"
							disabled={opening === uuid}
							onclick={() => open_story(story, key)}
						>
							<span>{story.name}</span>
							<small>/{story.full_slug}</small>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
						</button>
					{:else}
						<span class="pick"><span>…</span></span>
					{/if}
					<span class="tools">
						<button
							type="button"
							aria-label="Remove"
							onclick={() =>
								change(
									key,
									chosen.filter((u) => u !== uuid)
								)}
							><svg viewBox="0 0 24 24" aria-hidden="true"
								><path
									d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
								/></svg
							></button
						>
					</span>
				</li>
			{/each}
		</ol>
	{/if}
	<div class="combo">
		<input
			{id}
			placeholder={chosen.length ? "Add another" : "Find a story to add"}
			value={picking?.key === key ? picking.search : ""}
			onfocus={() => pick_stories(key, "")}
			oninput={(e) => pick_stories(key, e.currentTarget.value)}
			onblur={() => setTimeout(() => picking?.key === key && (picking = null), 150)}
		/>
		{#if picking?.key === key && picking.results.length}
			<ul class="results">
				{#each picking.results as story (story.uuid)}
					{@const has = chosen.includes(story.uuid)}
					<li>
						<button
							type="button"
							class:on={has}
							aria-pressed={has}
							onmousedown={(e) => e.preventDefault()}
							onclick={() =>
								change(key, has ? chosen.filter((u) => u !== story.uuid) : [...chosen, story.uuid])}
							><strong>{story.name}</strong><span>/{story.full_slug}</span></button
						>
					</li>
				{/each}
				{#if picking.more}
					<li>
						<button
							type="button"
							class="more"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => picking && pick_stories(key, picking.search, picking.page + 1)}
							>Show more</button
						>
					</li>
				{/if}
			</ul>
		{/if}
	</div>
{/snippet}

{#snippet Options(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	{#await choices_for(key) then list}
		{@const chosen = Array.isArray(values[key]) ? (values[key] as Array<string>) : []}
		<div class="checks" {id} role="group">
			{#each list as choice (choice.value)}
				<label class="check">
					<input
						type="checkbox"
						checked={chosen.includes(choice.value)}
						onchange={(e) =>
							change(
								key,
								e.currentTarget.checked
									? [...chosen, choice.value]
									: chosen.filter((v) => v !== choice.value)
							)}
					/>
					{choice.name}
				</label>
			{:else}
				<p class="help">Nothing to choose from yet</p>
			{/each}
		</div>
	{/await}
{/snippet}

{#snippet Datetime(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<input
		{id}
		type={field.disable_time ? "date" : "datetime-local"}
		value={to_input(values[key], field.disable_time)}
		onchange={(e) => change(key, from_input(e.currentTarget.value))}
	/>
{/snippet}

{#snippet Asset_(key: string, field: Field, id: string)}
	{@const value = asset(values[key])}
	{@const choose = () =>
		picker({
			current: value,
			images: only_images(field),
			r2: r2_of(key, field),
			save: async (choice) => {
				change(key, { id: choice.asset, alt: choice.alt, focus: choice.focus })
				return null
			},
		})}
	{@render Label(key, field, id)}
	{#if value.filename}
		<!-- the whole width, with what changes it over its corner -->
		<div class="picture">
			{#if IMAGE.test(value.filename)}
				<img src={thumb(value.filename, 640)} alt={value.alt ?? ""} />
			{:else}
				<span class="file">{file_name(value.filename)}</span>
			{/if}
			<span class="over">
				<button {id} type="button" aria-label="Replace" onclick={choose}
					><svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path
							d="M21 3v5h-5"
						/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path
							d="M8 16H3v5"
						/></svg
					><span class="tip" aria-hidden="true">Replace</span></button
				>
				<button type="button" aria-label="Remove" onclick={() => change(key, null)}
					><svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
						/></svg
					><span class="tip" aria-hidden="true">Remove</span></button
				>
			</span>
		</div>
		{#if IMAGE.test(value.filename)}
			<div class="alt">
				<input
					aria-label="Alt text"
					placeholder="Alt text: what it shows"
					value={value.alt ?? ""}
					disabled={describing[key]}
					oninput={(e) => change(key, { ...value, alt: e.currentTarget.value }, 700)}
					onblur={flush}
				/>
				<!-- the image service can't describe a vector -->
				{#if !/\.svg$/i.test(value.filename)}
					<button
						type="button"
						class="ai"
						class:busy={describing[key]}
						aria-label="Write it with AI"
						disabled={describing[key]}
						onclick={() => describe(key, value)}
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M9.94 14.06 4 20M14 4l1.1 2.9L18 8l-2.9 1.1L14 12l-1.1-2.9L10 8l2.9-1.1zM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z"
							/></svg
						><span class="tip" aria-hidden="true">Write it with AI</span></button
					>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="asset-actions">
			<button {id} type="button" class="button" onclick={choose}>Choose</button>
		</div>
	{/if}
{/snippet}

{#snippet Multiasset(key: string, field: Field, id: string)}
	{@const list = Array.isArray(values[key]) ? (values[key] as Array<Asset>) : []}
	{@const keep = (next: Array<Asset>) =>
		change(
			key,
			next.map(({ id, alt, focus }) => ({ id, alt, focus }))
		)}
	{@render Label(key, field, id)}
	<ul class="assets">
		{#each list as item, i (item.id ?? i)}
			<li>
				{#if item.filename && IMAGE.test(item.filename)}
					<img src={thumb(item.filename)} alt={item.alt ?? ""} />
				{:else}
					<span class="file">{file_name(item.filename)}</span>
				{/if}
				<span class="tools">
					<button
						type="button"
						aria-label="Earlier"
						disabled={i === 0}
						onclick={() => keep(list.toSpliced(i - 1, 2, list[i], list[i - 1]))}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button
					>
					<button
						type="button"
						aria-label="Later"
						disabled={i === list.length - 1}
						onclick={() => keep(list.toSpliced(i, 2, list[i + 1], list[i]))}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button
					>
					<button type="button" aria-label="Remove" onclick={() => keep(list.toSpliced(i, 1))}
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
							/></svg
						></button
					>
				</span>
			</li>
		{/each}
		<li>
			<button
				{id}
				type="button"
				class="add-tile"
				onclick={() =>
					picker({
						current: {},
						images: only_images(field),
						r2: r2_of(key, field),
						save: async (choice) => {
							keep([...list, { id: choice.asset, alt: choice.alt, focus: choice.focus }])
							return null
						},
					})}>+ Add</button
			>
		</li>
	</ul>
{/snippet}

{#snippet Multilink(key: string, field: Field, id: string)}
	{@const value = link(values[key])}
	{@const kind =
		value.linktype === "email" ? "email" : value.linktype === "story" ? "story" : "url"}
	{@render Label(key, field, id)}
	<div class="segmented" role="radiogroup" aria-label="Link to">
		{#each [["story", "Page"], ["url", "URL"], ["email", "Email"]] as [type, name] (type)}
			<button
				type="button"
				role="radio"
				aria-checked={kind === type}
				class:on={kind === type}
				onclick={() =>
					kind !== type &&
					(values[key] = { ...value, linktype: type, id: "", url: "", cached_url: "", email: "" })}
				>{name}</button
			>
		{/each}
	</div>
	{#if kind === "story"}
		<div class="combo">
			<input
				{id}
				placeholder={value.cached_url ? `/${value.cached_url}` : "Find a page"}
				value={finding?.key === key ? finding.search : ""}
				onfocus={() => find_stories(key, "")}
				oninput={(e) => find_stories(key, e.currentTarget.value)}
				onblur={() => setTimeout(() => finding?.key === key && (finding = null), 150)}
			/>
			{#if value.cached_url && finding?.key !== key}<p class="help">
					Links to /{value.cached_url}
				</p>{/if}
			{#if finding?.key === key && finding.results.length}
				<ul class="results">
					{#each finding.results as story (story.id)}
						<li>
							<button
								type="button"
								onmousedown={(e) => e.preventDefault()}
								onclick={() => {
									change(key, {
										linktype: "story",
										id: story.uuid,
										cached_url: story.full_slug,
										url: "",
										target: value.target,
									})
									finding = null
								}}><strong>{story.name}</strong><span>/{story.full_slug}</span></button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if kind === "email"}
		<input
			{id}
			type="email"
			placeholder="name@example.com"
			value={value.email ?? ""}
			onchange={(e) => change(key, { linktype: "email", email: e.currentTarget.value, url: "" })}
		/>
	{:else}
		<input
			{id}
			type="url"
			placeholder="https://"
			value={value.url ?? value.cached_url ?? ""}
			onchange={(e) =>
				change(key, { linktype: "url", url: e.currentTarget.value, target: value.target })}
		/>
	{/if}
	{#if kind !== "email"}
		<label class="check small">
			<input
				type="checkbox"
				checked={value.target === "_blank"}
				onchange={(e) =>
					change(key, { ...value, target: e.currentTarget.checked ? "_blank" : undefined })}
			/>
			Open in a new tab
		</label>
	{/if}
{/snippet}

{#snippet Heading(key: string, field: Field, id: string)}
	{@const value = heading(values[key])}
	{@render Label(key, field, id)}
	<div class="row">
		<input
			{id}
			value={value.text ?? ""}
			onfocus={() => (focused = key)}
			onblur={() => {
				focused = null
				flush()
			}}
			oninput={(e) => change(key, { ...value, text: e.currentTarget.value }, 700)}
		/>
		<select
			class="level"
			aria-label="Heading level"
			value={String(value.level ?? "")}
			onchange={(e) => {
				const level = e.currentTarget.value ? Number(e.currentTarget.value) : null
				change(key, { ...value, level, tag: level ? `h${level}` : null })
			}}
		>
			<option value="">Auto</option>
			{#each [1, 2, 3, 4, 5, 6] as level (level)}<option value={String(level)}>H{level}</option
				>{/each}
		</select>
	</div>
{/snippet}

{#snippet Seo(key: string, field: Field, id: string)}
	{@const value = (values[key] && typeof values[key] === "object" ? values[key] : {}) as Record<
		string,
		string
	>}
	{@render Label(key, field, id)}
	<div class="group">
		{#each [["title", "Title", false], ["description", "Description", true], ["og_title", "Social title", false], ["og_description", "Social description", true]] as [part, name, long] (part)}
			<label class="sub">
				<span>{name}</span>
				{#if long}
					<textarea
						rows="2"
						value={value[part as string] ?? ""}
						onfocus={() => (focused = key)}
						onblur={() => {
							focused = null
							flush()
						}}
						oninput={(e) => change(key, { ...value, [part as string]: e.currentTarget.value }, 700)}
					></textarea>
				{:else}
					<input
						id={part === "title" ? id : undefined}
						value={value[part as string] ?? ""}
						onfocus={() => (focused = key)}
						onblur={() => {
							focused = null
							flush()
						}}
						oninput={(e) => change(key, { ...value, [part as string]: e.currentTarget.value }, 700)}
					/>
				{/if}
			</label>
		{/each}
	</div>
{/snippet}

{#snippet Richtext(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	{#if values[key] && !rich_supported(values[key])}
		<p class="readonly" {id}>{richtext_preview(values[key]) || "Empty"}</p>
		<p class="help">This text has formatting that’s edited in Storyblok.</p>
	{:else}
		<div class="rich" {id} {@attach rich(key, field)}></div>
	{/if}
{/snippet}

{#snippet Chooser(key: string)}
	{#if adding}
		{@const shown = adding.components.filter((c) =>
			`${c.display_name} ${c.name}`.toLowerCase().includes(adding!.filter.trim().toLowerCase())
		)}
		<div class="adding">
			<!-- a way out of it for a press that wasn't meant, as Escape is from the keyboard -->
			<div class="find">
				<input placeholder="Find a block" aria-label="Find a block" bind:value={adding.filter} />
				<button
					type="button"
					class="round"
					aria-label="Cancel"
					data-tip="Cancel"
					onclick={() => (adding = null)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
			<ul>
				{#each shown as c (c.name)}
					<li>
						<button type="button" onclick={() => insert(key, c.name)}
							>{c.display_name === c.name ? label(c.name) : c.display_name}</button
						>
					</li>
				{:else}
					<li class="help">No blocks match</li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}

{#snippet Bloks(key: string, field: Field, id: string)}
	{@const list = kids(values[key])}
	{@render Label(key, field, id)}
	<ol class="kids" {id}>
		{#each list as kid, i (kid._uid)}
			<li
				class:lifted={dragging?.key === key && dragging.from === i}
				class:shifting={dragging?.key === key}
				style:translate={shift(key, i)}
				onpointerenter={() => highlight(kid._uid)}
				onpointerleave={() => highlight(selection?.uid ?? null)}
			>
				{#if list.length > 1}
					<!-- the pointer's way to reorder; Move up and down do it from the keyboard -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<span
						class="grip"
						title="Drag to reorder"
						onpointerdown={(e) =>
							drag(
								e,
								key,
								i,
								(to) => move_kid(key, i, to),
								(to) => land(kid._uid, to)
							)}
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle
								cx="9"
								cy="12"
								r="1.4"
							/><circle cx="15" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle
								cx="15"
								cy="18"
								r="1.4"
							/></svg
						></span
					>
				{/if}
				<button
					type="button"
					class="kid"
					onclick={() => selection && select({ story: selection.story, uid: kid._uid })}
				>
					<span
						>{component_label(kid.component)}{#if preview_of(kid)}<small>{preview_of(kid)}</small
							>{/if}</span
					>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
				</button>
				<span class="tools">
					<button
						type="button"
						aria-label="Move up"
						disabled={i === 0}
						onclick={() => child(key, "move", kid._uid, -1)}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg></button
					>
					<button
						type="button"
						aria-label="Move down"
						disabled={i === list.length - 1}
						onclick={() => child(key, "move", kid._uid, 1)}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></button
					>
					<button
						type="button"
						aria-label="Duplicate"
						onclick={() => child(key, "duplicate", kid._uid)}
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><rect x="9" y="9" width="11" height="11" rx="2" /><path
								d="M5 15V6a1 1 0 0 1 1-1h9"
							/></svg
						></button
					>
					<button type="button" aria-label="Delete" onclick={() => child(key, "remove", kid._uid)}
						><svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
							/></svg
						></button
					>
				</span>
				{#if i < list.length - 1 && adding?.after !== kid._uid}
					<!-- in the gap after it: a block added here rather than at the end -->
					<button
						type="button"
						class="between"
						aria-label="Add a block after {component_label(kid.component)}"
						onclick={() => add_child(key, kid._uid)}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button
					>
				{/if}
			</li>
			{#if adding?.key === key && adding.after === kid._uid}
				<li class="chooser">{@render Chooser(key)}</li>
			{/if}
		{/each}
	</ol>
	{#if adding?.key === key && !adding.after}
		{@render Chooser(key)}
	{:else}
		<button type="button" class="button quiet add" onclick={() => add_child(key)}
			>+ Add a block</button
		>
	{/if}
{/snippet}

{#snippet Video_(key: string, field: Field, id: string)}
	{@const value = video(values[key])}
	{@const busy = videos[key]}
	{@render Label(key, field, id)}
	<div class="video">
		{#if value?.playback_id}
			<figure>
				<img src={mux_thumb(value.playback_id)} alt="" />
				<figcaption>
					<strong>{value.title || "Untitled video"}</strong>
					{#if value.mux_video?.duration}<span>{minutes(value.mux_video.duration)}</span>{/if}
				</figcaption>
			</figure>
		{/if}
		{#if busy}
			<div class="progress" role="status">
				<span
					>{busy.status}{busy.progress !== undefined
						? ` ${Math.round(busy.progress * 100)}%`
						: ""}</span
				>
				<span class="track"
					><span
						style:inline-size="{(busy.progress ?? 1) * 100}%"
						class:indeterminate={busy.progress === undefined}
					></span></span
				>
			</div>
		{:else}
			<div class="asset-actions">
				<label class="button" for={id}>
					{value?.playback_id ? "Upload another" : "Upload video"}
					<input
						{id}
						type="file"
						accept="video/*"
						hidden
						onchange={(e) => {
							const file = e.currentTarget.files?.[0]
							e.currentTarget.value = ""
							if (file) upload_video(key, file)
						}}
					/>
				</label>
				<button type="button" class="button quiet" onclick={() => open_library(key)}>Library</button
				>
				{#if value?.playback_id}
					<button type="button" class="button quiet" onclick={() => change(key, null)}
						>Remove</button
					>
				{/if}
			</div>
		{/if}
		{#if library?.key === key}
			<ul class="library">
				{#if !library.assets}
					<li class="help">Loading videos…</li>
				{:else}
					{#each library.assets as asset (asset.id)}
						<li>
							<button
								type="button"
								title={asset.title || "Untitled"}
								onclick={() => ((library = null), use_video(key, asset.id))}
							>
								<img src={mux_thumb(asset.playback_id, 200)} alt="" loading="lazy" />
								<span>{asset.title || minutes(asset.duration) || "Untitled"}</span>
							</button>
						</li>
					{:else}
						<li class="help">No videos in Mux yet</li>
					{/each}
				{/if}
			</ul>
		{/if}
		{#if value?.playback_id}
			<div class="toggles">
				{#each [["autoplay", "Autoplay"], ["muted", "Muted"], ["loop", "Loop"]] as [setting, name] (setting)}
					<label class="check small">
						<input
							type="checkbox"
							checked={value[setting as "autoplay"] === true}
							onchange={(e) => change(key, { ...value, [setting]: e.currentTarget.checked })}
						/>
						{name}
					</label>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet Table_(key: string, field: Field, id: string)}
	{@const table = table_of(values[key])}
	{@const typing = {
		onfocus: () => (focused = key),
		onblur: () => {
			focused = null
			flush()
		},
	}}
	{@render Label(key, field, id)}
	{#if table.thead.length}
		<div class="table">
			<table>
				<thead>
					<tr>
						{#each table.thead as head, c (head._uid)}
							<th>
								<input
									id={c === 0 ? id : undefined}
									value={head.value}
									placeholder="Heading"
									aria-label="Column {c + 1} heading"
									{...typing}
									oninput={(e) => {
										const value = e.currentTarget.value
										edit_table(key, (t) => (t.thead[c].value = value), 700)
									}}
								/>
								<button
									type="button"
									class="round"
									aria-label="Remove column {c + 1}"
									onclick={() =>
										edit_table(key, (t) => {
											t.thead.splice(c, 1)
											for (const r of t.tbody) r.body.splice(c, 1)
										})}
									><svg viewBox="0 0 24 24" aria-hidden="true"
										><path
											d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
										/></svg
									></button
								>
							</th>
						{/each}
						<th class="edge"></th>
					</tr>
				</thead>
				<tbody>
					{#each table.tbody as body_row, r (body_row._uid)}
						<tr>
							{#each body_row.body as item, c (item._uid)}
								<td>
									<input
										value={item.value}
										aria-label="Row {r + 1}, {table.thead[c]?.value || `column ${c + 1}`}"
										{...typing}
										oninput={(e) => {
											const value = e.currentTarget.value
											edit_table(key, (t) => (t.tbody[r].body[c].value = value), 700)
										}}
									/>
								</td>
							{/each}
							<td class="edge">
								<button
									type="button"
									class="round"
									aria-label="Remove row {r + 1}"
									onclick={() => edit_table(key, (t) => t.tbody.splice(r, 1))}
									><svg viewBox="0 0 24 24" aria-hidden="true"
										><path
											d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
										/></svg
									></button
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<div class="table-actions">
		<button
			type="button"
			class="button quiet"
			id={table.thead.length ? undefined : id}
			onclick={() =>
				edit_table(key, (t) => {
					if (!t.thead.length) add_column(t)
					t.tbody.push(row(t.thead.length))
				})}>+ Row</button
		>
		<button type="button" class="button quiet" onclick={() => edit_table(key, add_column)}
			>+ Column</button
		>
	</div>
{/snippet}

{#snippet Theme(key: string, field: Field, id: string)}
	{@const choices = theme_choices(field.options ?? undefined)}
	{@const chosen = choices.find((choice) => choice.value === values[key])}
	{@render Label(key, field, id)}
	<div class="row">
		<select
			{id}
			value={text(values[key])}
			onchange={(e) => change(key, e.currentTarget.value || null)}
		>
			<option value="">None</option>
			{#each choices as choice (choice.value)}<option value={choice.value}>{choice.name}</option
				>{/each}
		</select>
		{#if chosen?.colors.length}
			<span class="swatches" aria-hidden="true">
				{#each chosen.colors as color, i (i)}<span style:background={color}></span>{/each}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet Time(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<input
		{id}
		type="time"
		value={text(values[key])}
		onchange={(e) => change(key, e.currentTarget.value)}
	/>
{/snippet}

{#snippet Currency(key: string, field: Field, id: string)}
	{@const value = object_of(values[key])}
	{@const currency = text(
		value.currency || field.options?.find((o) => o.name === "default_currency")?.value || "GBP"
	).toUpperCase()}
	{@render Label(key, field, id)}
	<div class="row">
		<select
			class="level"
			aria-label="Currency"
			value={currency}
			onchange={(e) =>
				change(key, { ...value, currency: e.currentTarget.value, amount: value.amount ?? null })}
		>
			{#each codes_of(field, currency) as code (code)}<option value={code}>{code}</option>{/each}
		</select>
		<input
			{id}
			type="number"
			min="0"
			step="any"
			inputmode="decimal"
			value={value.amount ?? ""}
			onchange={(e) =>
				change(key, {
					...value,
					currency,
					amount: e.currentTarget.value === "" ? null : Number(e.currentTarget.value),
				})}
		/>
	</div>
{/snippet}

{#snippet BlokSelect(key: string, field: Field, id: string)}
	{@const value = object_of(values[key])}
	{@const choices = selection ? bloks_of(selection.story) : []}
	{@render Label(key, field, id)}
	<select
		{id}
		value={text(value.id)}
		onchange={(e) => change(key, { ...value, id: e.currentTarget.value })}
	>
		<option value="">None</option>
		{#each choices as choice (choice.id)}<option value={choice.id}
				>{"— ".repeat(choice.depth)}{choice.label}</option
			>{/each}
		{#if text(value.id) && !choices.some((c) => c.id === value.id)}
			<option value={text(value.id)}>{text(value.id)}</option>
		{/if}
	</select>
{/snippet}

{#snippet Dates(key: string, field: Field, id: string)}
	{@const value = object_of(values[key])}
	{@const zone = text(value.timezone) || here}
	{@const rows = list_of<Value>(value.dates)}
	{@const keep = (dates: Array<Value>, timezone = zone) =>
		change(key, { ...value, timezone, dates })}
	{@const set = (i: number, part: string, next: string) =>
		keep(rows.with(i, { ...rows[i], [part]: next || null }))}
	{@render Label(key, field, id)}
	<div class="group" {id}>
		{#each rows as row, i (i)}
			<div class="dates">
				<input
					type="date"
					aria-label="Starts"
					value={text(row.start_date)}
					onchange={(e) => e.currentTarget.value && set(i, "start_date", e.currentTarget.value)}
				/>
				<input
					type="time"
					aria-label="Start time"
					value={text(row.start_time)}
					onchange={(e) => set(i, "start_time", e.currentTarget.value)}
				/>
				<button
					type="button"
					class="round"
					aria-label="Remove"
					onclick={() => keep(rows.toSpliced(i, 1))}
					><svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
						/></svg
					></button
				>
				<input
					type="date"
					aria-label="Ends"
					value={text(row.end_date)}
					onchange={(e) => set(i, "end_date", e.currentTarget.value)}
				/>
				<input
					type="time"
					aria-label="End time"
					value={text(row.end_time)}
					disabled={!row.start_time}
					onchange={(e) => set(i, "end_time", e.currentTarget.value)}
				/>
			</div>
		{/each}
		<div class="row">
			<button
				type="button"
				class="button quiet"
				onclick={() => keep([...rows, { start_date: new Date().toISOString().slice(0, 10) }])}
				>+ Date</button
			>
			<select
				aria-label="Timezone"
				value={zone}
				onchange={(e) => keep(rows, e.currentTarget.value)}
			>
				{#each zones.includes(zone) ? zones : [zone, ...zones] as name (name)}<option value={name}
						>{name.replaceAll("_", " ")}</option
					>{/each}
			</select>
		</div>
	</div>
{/snippet}

{#snippet Link_(key: string, field: Field, id: string)}
	{@const value = plugin_link(object_of(values[key]))}
	{@const type = text(value.type) || "external"}
	{@const keep = (patch: Value) => change(key, { ...value, type, ...patch })}
	{@const story = object_of(value.story)}
	<!-- only the kinds the field's `link_types` option allows, and whatever it is now -->
	{@const allowed = link_types_of(option(field, "link_types"))}
	{@const kinds = [
		["internal", "Page"],
		["external", "URL"],
		["email", "Email"],
	].filter(([kind]) => !allowed || kind === type || allowed.some((a) => a === kind))}
	{@render Label(key, field, id)}
	{#if type !== "asset" && type !== "form" && kinds.length > 1}
		<div class="segmented" role="radiogroup" aria-label="Link to">
			{#each kinds as [kind, name] (kind)}
				<button
					type="button"
					role="radio"
					aria-checked={type === kind}
					class:on={type === kind}
					onclick={() => type !== kind && (values[key] = { ...value, type: kind })}>{name}</button
				>
			{/each}
		</div>
	{/if}
	<input
		{id}
		placeholder="Link text"
		value={text(value.text)}
		onfocus={() => (focused = key)}
		onblur={() => {
			focused = null
			flush()
		}}
		oninput={(e) => change(key, { ...value, type, text: e.currentTarget.value }, 700)}
	/>
	{#if type === "internal"}
		<div class="combo">
			<input
				aria-label="Page"
				placeholder={story.name ? text(story.name) : "Find a page"}
				value={finding?.key === key ? finding.search : ""}
				onfocus={() => find_stories(key, "")}
				oninput={(e) => find_stories(key, e.currentTarget.value)}
				onblur={() => setTimeout(() => finding?.key === key && (finding = null), 150)}
			/>
			{#if story.name && finding?.key !== key}<p class="help">Links to {story.name}</p>{/if}
			{#if finding?.key === key && finding.results.length}
				<ul class="results">
					{#each finding.results as found (found.id)}
						<li>
							<button
								type="button"
								onmousedown={(e) => e.preventDefault()}
								onclick={() => {
									keep({ story: { id: found.id, uuid: found.uuid, name: found.name } })
									finding = null
								}}><strong>{found.name}</strong><span>/{found.full_slug}</span></button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{:else if type === "email"}
		<input
			type="email"
			aria-label="Email"
			placeholder="name@example.com"
			value={text(value.email)}
			onchange={(e) => keep({ email: e.currentTarget.value })}
		/>
	{:else if type === "asset"}
		<p class="help">Links to a file, which is chosen in Storyblok.</p>
	{:else if type === "form"}
		<p class="help">Opens a HubSpot form, which is chosen in Storyblok.</p>
	{:else}
		<input
			type="url"
			aria-label="URL"
			placeholder="https://"
			value={text(value.url)}
			onchange={(e) => keep({ url: e.currentTarget.value })}
		/>
	{/if}
	{#if type !== "email"}
		<label class="check small">
			<input
				type="checkbox"
				checked={value.target === "_blank"}
				onchange={(e) => keep({ target: e.currentTarget.checked ? "_blank" : "_self" })}
			/>
			Open in a new tab
		</label>
	{/if}
{/snippet}

{#snippet Plans(key: string, field: Field, id: string)}
	{@const types = list_of<PlanType>(object_of(values[key]).types)}
	{@const t = Math.min(plan_type[key] ?? 0, Math.max(types.length - 1, 0))}
	{@const type = types[t]}
	{@const typing = {
		onfocus: () => (focused = key),
		onblur: () => {
			focused = null
			flush()
		},
	}}
	{@render Label(key, field, id)}
	<div class="group" {id}>
		<div class="row">
			<select
				aria-label="House type"
				data-part="types.{t}"
				value={String(t)}
				onchange={(e) => (plan_type[key] = Number(e.currentTarget.value))}
			>
				{#each types as each, i (each.id)}<option value={String(i)}
						>{each.name || `Type ${i + 1}`}</option
					>{/each}
				{#if !types.length}<option value="0">No types yet</option>{/if}
			</select>
			<button
				type="button"
				class="button quiet"
				onclick={() => {
					plans_edit(key, (list) =>
						list.push({ id: crypto.randomUUID(), name: `Type ${list.length + 1}`, floors: [] })
					)
					plan_type[key] = types.length
				}}>+ Type</button
			>
		</div>
		{#if type}
			<label class="sub">
				<span>Name</span>
				<input
					value={type.name ?? ""}
					data-part="types.{t}.name"
					{...typing}
					oninput={(e) => {
						const name = e.currentTarget.value
						plans_edit(key, (list) => (list[t].name = name), 700)
					}}
				/>
			</label>
			{#each type.floors as floor, f (floor.id)}
				{@const rooms = floor.dimensions.flatMap((dimension, d) =>
					dimension.rooms.map((room, r) => ({ room, d, r }))
				)}
				<div class="floor">
					<div class="row">
						<input
							aria-label="Floor name"
							placeholder="Floor"
							data-part="types.{t}.floors.{f}.name"
							value={floor.name}
							{...typing}
							oninput={(e) => {
								const name = e.currentTarget.value
								plans_edit(key, (list) => (list[t].floors[f].name = name), 700)
							}}
						/>
						<button
							type="button"
							class="round"
							aria-label="Remove {floor.name || 'floor'}"
							onclick={() => plans_edit(key, (list) => list[t].floors.splice(f, 1))}
							><svg viewBox="0 0 24 24" aria-hidden="true"
								><path
									d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
								/></svg
							></button
						>
					</div>
					<div class="asset">
						{#if floor.plan?.filename}<img
								src={thumb(floor.plan.filename)}
								alt={floor.plan.alt ?? ""}
							/>{/if}
						<div class="asset-actions">
							<button
								type="button"
								class="button"
								onclick={() =>
									picker({
										current: floor.plan ?? asset(null),
										images: true,
										save: async (choice) => {
											plans_edit(
												key,
												(list) =>
													(list[t].floors[f].plan = {
														...list[t].floors[f].plan,
														id: choice.asset,
														alt: choice.alt,
														focus: choice.focus,
														filename: choice.filename ?? "",
													} as Asset)
											)
											return null
										},
									})}>{floor.plan?.filename ? "Replace plan" : "Choose a plan"}</button
							>
						</div>
					</div>
					{#each rooms as { room, d, r } (room.id)}
						<div class="room">
							{#each [["name", "Room"], ["area_m", "m"], ["area_ft", "ft"]] as [part, name] (part)}
								<input
									aria-label={name}
									placeholder={name}
									data-part="types.{t}.floors.{f}.dimensions.{d}.rooms.{r}.{part}"
									value={room[part as keyof Room]}
									{...typing}
									oninput={(e) => {
										const next = e.currentTarget.value
										plans_edit(
											key,
											(list) =>
												(list[t].floors[f].dimensions[d].rooms[r][part as keyof Room] = next),
											700
										)
									}}
								/>
							{/each}
							<button
								type="button"
								class="round"
								aria-label="Remove {room.name || 'room'}"
								onclick={() =>
									plans_edit(key, (list) => list[t].floors[f].dimensions[d].rooms.splice(r, 1))}
								><svg viewBox="0 0 24 24" aria-hidden="true"
									><path
										d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
									/></svg
								></button
							>
						</div>
					{/each}
					<button
						type="button"
						class="button quiet"
						onclick={() =>
							plans_edit(key, (list) => {
								const dimensions = list[t].floors[f].dimensions
								if (!dimensions.length)
									dimensions.push({ id: crypto.randomUUID(), name: "", rooms: [] })
								dimensions.at(-1)!.rooms.push(fresh_room())
							})}>+ Room</button
					>
				</div>
			{/each}
			<div class="row">
				<button
					type="button"
					class="button quiet"
					onclick={() =>
						plans_edit(key, (list) =>
							list[t].floors.push({ id: crypto.randomUUID(), name: "", dimensions: [] })
						)}>+ Floor</button
				>
				<button
					type="button"
					class="button quiet"
					onclick={() => {
						plans_edit(key, (list) => list.splice(t, 1))
						plan_type[key] = Math.max(t - 1, 0)
					}}>Remove {type.name || "type"}</button
				>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet Unknown(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	{#if editor.space && selection}
		<!-- no Storyblok address opens a block, so the story, from where its field's a scroll away -->
		<a
			class="readonly out"
			{id}
			href="https://app.storyblok.com/#/me/spaces/{editor.space}/stories/0/0/{selection.story}"
			target="_blank"
			rel="noopener noreferrer"
			>Edit in Storyblok<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M7 17 17 7M8 7h9v9" /></svg
			></a
		>
	{:else}
		<p class="readonly" {id}>Edit in Storyblok</p>
	{/if}
{/snippet}

{#snippet Control(key: string, field: Field)}
	{@const id = `storyloco-field-${key}`}
	<!-- the pointer's own way back to the field on the page: the keyboard has focusin -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="sl-field"
		class:on-page={typed_here(key)}
		data-type={field.type}
		onfocusin={(e) =>
			selection && on_panel({ uid: selection.uid, field: key, part: part_of(e.target) })}
		// a field that kept its focus as the page scrolled away brings it back when clicked again
		onpointerdown={(e) =>
			selection && on_panel({ uid: selection.uid, field: key, part: part_of(e.target) })}
		onfocusout={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && on_panel(null)}
		{@attach (node) => {
			if (typed_here(key)) node.scrollIntoView({ block: "nearest", behavior: "smooth" })
		}}
	>
		{#if field.type === "text"}
			{@render Text(key, field, id)}
		{:else if field.type === "textarea" || field.type === "markdown"}
			{@render Textarea(key, field, id)}
		{:else if field.type === "number"}
			{@render Number_(key, field, id)}
		{:else if field.type === "boolean"}
			{@render Boolean_(key, field, id)}
		{:else if field.type === "option"}
			{@render Option(key, field, id)}
		{:else if field.type === "options" && field.source === "internal_stories"}
			{@render Stories(key, field, id)}
		{:else if field.type === "options"}
			{@render Options(key, field, id)}
		{:else if field.type === "datetime"}
			{@render Datetime(key, field, id)}
		{:else if field.type === "asset"}
			{@render Asset_(key, field, id)}
		{:else if field.type === "multiasset"}
			{@render Multiasset(key, field, id)}
		{:else if field.type === "multilink"}
			{@render Multilink(key, field, id)}
		{:else if field.type === "richtext"}
			{@render Richtext(key, field, id)}
		{:else if field.type === "bloks"}
			{@render Bloks(key, field, id)}
		{:else if is_heading(field)}
			{@render Heading(key, field, id)}
		{:else if field.field_type === "uiloco-seo"}
			{@render Seo(key, field, id)}
		{:else if is_video(field)}
			{@render Video_(key, field, id)}
		{:else if field.type === "table"}
			{@render Table_(key, field, id)}
		{:else if is_r2(field) && option(field, "multiple") === "true"}
			{@render Multiasset(key, field, id)}
		{:else if is_r2(field)}
			{@render Asset_(key, field, id)}
		{:else if plugin_of(field) === "plans"}
			{@render Plans(key, field, id)}
		{:else if plugin_of(field) === "theme"}
			{@render Theme(key, field, id)}
		{:else if plugin_of(field) === "time"}
			{@render Time(key, field, id)}
		{:else if plugin_of(field) === "currency"}
			{@render Currency(key, field, id)}
		{:else if plugin_of(field) === "blok_select"}
			{@render BlokSelect(key, field, id)}
		{:else if plugin_of(field) === "dates"}
			{@render Dates(key, field, id)}
		{:else if plugin_of(field) === "link"}
			{@render Link_(key, field, id)}
		{:else}
			{@render Unknown(key, field, id)}
		{/if}
	</div>
{/snippet}

{#if selection && editor.editing}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		class="inspector"
		class:folded
		data-storyloco="inspector"
		aria-label={is_page ? "Page settings" : "Block settings"}
		onkeydown={keydown}
		bind:this={panel_el}
	>
		<header>
			<div class="title">
				<!-- where it is and what it is, read as one line: Home › Hero -->
				<div class="name" style:--way={way}>
					{#if !folded && loaded && (loaded.trail.length > 1 || back)}
						<nav class="trail" aria-label="Where this block is">
							{#if parents.length > SPELT}
								<!-- too deep to spell out: every step in one list, nested as the blocks are.
								     ponytail: the browser's own select, a drawn menu if it should match the panel -->
								<select
									aria-label="Go to a block this one is in"
									onchange={(event) => {
										const to = parents[Number(event.currentTarget.value)]
										event.currentTarget.value = ""
										if (to) select({ story: to.story, uid: to.uid })
									}}
								>
									<option value="" hidden selected>…</option>
									{#each parents as step, i (step.uid)}
										<option value={i}>{"\u00a0\u00a0".repeat(i)}{step.name}</option>
									{/each}
								</select>
								<span aria-hidden="true">›</span>
							{:else if back}
								<!-- the blocks it was got to through, in the story that picks it -->
								{#each back.steps as step, i (step.uid)}
									<button
										type="button"
										class:fresh={turn(step.uid) !== undefined}
										style:--turn={turn(step.uid)}
										onpointerenter={() => highlight(step.uid)}
										onpointerleave={() => highlight(selection?.uid ?? null)}
										onclick={() => select({ story: back.story, uid: step.uid })}
										>{crumb(step, i, back.name)}</button
									>
									<span
										aria-hidden="true"
										class:fresh={turn(next(step.uid), true) !== undefined}
										style:--turn={turn(next(step.uid), true)}>›</span
									>
								{/each}
							{/if}
							{#each parents.length > SPELT ? [] : loaded.trail.slice(0, -1) as step, i (step.uid)}
								<button
									type="button"
									class:fresh={turn(step.uid) !== undefined}
									style:--turn={turn(step.uid)}
									onpointerenter={() => highlight(step.uid)}
									onpointerleave={() => highlight(selection?.uid ?? null)}
									onclick={() => selection && select({ story: selection.story, uid: step.uid })}
									>{crumb(step, i, story_name(loaded))}</button
								>
								<span
									aria-hidden="true"
									class:fresh={turn(next(step.uid), true) !== undefined}
									style:--turn={turn(next(step.uid), true)}>›</span
								>
							{/each}
						</nav>
					{/if}
					<h2 tabindex="-1" bind:this={title_el}>
						{#if loaded}{#key loaded.blok._uid}<span
									class="now"
									class:fresh={turn(loaded.blok._uid) !== undefined}
									style:--turn={turn(loaded.blok._uid)}
									>{is_page && editor.story?.name
										? editor.story.name
										: component_label(loaded.blok.component)}</span
								>{/key}{:else}<span class="bone title-bone" aria-label="Loading"></span>{/if}
					</h2>
				</div>
				{#if !folded && loaded && loaded.trail.length > 1}
					<div class="actions" role="group" aria-label="Block">
						<button
							type="button"
							class="round"
							aria-label="Move up"
							data-tip="Move up"
							disabled={acting}
							onclick={() => act("move", -1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
						</button>
						<button
							type="button"
							class="round"
							aria-label="Move down"
							data-tip="Move down"
							disabled={acting}
							onclick={() => act("move", 1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
						</button>
						<button
							type="button"
							class="round"
							aria-label="Duplicate"
							data-tip="Duplicate"
							disabled={acting}
							onclick={() => act("duplicate")}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><rect x="8" y="8" width="13" height="13" rx="2" /><path
									d="M4 16V5a1 1 0 0 1 1-1h11"
								/></svg
							>
						</button>
						<button
							type="button"
							class="round danger"
							aria-label="Delete"
							data-tip="Delete"
							disabled={acting}
							onclick={() => act("remove")}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"
								><path
									d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"
								/></svg
							>
						</button>
					</div>
				{/if}
				{#if !folded && editor.space && selection}
					<!-- the way out for anything these settings fall short on: no Storyblok address opens
					     a block, so the story it's in -->
					<a
						class="round"
						href="https://app.storyblok.com/#/me/spaces/{editor.space}/stories/0/0/{selection.story}"
						target="_blank"
						rel="noopener noreferrer"
						aria-label="Edit in Storyblok"
						data-tip="Edit in Storyblok"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
					</a>
				{/if}
				<button
					type="button"
					class="round fold"
					aria-expanded={!folded}
					aria-controls="storyloco-settings"
					aria-label={folded ? "Open the settings" : "Fold the settings"}
					data-tip={folded ? undefined : "Fold the settings · S"}
					bind:this={fold_el}
					onclick={() => toggle()}
				>
					<!-- arrows apart to open, together to fold, whichever edge it's on -->
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d={folded ? "m7 15 5 5 5-5M7 9l5-5 5 5" : "m7 20 5-5 5 5M7 4l5 5 5-5"} /></svg
					>
					<!-- folded, its ::after is the whole pill to press, so its tip is an element of its own,
					     placed from one the size of the button, which the pill's placed from, can't be -->
					{#if folded}<span class="anchor" aria-hidden="true"
							><span class="tip">Open the settings · S</span></span
						>{/if}
				</button>
			</div>
			{#if !folded && elsewhere}
				<!-- a quiet note: the name of the story it's from, which opens it; the why is in the tooltip -->
				<button
					type="button"
					class="elsewhere"
					title="From {elsewhere.name}, so changes show wherever it appears. Click to open it."
					onclick={() => elsewhere && location.assign(`/${elsewhere.full_slug}`)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path
							d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
						/></svg
					>
					<span>{elsewhere.name}</span>
				</button>
			{/if}
			{#if !folded && groups.length > 1}
				<div class="tabs" role="tablist">
					{#each groups as group (group.name)}
						<button
							type="button"
							role="tab"
							aria-selected={current?.name === group.name}
							onclick={() => (tab = group.name)}>{group.name}</button
						>
					{/each}
				</div>
			{/if}
		</header>

		{#if !folded}
			<div class="body" id="storyloco-settings">
				{#if problem}
					<p class="state bad" role="alert">{problem}</p>
				{:else if !loaded || !component}
					<!-- shaped like the fields it becomes, so nothing jumps when they arrive -->
					<div class="fields skeleton" aria-busy="true" aria-label="Loading the block’s fields">
						{#each [7, 10, 5, 8] as width, i (i)}
							<div class="sl-field">
								<span class="bone" style:inline-size="{width}rem"></span>
								<span class="bone input" class:tall={i === 1}></span>
							</div>
						{/each}
					</div>
				{:else if current}
					{#key `${loaded.blok._uid}:${current.name}`}
						<div class="fields" in:pass out:pass={{ leaving: true }}>
							{#each current.fields as [key, field] (key)}
								{@render Control(key, field)}
							{/each}
						</div>
					{/key}
				{:else}
					<p class="help">This block has no fields.</p>
				{/if}
			</div>
		{/if}
	</aside>
{/if}

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.inspector) :not(svg, svg *) {
		all: revert;
	}

	/* reverting drops the browser's own hiding of [hidden] too, so it's put back */
	:where(.inspector) [hidden] {
		display: none;
	}

	/* In the edit bar's slot: its name there while folded, the bar's panel when open */
	.inspector {
		/* light or dark as the person prefers, whatever scheme the site uses */
		color-scheme: light dark;

		--bg: var(--editor-bg, #fff);
		--ink: var(--editor-ink, #1b243f);
		--muted: var(--editor-muted, #6b7280);
		--line: var(--editor-line, rgb(27 36 63 / 0.12));
		--accent: var(--editor-accent, #05807f);
		--danger: var(--editor-danger, #e5484d);
		--field: color-mix(in srgb, var(--ink) 4%, transparent);
		/* focused, a field deepens a little into the glass, rather than turning solid */
		--field-focus: color-mix(in srgb, var(--bg) 55%, transparent);

		block-size: 100%;
		color: var(--ink);
		display: grid;
		font:
			400 0.8125rem/1.4 system-ui,
			sans-serif;
		flex: 1;
		grid-template-rows: auto minmax(0, 1fr);
		min-inline-size: 0;
		overflow: hidden;

		& * {
			box-sizing: border-box;
		}

		& :is(h2, p, ol, ul) {
			margin: 0;
		}

		& :is(ol, ul) {
			list-style: none;
			padding: 0;
		}

		& li::before {
			content: none;
		}
	}

	/* Folded: the block's name and a button to open it, beside the badge */
	.inspector.folded {
		grid-template-rows: auto;
		/* its button's tip opens out of it; a long name's still cut short, by the name itself */
		min-inline-size: 0;
		overflow: visible;
		position: relative;

		& header {
			border: 0;
			padding: 0 0 0 0.625rem;
		}

		& .title {
			gap: 0.375rem;
		}

		& h2 {
			font-size: 0.8125rem;
			min-inline-size: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* the name opens it too */
		& .fold::after {
			content: "";
			inset: 0;
			position: absolute;
		}
	}

	/* the open panel's top is a handle for the whole bar, as the badge is: dragged to another corner */
	.inspector:not(.folded) header {
		cursor: grab;
		touch-action: none;
		user-select: none;

		&:active {
			cursor: grabbing;
		}
	}

	header {
		border-block-end: 1px solid var(--line);
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 0.875rem 0 1rem;
	}

	/* the way to it and its name on one line, always: when the way's long, as with a page's long
	   name, its steps are cut short with an ellipsis, the longest giving up the most, and the block's
	   own name is the last to be */
	.name {
		align-items: baseline;
		display: flex;
		flex: 1;
		/* as far from the last arrow as a step's own padding and gap put it from its arrow */
		gap: 0 0.375rem;
		min-inline-size: 0;
	}

	/* a step that's new to the line, and the name at its end, come in from the way things went:
	   deeper from the right, back from the left */
	.trail > .fresh,
	.now.fresh {
		animation: storyloco-crumb 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
		animation-delay: calc(var(--turn, 0) * 70ms);
	}

	.now {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* folded, a long name's cut short with an ellipsis, which only text in the line gets */
	.inspector.folded .now {
		display: inline;
	}

	@keyframes storyloco-crumb {
		from {
			opacity: 0;
			translate: calc(var(--way, 1) * 0.5rem) 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.trail > .fresh,
		.now.fresh {
			animation: none;
		}
	}

	/* its buttons' padding is room to press, not an indent: the first starts where the title would */
	.trail {
		align-items: baseline;
		color: var(--muted);
		display: flex;
		flex: 0 1 auto;
		font-size: 0.875rem;
		gap: 0.25rem;
		margin-inline-start: -0.125rem;
		min-inline-size: 0;

		& > span {
			flex: none;
		}

		& button {
			background: none;
			border: 0;
			border-radius: 0.25rem;
			color: inherit;
			cursor: pointer;
			flex: 0 1 auto;
			font: inherit;
			/* room for a letter or two and the ellipsis, however many steps there are */
			min-inline-size: 2.5ch;
			overflow: hidden;
			padding: 0 0.125rem;
			text-overflow: ellipsis;
			white-space: nowrap;

			&:hover {
				color: var(--ink);
				text-decoration: underline;
			}
		}

		/* the steps folded into one: an ellipsis to press, as wide as that and not as its longest step */
		& select {
			appearance: none;
			background: none;
			border: 0;
			border-radius: 0.25rem;
			color: inherit;
			cursor: pointer;
			flex: none;
			font: inherit;
			font-weight: 600;
			inline-size: 1.75rem;
			padding: 0 0.125rem;
			text-align: center;

			&:hover {
				background: color-mix(in srgb, var(--ink) 10%, transparent);
				color: var(--ink);
			}
		}
	}

	.title {
		align-items: center;
		display: flex;
		justify-content: space-between;
		/* no wider than the panel, whatever's in it: its line gives way, not its buttons */
		min-inline-size: 0;

		& > :not(.name) {
			flex: none;
		}

		& h2 {
			flex: 0 0 auto;
			font-size: 0.875rem;
			font-weight: 600;
			max-inline-size: 100%;
			min-inline-size: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.title .actions {
		display: flex;
		margin-inline: auto 0.25rem;

		& .danger:hover {
			color: var(--danger);
		}

		& :disabled {
			opacity: 0.4;
		}
	}

	.elsewhere {
		align-items: center;
		background: none;
		border: 0;
		color: var(--muted);
		cursor: pointer;
		display: flex;
		font: inherit;
		font-size: 0.75rem;
		gap: 0.3125rem;
		justify-self: start;
		margin-block-start: -0.25rem;
		max-inline-size: 100%;
		padding: 0;

		& span {
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		& svg {
			block-size: 0.75rem;
			fill: none;
			flex: none;
			inline-size: 0.75rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-width: 2;
		}

		&:hover {
			color: var(--accent);
		}
	}

	.tabs {
		display: flex;
		gap: 1rem;
		margin-block-end: -1px;
		overflow-x: auto;

		& button {
			background: none;
			border: 0;
			border-block-end: 2px solid transparent;
			color: var(--muted);
			cursor: pointer;
			font: inherit;
			font-weight: 500;
			padding: 0.25rem 0 0.5rem;
			white-space: nowrap;

			&[aria-selected="true"] {
				border-color: var(--accent);
				color: var(--ink);
			}
		}
	}

	header:not(:has(.tabs)) {
		padding-block-end: 0.875rem;
	}

	.body {
		/* one place for whatever it shows, so a block's fields arriving are beside the ones leaving
		   rather than under them; and nothing sideways to scroll to as they pass */
		align-content: start;
		display: grid;
		overflow: hidden auto;
		overscroll-behavior: contain;
		padding: 1rem;

		& > * {
			/* each as tall as itself: stretched to the taller of two passing, a short one's fields
			   would be spread out down it, and snap back together as the tall one went */
			align-self: start;
			grid-area: 1 / 1;
			min-inline-size: 0;
		}
	}

	.fields {
		display: grid;
		gap: 1.125rem;
	}

	@keyframes fade {
		from {
			opacity: 0;
			translate: 0 0.25rem;
		}
	}

	.sl-field {
		display: grid;
		gap: 0.375rem;

		/* typed in on the page: its label and box in the accent, quietly */
		&.on-page {
			& .head label {
				color: var(--accent);
			}

			& :is(input:not([type="checkbox"]), textarea, select, .rich) {
				border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
			}
		}
	}

	.head,
	.switch-row {
		align-items: center;
		display: flex;
		gap: 0.5rem;

		& label {
			font-weight: 500;
		}
	}

	.switch-row {
		& label {
			flex: 1;
		}
	}

	.required {
		color: var(--danger);
		margin-inline-start: 0.125rem;
	}

	.help {
		color: var(--muted);
		font-size: 0.75rem;
	}

	.state {
		align-items: center;
		color: var(--muted);
		display: inline-flex;
		font-size: 0.75rem;
		margin-inline-start: auto;

		&.bad {
			color: var(--danger);
		}
	}

	.spinner {
		animation: spin 0.8s linear infinite;
		block-size: 0.75rem;
		border: 2px solid var(--line);
		border-block-start-color: var(--accent);
		border-radius: 50%;
		inline-size: 0.75rem;
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}

	input:not([type="checkbox"]),
	textarea,
	select {
		background-color: var(--field);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		color: inherit;
		font: inherit;
		inline-size: 100%;
		outline: 3px solid transparent;
		padding: 0.5rem 0.625rem;
		transition:
			border-color 0.2s,
			background-color 0.2s,
			outline-color 0.2s;

		&:hover {
			border-color: var(--line);
		}

		&:focus-visible {
			background-color: var(--field-focus);
			border-color: var(--accent);
			outline: 3px solid color-mix(in srgb, var(--accent) 18%, transparent);
		}
	}

	/* our own chevron, inset like the field's text, where the native one hugs the edge */
	select {
		appearance: none;
		/* the chevron's two strokes, meeting at the bottom */
		background-image:
			linear-gradient(
				45deg,
				transparent calc(50% - 0.75px),
				var(--muted) calc(50% - 0.75px) calc(50% + 0.75px),
				transparent calc(50% + 0.75px)
			),
			linear-gradient(
				-45deg,
				transparent calc(50% - 0.75px),
				var(--muted) calc(50% - 0.75px) calc(50% + 0.75px),
				transparent calc(50% + 0.75px)
			);
		background-position:
			calc(100% - 15px) 50%,
			calc(100% - 10px) 50%;
		background-repeat: no-repeat;
		background-size: 5px 5px;
		cursor: pointer;
		padding-inline-end: 2rem;

		&:disabled {
			cursor: default;
		}
	}

	textarea {
		field-sizing: content;
		max-block-size: 16rem;
		min-block-size: 4.5rem;
		resize: vertical;
	}

	.switch {
		appearance: none;
		background: color-mix(in srgb, var(--ink) 18%, transparent);
		block-size: 1.25rem;
		border-radius: 999px;
		cursor: pointer;
		flex: none;
		inline-size: 2.125rem;
		margin: 0;
		position: relative;
		transition: background-color 0.2s;

		&::after {
			background: #fff;
			block-size: 1rem;
			border-radius: 50%;
			box-shadow: 0 1px 2px rgb(0 0 0 / 0.25);
			content: "";
			inline-size: 1rem;
			inset: 0.125rem auto auto 0.125rem;
			position: absolute;
			transition: translate 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
		}

		&:checked {
			background: var(--accent);

			&::after {
				translate: 0.875rem 0;
			}
		}

		&:focus-visible {
			outline: 3px solid color-mix(in srgb, var(--accent) 30%, transparent);
		}
	}

	.checks {
		display: grid;
		gap: 0.25rem;
		max-block-size: 14rem;
		overflow: auto;
	}

	.check {
		align-items: center;
		display: flex;
		gap: 0.5rem;

		/* set out in full, since a site's own checkbox rules can be as specific as the reset */
		& input {
			accent-color: var(--accent);
			appearance: auto;
			background: none;
			block-size: 0.9375rem;
			border: revert;
			flex: none;
			inline-size: 0.9375rem;
			margin: 0;
			padding: 0;
		}

		&.small {
			color: var(--muted);
			font-size: 0.75rem;
		}
	}

	.row {
		display: flex;
		gap: 0.375rem;

		& .level {
			flex: none;
			inline-size: 5rem;
		}
	}

	.group {
		display: grid;
		gap: 0.5rem;
	}

	.sub {
		display: grid;
		gap: 0.25rem;

		& span {
			color: var(--muted);
			font-size: 0.75rem;
		}
	}

	.asset {
		display: grid;
		gap: 0.5rem;

		& img {
			background: repeating-conic-gradient(rgb(0 0 0 / 0.05) 0 25%, transparent 0 50%) 0 0 / 12px
				12px;
			border-radius: 0.5rem;
			max-block-size: 9rem;
			max-inline-size: 100%;
			object-fit: contain;
		}
	}

	.asset-actions {
		display: flex;
		gap: 0.375rem;
	}

	/* an asset field's image, the panel's width, its buttons over the corner on hover or focus */
	.picture {
		position: relative;

		& img {
			background: repeating-conic-gradient(rgb(0 0 0 / 0.05) 0 25%, transparent 0 50%) 0 0 / 12px
				12px;
			block-size: auto;
			border-radius: 0.5rem;
			display: block;
			inline-size: 100%;
			max-block-size: 16rem;
			object-fit: contain;
		}

		& .file {
			background: var(--field);
			border-radius: 0.5rem;
			display: block;
			padding: 0.75rem 5.5rem 0.75rem 0.75rem;
		}

		& .over {
			display: flex;
			gap: 0.25rem;
			inset: 0.5rem 0.5rem auto auto;
			opacity: 0;
			position: absolute;
			transition: opacity 0.15s;
		}

		&:is(:hover, :focus-within) .over {
			opacity: 1;
		}

		/* no hover to bring them out on touch */
		@media (hover: none) {
			& .over {
				opacity: 1;
			}
		}

		& .over button {
			backdrop-filter: blur(12px) saturate(1.6);
			background: color-mix(in srgb, var(--bg) 72%, transparent);
			block-size: 2rem;
			border: 0;
			border-radius: 50%;
			box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
			color: var(--ink);
			cursor: pointer;
			display: grid;
			inline-size: 2rem;
			padding: 0;
			place-items: center;
			position: relative;
			transition: background-color 0.15s;

			&:hover {
				background: color-mix(in srgb, var(--bg) 92%, transparent);
			}

			/* the edit bar's tooltip, beneath the button */
			& .tip {
				background-color: var(--ink);
				border-radius: 0.5rem;
				color: var(--bg);
				font-size: 0.75rem;
				font-weight: 500;
				inset: calc(100% + 0.5rem) auto auto 50%;
				opacity: 0;
				padding: 0.375rem 0.5rem;
				pointer-events: none;
				position: absolute;
				transition:
					opacity 0.2s ease,
					translate 0.2s ease;
				translate: -50% -0.25rem;
				white-space: nowrap;
				z-index: 1;

				&::after {
					background-color: inherit;
					block-size: 0.3125rem;
					clip-path: polygon(50% 0, 100% 100%, 0 100%);
					content: "";
					inline-size: 0.625rem;
					inset: auto auto 100% calc(50% - 0.3125rem);
					position: absolute;
				}
			}

			&:is(:hover, :focus-visible) .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: -50% 0;
			}

			&:focus-visible .tip {
				transition-delay: 0s;
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
	}

	/* the image's alt text, and AI to write it */
	.alt {
		margin-block-start: 0.375rem;
		position: relative;

		& input {
			font-size: 0.8125rem;
			padding-inline-end: 2.5rem;
		}

		& .ai {
			background: none;
			block-size: 1.75rem;
			border: 0;
			border-radius: 0.375rem;
			color: var(--muted);
			cursor: pointer;
			display: grid;
			inline-size: 1.75rem;
			inset: 50% 0.3125rem auto auto;
			padding: 0;
			place-items: center;
			position: absolute;
			translate: 0 -50%;
			transition:
				background-color 0.15s,
				color 0.15s;

			&:hover:not(:disabled) {
				background: color-mix(in srgb, var(--ink) 10%, transparent);
				color: var(--accent);
			}

			&.busy {
				animation: pulse 1.4s ease-in-out infinite;
				color: var(--accent);
				cursor: wait;
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

			& .tip {
				background-color: var(--ink);
				border-radius: 0.5rem;
				color: var(--bg);
				font-size: 0.75rem;
				font-weight: 500;
				inset: auto 0 calc(100% + 0.5rem) auto;
				opacity: 0;
				padding: 0.375rem 0.5rem;
				pointer-events: none;
				position: absolute;
				transition:
					opacity 0.2s ease,
					translate 0.2s ease;
				translate: 0 0.25rem;
				white-space: nowrap;
				z-index: 1;

				&::after {
					background-color: inherit;
					block-size: 0.3125rem;
					clip-path: polygon(0 0, 100% 0, 50% 100%);
					content: "";
					inline-size: 0.625rem;
					inset: 100% 0.5625rem auto auto;
					position: absolute;
				}
			}

			&:is(:hover, :focus-visible) .tip {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}

			&:focus-visible .tip {
				transition-delay: 0s;
			}
		}
	}

	/* a theme's colours beside its name */
	.swatches {
		align-items: center;
		display: flex;
		flex: none;

		& span {
			block-size: 1.25rem;
			border-radius: 50%;
			box-shadow: 0 0 0 2px var(--field-focus);
			inline-size: 1.25rem;

			& + span {
				margin-inline-start: -0.375rem;
			}
		}
	}

	/* a date: its start, then its end, beside the button that takes it out */
	.dates {
		display: grid;
		gap: 0.25rem;
		grid-template-columns: 1fr 6rem auto;

		& input[type="date"]:last-of-type {
			grid-column: 1;
		}
	}

	/* a floor of a plan: its name, its plan, its rooms */
	.floor {
		border-inline-start: 2px solid var(--line);
		display: grid;
		gap: 0.375rem;
		padding-inline-start: 0.625rem;
	}

	/* a room's name, then its sizes beneath, wide enough to read whole */
	.room {
		display: grid;
		gap: 0.25rem;
		grid-template-columns: 1fr 1fr auto;

		& input:first-child {
			grid-column: 1 / 3;
		}

		& button {
			grid-area: 1 / 3;
		}
	}

	.floor > .button {
		justify-self: start;
	}

	.group > .row > .button {
		flex: none;
		white-space: nowrap;
	}

	.readonly.out {
		align-items: center;
		color: var(--ink);
		display: flex;
		gap: 0.375rem;
		justify-content: space-between;
		text-decoration: none;

		& svg {
			block-size: 1rem;
			fill: none;
			inline-size: 1rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-width: 2;
		}

		&:hover {
			background: color-mix(in srgb, var(--ink) 8%, transparent);
		}
	}

	.file {
		background: var(--field);
		border-radius: 0.5rem;
		display: block;
		font-size: 0.75rem;
		overflow: hidden;
		padding: 0.5rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assets {
		display: grid;
		gap: 0.375rem;
		grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));

		& li {
			aspect-ratio: 1;
			position: relative;
		}

		& img {
			block-size: 100%;
			border-radius: 0.5rem;
			inline-size: 100%;
			object-fit: cover;
		}

		& .tools {
			background: rgb(0 0 0 / 0.55);
			border-radius: 999px;
			display: flex;
			inset: auto 0.25rem 0.25rem;
			justify-content: space-between;
			opacity: 0;
			position: absolute;
			transition: opacity 0.15s;

			& button {
				background: none;
				border: 0;
				color: #fff;
				cursor: pointer;
				font: inherit;
				padding: 0 0.375rem;

				&:disabled {
					opacity: 0.35;
				}
			}
		}

		& li:is(:hover, :focus-within) .tools {
			opacity: 1;
		}
	}

	.add-tile {
		background: var(--field);
		block-size: 100%;
		border: 1px dashed var(--line);
		border-radius: 0.5rem;
		color: var(--muted);
		cursor: pointer;
		font: inherit;
		inline-size: 100%;

		&:hover {
			color: var(--ink);
		}
	}

	.segmented {
		background: var(--field);
		border-radius: 0.5rem;
		display: flex;
		padding: 0.1875rem;

		& button {
			background: none;
			border: 0;
			border-radius: 0.375rem;
			color: var(--muted);
			cursor: pointer;
			flex: 1;
			font: inherit;
			font-weight: 500;
			padding: 0.25rem;

			&.on {
				background: color-mix(in srgb, var(--ink) 12%, transparent);
				box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
				color: var(--ink);
			}
		}
	}

	.combo {
		position: relative;
	}

	.results,
	.adding ul {
		backdrop-filter: blur(20px) saturate(1.8);
		background: color-mix(in srgb, var(--bg) 85%, transparent);
		border-radius: 0.5rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 8px 24px rgb(0 0 0 / 0.12);
		margin-block-start: 0.25rem;
		max-block-size: 14rem;
		overflow: auto;
		padding: 0.25rem;

		& button {
			background: none;
			border: 0;
			border-radius: 0.375rem;
			color: inherit;
			cursor: pointer;
			display: grid;
			font: inherit;
			inline-size: 100%;
			padding: 0.375rem 0.5rem;
			text-align: start;

			&:hover {
				background: var(--field);
			}

			& span {
				color: var(--muted);
				font-size: 0.75rem;
			}
		}
	}

	.results {
		inset-inline: 0;
		position: absolute;
		z-index: 1;

		/* a story the field already holds; choosing it again takes it out */
		& .on {
			background: var(--wash);

			& strong::after {
				color: var(--accent);
				content: " ✓";
			}
		}

		& .more {
			color: var(--accent);
			font-weight: 500;
		}
	}

	.kids.picks {
		margin-block-end: 0.375rem;

		& .pick {
			display: grid;
			flex: 1;
			min-inline-size: 0;
			padding: 0.4375rem 0.625rem;
		}

		/* one that's a way in: its name and path, and a chevron at the end as a block's row has */
		& button.pick {
			background: none;
			border: 0;
			color: inherit;
			column-gap: 0.25rem;
			cursor: pointer;
			font: inherit;
			grid-template-columns: minmax(0, 1fr) auto;
			text-align: start;

			&:disabled {
				cursor: progress;
				opacity: 0.6;
			}

			& svg {
				align-self: center;
				block-size: 0.875rem;
				fill: none;
				grid-area: 1 / 2 / span 2;
				inline-size: 0.875rem;
				stroke: var(--muted);
				stroke-linecap: round;
				stroke-linejoin: round;
				stroke-width: 2;
			}
		}

		& .pick {
			& > * {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			& small {
				color: var(--muted);
				font-size: 0.75rem;
			}
		}

		& .grip {
			padding-inline: 0.5rem 0;
		}

		& .grip + .pick {
			padding-inline-start: 0.5rem;
		}

		/* in the row, so a long path stops short of it rather than running under */
		& .tools {
			margin-inline-end: 0.375rem;
			position: static;
		}
	}

	.adding {
		display: grid;
		gap: 0.25rem;

		& .find {
			align-items: center;
			display: flex;
			gap: 0.25rem;

			& input {
				flex: 1;
				min-inline-size: 0;
			}
		}
	}

	.rich {
		&[data-waiting] {
			color: var(--muted);
			cursor: wait;
			white-space: pre-line;
		}

		/* the format bar to come, its buttons pulsing until the editor is ready */
		& :global(.format-bones) {
			border-block-end: 1px solid var(--line);
			display: flex;
			flex: none;
			gap: 2px;
			margin: -0.375rem -0.625rem 0.25rem;
			padding: 4px 6px;
		}

		& :global(.format-bones span) {
			animation: pulse 1.4s ease-in-out infinite;
			background: color-mix(in srgb, currentColor 16%, transparent);
			block-size: 0.875rem;
			border-radius: 0.25rem;
			inline-size: 1rem;
			margin: 0.4375rem 0.375rem;
		}

		& :global(.format-bones .wide) {
			inline-size: 3rem;
		}

		& :global(.words) {
			margin-block: 0.5em;
			min-block-size: 3.5rem;
		}

		background: var(--field);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		/* the format bar stays along the top, and only the text beneath it scrolls */
		display: flex;
		flex-direction: column;
		max-block-size: 22rem;
		outline: 3px solid transparent;
		overflow: hidden;
		padding: 0.375rem 0.625rem 0.5rem;
		/* into focus gently, as the inputs do, rather than snapping darker */
		transition:
			border-color 0.2s,
			background-color 0.2s,
			outline-color 0.2s;

		&:focus-within {
			background-color: var(--field-focus);
			border-color: var(--accent);
			outline: 3px solid color-mix(in srgb, var(--accent) 18%, transparent);
		}

		& :global(.ProseMirror) {
			min-block-size: 4.5rem;
			overflow: auto;
		}

		& :global(:is(p, h2, h3, ul, ol, blockquote)) {
			all: revert;
			margin-block: 0.5em;
		}

		& :global(a) {
			all: revert;
			color: var(--accent);
		}
	}

	.video {
		display: grid;
		gap: 0.5rem;

		& figure {
			border-radius: 0.5rem;
			margin: 0;
			overflow: hidden;
			position: relative;
		}

		& figure img {
			aspect-ratio: 16 / 9;
			display: block;
			inline-size: 100%;
			object-fit: cover;
		}

		& figcaption {
			background: linear-gradient(transparent, rgb(0 0 0 / 0.65));
			color: #fff;
			display: flex;
			font-size: 0.75rem;
			inset: auto 0 0;
			justify-content: space-between;
			padding: 1.5rem 0.625rem 0.5rem;
			position: absolute;
		}
	}

	.progress {
		display: grid;
		font-size: 0.75rem;
		gap: 0.375rem;

		& .track {
			background: var(--field);
			block-size: 0.375rem;
			border-radius: 999px;
			display: block;
			overflow: hidden;
		}

		& .track span {
			background: var(--accent);
			block-size: 100%;
			display: block;
			transition: inline-size 0.2s ease;
		}

		& .indeterminate {
			animation: pulse 1.2s ease-in-out infinite;
		}
	}

	.library {
		display: grid;
		gap: 0.375rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		max-block-size: 18rem;
		overflow: auto;

		& button {
			background: none;
			border: 0;
			border-radius: 0.5rem;
			color: inherit;
			cursor: pointer;
			display: grid;
			font: inherit;
			font-size: 0.75rem;
			gap: 0.25rem;
			padding: 0;
			text-align: start;

			&:hover img {
				outline: 2px solid var(--accent);
			}
		}

		& img {
			aspect-ratio: 16 / 9;
			border-radius: 0.375rem;
			inline-size: 100%;
			object-fit: cover;
		}

		& span {
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.toggles {
		display: flex;
		gap: 0.875rem;
	}

	.table {
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		overflow-x: auto;

		& table {
			border-collapse: collapse;
			inline-size: 100%;
		}

		& th,
		& td {
			border-block-end: 1px solid var(--line);
			padding: 0.25rem;
			vertical-align: middle;
		}

		& tr:last-child td {
			border-block-end: 0;
		}

		& th {
			white-space: nowrap;

			& input {
				font-weight: 600;
				inline-size: calc(100% - 1.75rem);
			}
		}

		& input:not([type="checkbox"]) {
			min-inline-size: 6.5rem;
			padding: 0.375rem 0.5rem;
		}

		& .round {
			display: inline-grid;
			vertical-align: middle;
		}

		& .edge {
			inline-size: 1.75rem;
		}
	}

	.table-actions {
		display: flex;
		gap: 0.375rem;
	}

	.readonly {
		background: var(--field);
		border-radius: 0.5rem;
		color: var(--muted);
		padding: 0.5rem 0.625rem;
	}

	.kids {
		display: grid;
		gap: 0.25rem;

		/* where a block's being chosen for the gap it's in: not a row, so none of a row's look */
		& li.chooser {
			background: none;
			display: block;
			padding-block: 0.25rem;
		}

		/* across the gap after a row, and a little of the rows either side so it's not a sliver to hit:
		   a line through the gap and a + on it, there once the pointer's between the two */
		& .between {
			background: none;
			block-size: 0.875rem;
			border: 0;
			cursor: pointer;
			display: grid;
			inset: calc(100% - 0.3125rem) 0 auto;
			opacity: 0;
			padding: 0;
			place-items: center;
			position: absolute;
			transition: opacity 0.15s ease;
			z-index: 1;

			&::before {
				background: var(--accent);
				block-size: 2px;
				border-radius: 1px;
				content: "";
				grid-area: 1 / 1;
				inline-size: 100%;
			}

			& svg {
				background: var(--accent);
				block-size: 1rem;
				border-radius: 50%;
				box-sizing: border-box;
				fill: none;
				grid-area: 1 / 1;
				inline-size: 1rem;
				padding: 0.1875rem;
				stroke: var(--editor-accent-ink, #fff);
				stroke-linecap: round;
				stroke-width: 3;
			}

			&:hover,
			&:focus-visible {
				opacity: 1;
			}
		}

		/* a row being dragged past the gaps isn't adding to them */
		& .shifting .between {
			display: none;
		}

		& li {
			align-items: center;
			background: var(--field);
			border-radius: 0.5rem;
			display: flex;
			position: relative;
		}

		& .kid {
			align-items: center;
			background: none;
			border: 0;
			color: inherit;
			cursor: pointer;
			display: flex;
			flex: 1;
			font: inherit;
			gap: 0.25rem;
			justify-content: space-between;
			padding: 0.5rem 0.625rem;
			text-align: start;

			& svg {
				block-size: 0.875rem;
				fill: none;
				inline-size: 0.875rem;
				stroke: var(--muted);
				stroke-width: 2;
				transition: opacity 0.15s;
			}
		}

		/* over the end of the row on hover, where the chevron is at rest, so the chevron sits at the edge */
		& .tools {
			align-items: center;
			display: flex;
			inset-block: 0;
			inset-inline-end: 0;
			opacity: 0;
			padding-inline: 0.25rem;
			pointer-events: none;
			position: absolute;
			transition: opacity 0.15s;

			& button {
				background: none;
				border: 0;
				border-radius: 0.25rem;
				color: var(--muted);
				cursor: pointer;
				block-size: 1.5rem;
				display: grid;
				font: inherit;
				inline-size: 1.5rem;
				padding: 0;
				place-items: center;

				& svg {
					block-size: 1rem;
					inline-size: 1rem;
				}

				&:hover:not(:disabled) {
					background: color-mix(in srgb, var(--ink) 10%, transparent);
					color: var(--ink);
				}

				&:disabled {
					opacity: 0.35;
				}
			}
		}

		& li:is(:hover, :focus-within) .tools {
			opacity: 1;
			pointer-events: auto;
		}

		& li:is(:hover, :focus-within) .kid {
			/* a long name stops short of the tools rather than running under them */
			padding-inline-end: 7rem;

			/* gone at once: fading, it would show as it jumps clear of the tools */
			& svg {
				opacity: 0;
				transition: none;
			}
		}

		& .kid small {
			color: var(--muted);
			font: inherit;
			margin-inline-start: 0.375rem;
		}

		& .kid span {
			min-inline-size: 0;
			margin-block: -0.15em;
			overflow: hidden;
			padding-block: 0.15em;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		& .grip {
			align-self: stretch;
			color: var(--muted);
			cursor: grab;
			display: grid;
			flex: none;
			opacity: 0.4;
			padding-inline: 0.375rem 0;
			place-items: center;
			touch-action: none;
			transition: opacity 0.15s;

			& svg {
				block-size: 0.875rem;
				fill: currentColor;
				inline-size: 0.875rem;
			}

			& + .kid {
				padding-inline-start: 0.25rem;
			}
		}

		& li:hover .grip {
			opacity: 1;
		}

		& li.shifting {
			transition: translate 0.15s ease;
			user-select: none;
		}

		& li.lifted {
			box-shadow: 0 0.25rem 0.75rem rgb(0 0 0 / 0.18);
			transition: none;
			z-index: 1;

			& .grip {
				cursor: grabbing;
				opacity: 1;
			}
		}
	}

	.button {
		background: var(--field);
		border: 1px solid var(--line);
		border-radius: 999px;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 500;
		padding: 0.375rem 0.875rem;

		&:hover {
			border-color: color-mix(in srgb, var(--ink) 30%, transparent);
		}

		&.quiet {
			background: none;
		}

		&.add {
			justify-self: start;
		}
	}

	/* the edit bar's tips, for the panel's own buttons: below them, as the panel's top edge is just
	   above, and from their trailing edge, as they're at the panel's. A row's tools say what's in
	   their label; the header's, which say more than theirs, what's in `data-tip` */
	.round[data-tip],
	.tools button[aria-label] {
		position: relative;

		&::after {
			background: var(--ink);
			border-radius: 0.5rem;
			color: var(--bg);
			content: attr(aria-label);
			font-size: 0.75rem;
			font-weight: 500;
			/* a little past the button's edge, so its arrow is clear of its rounded corner */
			inset: calc(100% + 0.5rem) -0.25rem auto auto;
			padding: 0.5rem 0.625rem;
			white-space: nowrap;
		}

		/* its arrow, as the bar's tips have, pointing up at the middle of the button */
		&::before {
			background: var(--ink);
			block-size: 0.3125rem;
			clip-path: polygon(50% 0, 100% 100%, 0 100%);
			content: "";
			inline-size: 0.625rem;
			inset: calc(100% + 0.1875rem + 1px) auto auto calc(50% - 0.3125rem);
		}

		&::before,
		&::after {
			opacity: 0;
			pointer-events: none;
			position: absolute;
			transition:
				opacity 0.2s ease,
				translate 0.2s ease;
			translate: 0 -0.25rem;
			z-index: 2;
		}

		&:focus-visible::before,
		&:focus-visible::after {
			opacity: 1;
			translate: 0 0;
		}

		/* only where there's hover: on touch, a tap shows a tip and the press doesn't land */
		@media (hover: hover) {
			&:hover::before,
			&:hover::after {
				/* a moment's wait, so passing over doesn't set every tip off; gone at once */
				transition-delay: 0.35s;
				opacity: 1;
				translate: 0 0;
			}
		}
	}

	.round[data-tip]::after {
		content: attr(data-tip);
	}

	/* the folded pill's tip, as the bar's own beside it: away from the screen's edge the pill is at,
	   its arrow over the button */
	/* over the button's icon, the size of the button */
	.fold :is(svg, .anchor) {
		grid-area: 1 / 1;
	}

	.fold .anchor {
		pointer-events: none;
		place-self: stretch;
		position: relative;
	}

	.fold .tip {
		background: var(--ink);
		border-radius: 0.5rem;
		color: var(--bg);
		font-size: 0.75rem;
		font-weight: 500;
		inset: auto auto calc(100% + 0.75rem) calc(50% - 0.9375rem);
		opacity: 0;
		padding: 0.5rem 0.625rem;
		pointer-events: none;
		position: absolute;
		transition:
			opacity 0.2s ease,
			translate 0.2s ease;
		translate: 0 0.25rem;
		white-space: nowrap;
		z-index: 2;

		&::after {
			background: inherit;
			block-size: 0.3125rem;
			clip-path: polygon(0 0, 100% 0, 50% 100%);
			content: "";
			inline-size: 0.625rem;
			inset: 100% auto auto 0.625rem;
			position: absolute;
		}

		:global([data-corner^="t"]) & {
			inset: calc(100% + 0.75rem) auto auto calc(50% - 0.9375rem);
			translate: 0 -0.25rem;

			&::after {
				clip-path: polygon(50% 0, 100% 100%, 0 100%);
				inset: auto auto 100% 0.625rem;
			}
		}
	}

	.fold:focus-visible .tip {
		opacity: 1;
		translate: 0 0;
	}

	@media (hover: hover) {
		.fold:hover .tip {
			/* a moment's wait, so passing over doesn't set every tip off; gone at once */
			transition-delay: 0.35s;
			opacity: 1;
			translate: 0 0;
		}
	}

	/* a row's tip opens over the row beneath, which would otherwise be drawn on top of it */
	.kids li:is(:hover, :focus-within) {
		z-index: 2;
	}

	.round {
		background: none;
		/* one that's a link is a button to look at: no underline, on it or on its tip */
		text-decoration: none;
		block-size: 1.75rem;
		border: 0;
		border-radius: 50%;
		color: var(--muted);
		cursor: pointer;
		display: grid;
		inline-size: 1.75rem;
		place-items: center;

		&:hover {
			background: var(--field);
			color: var(--ink);
		}

		& svg {
			block-size: 1rem;
			fill: none;
			inline-size: 1rem;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-width: 2;
		}
	}

	.bone {
		animation: pulse 1.2s ease-in-out infinite;
		background: color-mix(in srgb, var(--ink) 7%, transparent);
		block-size: 0.875rem;
		border-radius: 0.375rem;
		display: block;

		&.input {
			block-size: 2.25rem;
			inline-size: 100%;
		}

		&.tall {
			block-size: 4.5rem;
		}
	}

	.title-bone {
		block-size: 1.25rem;
		inline-size: 7rem;
	}

	.skeleton {
		animation: none;
	}

	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}

	:is(.tools, .assets .tools) svg {
		block-size: 0.875rem;
		display: block;
		fill: none;
		inline-size: 0.875rem;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 2;
	}

	/* No hover on touch: the tools that wait for it stay out */
	@media (hover: none) {
		.kids .tools,
		.assets .tools {
			opacity: 1;
		}
	}

	h2:focus {
		outline: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.inspector,
		.fields {
			animation: none;
			transition-property: opacity;
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
