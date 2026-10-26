<!--
	@component
	The selected blok's fields, from its schema, in a panel beside the page. Each change saves as
	a draft as it's made and the page shows it. Mounted by the overlay; nothing for a site to add.
-->
<script lang="ts">
	import { SvelteMap } from "svelte/reactivity"
	import { tick, untrack } from "svelte"
	import type { Attachment } from "svelte/attachments"
	import { call, editor, last_problem, send } from "./client.js"
	import { rich_supported, same } from "./content.js"
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
	type Component = { name: string; display_name: string | null; schema: Record<string, Field> }
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
		id?: number | null
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
	}: {
		select: (selection: Selection | null) => void
		highlight: (uid: string | null) => void
		picker: (options: {
			current: Asset
			images?: boolean
			save: (choice: { asset: number; alt: string; focus: string }) => Promise<string | null>
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
	/** The field being typed in, which a reload mustn't overwrite */
	let focused: string | null = null

	/** Whether a blok is showing, for the overlay */
	export const showing = () => selection !== null

	/** The field typed in on the page, which the settings mark so it's clear what's changing */
	let on_page = $state<{ uid: string; field: string } | null>(null)
	export function typing(at: { uid: string; field: string } | null) {
		on_page = at
	}
	/** The field being changed here, which the page marks where it shows it */
	const on_panel = (at: { uid: string; field: string } | null) =>
		dispatchEvent(new CustomEvent("storyloco:panel-field", { detail: at }))
	const typed_here = (key: string) => on_page?.uid === selection?.uid && on_page?.field === key

	const label = (name: string) => {
		const words = name.replace(/[_-]+/g, " ").trim()
		return words.charAt(0).toUpperCase() + words.slice(1)
	}
	const component_label = (name: string) => components.get(name)?.display_name || label(name)
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
			if (fields.length) out.push({ name: f.display_name || "More", fields })
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

	/** Away the way it came in: to the side, or down on a narrow screen */
	function slide_out(_: Element) {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return { duration: 0 }
		const narrow = innerWidth < 640
		return {
			duration: 200,
			easing: (t: number) => t * t,
			css: (t: number) =>
				`opacity: ${t}; translate: ${narrow ? `0 ${(1 - t) * 24}px` : `${(1 - t) * 24}px 0`}`,
		}
	}

	/** Show a blok; from the keyboard, focus moves to the panel's heading so its fields are next */
	export function open(next: Selection, keyboard = false) {
		if (keyboard) tick().then(() => title_el?.focus())
		if (selection?.story === next.story && selection.uid === next.uid) return
		flush()
		selection = next
		saving = {}
		failed = {}
		// the page's own copy first, so the fields are there at once; Storyblok's follows quietly
		const quick = peek(next)
		if (quick) {
			components = quick.components as Map<string, Component>
			values = { ...quick.blok }
			const story = { id: next.story, uuid: "", name: "", full_slug: "", published_at: null }
			loaded = { story, blok: quick.blok as Blok, trail: quick.trail }
			tab = groups[0]?.name ?? ""
			load(next, false)
		} else {
			loaded = null
			load(next)
		}
	}

	/** The page saved something; the blok may have changed under the panel */
	export function refresh() {
		if (!selection) return
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

	export function close() {
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

	/** Save a field now, or after a pause in typing */
	function change(key: string, value: unknown, wait = 0) {
		values[key] = value
		if (together.has(key)) return
		clearTimeout(timers.get(key))
		if (wait)
			timers.set(
				key,
				setTimeout(() => save(key), wait)
			)
		else save(key)
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

	async function add_child(key: string) {
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
		adding = { key, components: list.components, filter: "" }
		await tick()
		document.querySelector<HTMLInputElement>("[data-storyloco=inspector] .adding input")?.focus()
	}

	let adding = $state<{
		key: string
		components: Array<{ name: string; display_name: string }>
		filter: string
	} | null>(null)

	async function insert(key: string, name: string) {
		if (!selection) return
		adding = null
		saving[key] = true
		const reply = (await send({
			op: "insert",
			story: selection.story,
			uid: selection.uid,
			field: key,
			component: name,
		})) as {
			uid?: string
		} | null
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
		const reply = (await send({ op, story, uid, by })) as { uid?: string; undo?: unknown } | null
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
		const reply = (await send({ op, story, uid, by, to })) as { undo?: unknown } | null
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

	function drag(event: PointerEvent, key: string, from: number, moved: (to: number) => unknown) {
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
	const heading = (v: unknown) =>
		v && typeof v === "object" ? (v as { text?: string; level?: number | null }) : {}
	const asset = (v: unknown) => (v && typeof v === "object" ? (v as Asset) : {})
	const link = (v: unknown) => (v && typeof v === "object" ? (v as Link) : {})
	const kids = (v: unknown) => (Array.isArray(v) ? (v as Array<Blok>) : [])
	const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)$/i
	const thumb = (filename: string) =>
		/\.(jpe?g|png|gif|webp|avif)$/i.test(filename) ? `${filename}/m/160x0` : filename
	const file_name = (filename?: string | null) => filename?.split("/").pop() ?? ""
	const only_images = (field: Field) =>
		!field.filetypes?.length || field.filetypes.every((t) => t === "images")
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
		if (showing()) {
			saving[key] = false
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
			const typed = () => sharing?.typed(input.value)
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
		return (node) => {
			let stop: (() => void) | undefined
			let gone = false
			const doc = untrack(() => $state.snapshot(values[key])) ?? { type: "doc", content: [] }
			const target = untrack(() => selection)
			if (!target) return
			import("./richtext.js").then(async ({ rich_editor, shared_doc }) => {
				if (gone) return
				const room = enter(`${target.story}:${target.uid}:${key}`)
				const first = await room.ready
				// the first one in starts it from what's saved, not what the page last showed
				const saved = first
					? await call<Loaded>({ op: "blok", story: target.story, uid: target.uid })
							.then((found) => found.blok[key] as RichDoc | undefined)
							.catch(() => undefined)
					: undefined
				const extras = await inserts(field).catch(() => undefined)
				if (gone) return void leave(room)
				room.value = () => shared_doc(room)
				room.save = (value, shared) => save_shared(target, key, value, shared)
				together.add(key)
				const editor = rich_editor({
					element: node,
					doc: (saved ?? doc) as RichDoc,
					fixed: true,
					field: field as RichField,
					inserts: extras,
					change: (next) => (values[key] = next),
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
					<span class="pick">
						<span>{names.get(uuid)?.name ?? "…"}</span>
						{#if names.get(uuid)}<small>/{names.get(uuid)?.full_slug}</small>{/if}
					</span>
					<span class="tools">
						<button
							type="button"
							aria-label="Remove"
							onclick={() =>
								change(
									key,
									chosen.filter((u) => u !== uuid)
								)}
							><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg
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
	{@render Label(key, field, id)}
	<div class="asset">
		{#if value.filename}
			{#if IMAGE.test(value.filename)}
				<img src={thumb(value.filename)} alt={value.alt ?? ""} />
			{:else}
				<span class="file">{file_name(value.filename)}</span>
			{/if}
		{/if}
		<div class="asset-actions">
			<button
				{id}
				type="button"
				class="button"
				onclick={() =>
					picker({
						current: value,
						images: only_images(field),
						save: async (choice) => {
							change(key, { id: choice.asset, alt: choice.alt, focus: choice.focus })
							return null
						},
					})}>{value.filename ? "Replace" : "Choose"}</button
			>
			{#if value.filename}
				<button type="button" class="button quiet" onclick={() => change(key, null)}>Remove</button>
			{/if}
		</div>
	</div>
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
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg
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
						onpointerdown={(e) => drag(e, key, i, (to) => move_kid(key, i, to))}
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
					<span>{component_label(kid.component)}</span>
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
							><rect x="8" y="8" width="13" height="13" rx="2" /><path
								d="M4 16V5a1 1 0 0 1 1-1h11"
							/></svg
						></button
					>
					<button type="button" aria-label="Delete" onclick={() => child(key, "remove", kid._uid)}
						><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg
						></button
					>
				</span>
			</li>
		{/each}
	</ol>
	{#if adding?.key === key}
		{@const shown = adding.components.filter((c) =>
			`${c.display_name} ${c.name}`.toLowerCase().includes(adding!.filter.trim().toLowerCase())
		)}
		<div class="adding">
			<input placeholder="Find a block" aria-label="Find a block" bind:value={adding.filter} />
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
										><path d="M18 6 6 18M6 6l12 12" /></svg
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
										><path d="M18 6 6 18M6 6l12 12" /></svg
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

{#snippet Unknown(key: string, field: Field, id: string)}
	{@render Label(key, field, id)}
	<p class="readonly" {id}>Edited in Storyblok</p>
{/snippet}

{#snippet Control(key: string, field: Field)}
	{@const id = `storyloco-field-${key}`}
	<div
		class="sl-field"
		class:on-page={typed_here(key)}
		data-type={field.type}
		onfocusin={() => selection && on_panel({ uid: selection.uid, field: key })}
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
		{:else if field.field_type === "uiloco-heading"}
			{@render Heading(key, field, id)}
		{:else if field.field_type === "uiloco-seo"}
			{@render Seo(key, field, id)}
		{:else if field.field_type === "uiloco-mux"}
			{@render Video_(key, field, id)}
		{:else if field.type === "table"}
			{@render Table_(key, field, id)}
		{:else}
			{@render Unknown(key, field, id)}
		{/if}
	</div>
{/snippet}

{#if selection}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<aside
		class="inspector"
		data-storyloco="inspector"
		aria-label="Block settings"
		onkeydown={keydown}
		out:slide_out
	>
		<header>
			{#if loaded && loaded.trail.length > 1}
				<nav class="trail" aria-label="Where this block is">
					{#each loaded.trail.slice(0, -1) as step (step.uid)}
						<button
							type="button"
							onpointerenter={() => highlight(step.uid)}
							onpointerleave={() => highlight(selection?.uid ?? null)}
							onclick={() => selection && select({ story: selection.story, uid: step.uid })}
							>{component_label(step.component)}</button
						>
						<span aria-hidden="true">›</span>
					{/each}
				</nav>
			{/if}
			<div class="title">
				<h2 tabindex="-1" bind:this={title_el}>
					{#if loaded}{component_label(loaded.blok.component)}{:else}<span
							class="bone title-bone"
							aria-label="Loading"
						></span>{/if}
				</h2>
				{#if loaded && loaded.trail.length > 1}
					<div class="actions" role="group" aria-label="Block">
						<button
							type="button"
							class="round"
							aria-label="Move up"
							title="Move up"
							disabled={acting}
							onclick={() => act("move", -1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
						</button>
						<button
							type="button"
							class="round"
							aria-label="Move down"
							title="Move down"
							disabled={acting}
							onclick={() => act("move", 1)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
						</button>
						<button
							type="button"
							class="round"
							aria-label="Duplicate"
							title="Duplicate"
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
							title="Delete"
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
				<button type="button" class="round" aria-label="Close" onclick={() => select(null)}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
				</button>
			</div>
			{#if elsewhere}
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
			{#if groups.length > 1}
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

		<div class="body">
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
					<div class="fields">
						{#each current.fields as [key, field] (key)}
							{@render Control(key, field)}
						{/each}
					</div>
				{/key}
			{:else}
				<p class="help">This block has no fields.</p>
			{/if}
		</div>
	</aside>
{/if}

<style>
	/* A site's own styles stop at the editor's edge, whatever they target */
	:where(.inspector) :not(svg, svg *) {
		all: revert;
	}

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

		background: var(--bg);
		block-size: calc(100dvh - 1.5rem);
		border-radius: 1rem;
		box-shadow:
			0 0 0 1px var(--line),
			0 16px 48px rgb(0 0 0 / 0.16);
		color: var(--ink);
		display: grid;
		font:
			400 0.8125rem/1.4 system-ui,
			sans-serif;
		grid-template-rows: auto minmax(0, 1fr);
		inline-size: min(22rem, 100vw - 1.5rem);
		inset: 0.75rem 0.75rem auto auto;
		overflow: hidden;
		position: fixed;
		transition:
			opacity 0.22s ease,
			translate 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
		z-index: 2147483002;

		@starting-style {
			opacity: 0;
			translate: 1.5rem 0;
		}

		@media (width < 40rem) {
			block-size: auto;
			inline-size: auto;
			inset: auto 0.5rem 0.5rem;
			max-block-size: 65dvh;

			@starting-style {
				translate: 0 1.5rem;
			}
		}

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

	header {
		border-block-end: 1px solid var(--line);
		display: grid;
		gap: 0.5rem;
		padding: 0.875rem 0.875rem 0 1rem;
	}

	.trail {
		align-items: center;
		color: var(--muted);
		display: flex;
		flex-wrap: wrap;
		font-size: 0.75rem;
		gap: 0.25rem;

		& button {
			background: none;
			border: 0;
			border-radius: 0.25rem;
			color: inherit;
			cursor: pointer;
			font: inherit;
			padding: 0 0.125rem;

			&:hover {
				color: var(--ink);
				text-decoration: underline;
			}
		}
	}

	.title {
		align-items: center;
		display: flex;
		justify-content: space-between;

		& h2 {
			font-size: 1rem;
			font-weight: 600;
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
		overflow: auto;
		overscroll-behavior: contain;
		padding: 1rem;
	}

	.fields {
		animation: fade 0.2s ease;
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
		padding: 0.5rem 0.625rem;
		transition:
			border-color 0.15s,
			background-color 0.15s;

		&:hover {
			border-color: var(--line);
		}

		&:focus-visible {
			background-color: var(--bg);
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
				background: var(--bg);
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
		background: var(--bg);
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
	}

	.rich {
		background: var(--field);
		border: 1px solid var(--line);
		border-radius: 0.5rem;
		max-block-size: 22rem;
		overflow: auto;
		padding: 0.375rem 0.625rem 0.5rem;

		&:focus-within {
			background: var(--bg);
			border-color: var(--accent);
		}

		& :global(.ProseMirror) {
			min-block-size: 4.5rem;
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
				font: inherit;
				min-inline-size: 1.5rem;
				padding: 0.125rem;

				&:hover:not(:disabled) {
					background: var(--bg);
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

			& svg {
				opacity: 0;
			}
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

	.round {
		background: none;
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
