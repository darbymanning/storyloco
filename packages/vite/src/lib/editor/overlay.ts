import { mount, unmount } from "svelte"
import BlockBar from "./block_bar.svelte"
import {
	bloks,
	call,
	check_live,
	connected_story,
	detected_story,
	on_navigate,
	page_blok,
	editor,
	last_problem,
	on_editing,
	on_saved,
	redo,
	refresh,
	send,
	set_editing,
	undo,
} from "./client.js"
import {
	allowed,
	find_blok,
	fresh_blok,
	is_rich,
	locate,
	rich_compact,
	rich_supported,
	shows_rich,
	text_of,
} from "./content.js"
import {
	enter,
	here,
	leave as leave_room,
	on_people,
	others,
	select as live_select,
	start as go_live,
	stop as go_offline,
} from "./live.js"
import { anchor_at } from "./anchor.js"
import type { Inserts, RichField } from "./richtext.js"
import { show as show_presence } from "./presence.js"
import { share_text, type Surface } from "./together.js"

/*
 * The page side of editing, for someone signed in: one set of listeners for the whole document
 * rather than one per blok, so edit mode turns everything on and off in one place. A blok is
 * found from the element `attrs` marked, and its content from `bloks`; text and images match
 * their fields by what they show, so a site marks nothing up.
 *
 * Hovering a block outlines it and names it; clicking selects it, which pins its toolbar and
 * opens its settings. Text and images inside edit where they are.
 */

type Blok = Record<string, unknown> & { _uid?: string; component?: string }
type Field = {
	type: string
	field_type?: string
	display_name?: string | null
	max_length?: number | string | null
}
type Component = {
	name: string
	display_name: string | null
	is_nestable?: boolean
	component_group_uuid?: string | null
	internal_tag_ids?: Array<string | number> | null
	schema: Record<string, Field>
}

export type Target = { node: HTMLElement; story: number; uid: string; name: string }
export type Selection = { story: number; uid: string }

/** Where a piece of text comes from: a blok's field, or a story's own name */
type Source = ({ story: number; uid: string; field: string } | { story: number; name: true }) & {
	multiline?: boolean
	max?: number
}

const meta = (node: Element) => {
	try {
		return JSON.parse((node as HTMLElement).dataset.blokC ?? "{}") as {
			id?: string | number
			uid?: string
			name?: string
		}
	} catch {
		return {}
	}
}

const block_of = (el: Element | null) => el?.closest<HTMLElement>("[data-blok-c]") ?? null

/** Our own toolbars and panels, which edit mode leaves alone */
const ours = (el: Element | null) => !!el?.closest("[data-storyloco]")

/**
 * A blok the bar can act on; not a story's own root, which has nowhere to move. Sites that
 * don't mark their page's root still list its bloks, so those count by the page's story
 */
export function target_of(node: HTMLElement): Target | undefined {
	const { id, uid, name } = meta(node)
	if (!uid || !name) return
	const story = Number(id)
	const above = node.parentElement?.closest("[data-blok-c]")
	const nested = above && Number(meta(above).id) === story
	const page = editor.story
	const listed = !above && page?.id === story && page.uid !== uid
	if (!nested && !listed) return
	return { node, story, uid, name }
}

/** The block a block sits in, when that's a block of the same story too */
function parent_of(target: Target) {
	const above = target.node.parentElement?.closest<HTMLElement>("[data-blok-c]")
	return above ? target_of(above) : undefined
}

/** The element showing the blok with this `_uid`, once the page has caught up with a change */
export function element_of(uid: string) {
	for (const node of document.querySelectorAll<HTMLElement>("[data-blok-c]"))
		if (meta(node).uid === uid) return node
}

export const find = (uid: string) => {
	const node = element_of(uid)
	return node && target_of(node)
}

// --- each block's content

/*
 * Background lookups, two at a time: hovering a menu full of links would otherwise ask the
 * Management API about every one at once, past its rate limit
 */
let running = 0
const waiting: Array<() => void> = []
async function queued<T>(task: () => Promise<T>): Promise<T> {
	if (running >= 2) await new Promise<void>((go) => waiting.push(go))
	running++
	try {
		return await task()
	} finally {
		running--
		waiting.shift()?.()
	}
}

let fetched = new Map<number, Promise<Blok | undefined>>()

/** A story's draft content, asked of the server once for all its blocks; a failure is asked again next time */
/** Story content already here, by story id, for drawing the settings without waiting */
const known = new Map<number, Blok>()

function content_for(story: number) {
	let found = fetched.get(story)
	if (!found) {
		found = queued(() => call<{ content: Blok }>({ op: "content", story }))
			.then(({ content }) => (known.set(story, content), content))
			.catch(() => {
				fetched.delete(story)
				return undefined
			})
		fetched.set(story, found)
	}
	return found
}

/**
 * A block's content: what `attrs` noted against its element, or else the page's own story
 * (so blocks marked with Storyblok's `storyblokEditable` work too), or else its story's
 * content from the server, for stories the page didn't connect, like a layout's header
 */
async function blok_for(node: HTMLElement | null): Promise<Blok | undefined> {
	if (!node) return
	const own = bloks.get(node) as Blok | undefined
	if (own) return own
	const { id, uid } = meta(node)
	if (!uid) return
	const local = page_blok(uid) as Blok | undefined
	if (local) return local
	const content = await content_for(Number(id))
	return content ? (find_blok(content, uid) as Blok | undefined) : undefined
}

// --- the schema, so only text fields are offered as text

let schema: Promise<Map<string, Component>> | undefined
let components = new Map<string, Component>()

export function load_schema() {
	return (schema ??= call<{ components: Array<Component> }>({ op: "schema" })
		.then(({ components: list }) => (components = new Map(list.map((c) => [c.name, c]))))
		.catch((e) => {
			schema = undefined
			throw e
		}))
}

export const label_of = (name: string) => {
	const given = components.get(name)?.display_name
	if (given) return given
	const words = name.replace(/[_-]+/g, " ").trim()
	return words.charAt(0).toUpperCase() + words.slice(1)
}

const TEXT = new Set(["text", "textarea", "markdown"])

/** The field, when it shows as plain text on the page, by the blok's schema */
function text_field(blok: Blok, key: string) {
	const field = components.get(blok.component ?? "")?.schema[key]
	return field && (TEXT.has(field.type) || field.field_type === "uiloco-heading")
		? field
		: undefined
}

// --- stories the page links to, like cards listing the latest articles

type Linked = { id: number; uuid: string; name: string; full_slug: string; content: Blok }
const linked = new Map<string, Promise<Linked | null>>()

/** The story a same-site link goes to, fetched once and kept until it's changed */
function story_at(link: Element | null): Promise<Linked | null> | undefined {
	if (!(link instanceof HTMLAnchorElement)) return
	const url = new URL(link.href, location.href)
	if (url.origin !== location.origin) return
	const path = url.pathname.replace(/^\/+|\/+$/g, "")
	if (!path || path.startsWith("__storyloco")) return
	let story = linked.get(path)
	if (!story) {
		story = queued(() => call<{ story: Linked | null }>({ op: "linked", path }))
			.then(({ story }) => (story && known.set(story.id, story.content), story))
			.catch(() => null)
		linked.set(path, story)
	}
	return story
}

/** A story changed through this page; its linked copy is stale */
function forget(story: number) {
	for (const [path, promise] of linked)
		promise.then((found) => found?.id === story && linked.delete(path))
}

/** Every blok in some content, the root included */
function* each_blok(value: unknown): Generator<Blok> {
	if (!value || typeof value !== "object") return
	const node = value as Blok
	if (typeof node._uid === "string" && typeof node.component === "string") yield node
	for (const child of Object.values(value)) yield* each_blok(child)
}

/**
 * The bloks nested in a block with no element of their own, like a list's items when only the
 * list is marked: their text is the block's to edit
 */
const inner_bloks = (blok: Blok) =>
	[...own_bloks(blok)].filter((inner) => inner !== blok && !element_of(inner._uid!))

/** Like `each_blok`, but not into the stories a field links to, which are theirs to edit */
function* own_bloks(value: unknown): Generator<Blok> {
	if (!value || typeof value !== "object") return
	if ("uuid" in value && "content" in value) return
	const node = value as Blok
	if (typeof node._uid === "string" && typeof node.component === "string") yield node
	for (const child of Object.values(value)) yield* own_bloks(child)
}

/** A rich text field, and the blok it's in: the block's own, or one nested in it */
type Rich = { blok: Blok; field: string }

/** The rich text a block shows: its own fields, then its unmarked nested bloks' */
const rich_fields = (blok: Blok) =>
	[blok, ...inner_bloks(blok)].flatMap((owner) =>
		Object.entries(owner)
			.filter(([key, value]) => !key.startsWith("_") && is_rich(value) && rich_supported(value))
			.map(([field, value]) => ({ blok: owner, field, value }))
	)

/** Spaces aside, as text shows on the page however the site wraps it */
const loose = (text: string) => text.replace(/\s+/g, " ").trim()

/** The one field among these bloks showing exactly this text, if only one does */
/** Every field among these bloks showing exactly this text */
function matches(text: string, candidates: Iterable<Blok>, story: number) {
	const found: Array<Source> = []
	for (const blok of candidates)
		for (const [key, value] of Object.entries(blok)) {
			const field = !key.startsWith("_") && text_field(blok, key)
			if (!field || loose(text_of(value) ?? "") !== text) continue
			found.push({
				story,
				uid: blok._uid!,
				field: key,
				multiline: field.type !== "text" && field.type !== "custom",
				max: Number(field.max_length) || undefined,
			})
		}
	return found
}

/**
 * Where on the page this text shows, in the order it does: each innermost element showing just
 * it, and text set straight into an element beside others
 */
function showing(scope: Element, text: string) {
	const out: Array<Node> = []
	const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof Element) {
			if (ours(node) || loose(node.textContent ?? "") !== text) continue
			if (![...node.children].some((child) => loose(child.textContent ?? "") === text))
				out.push(node)
		} else if (node instanceof Text && loose(node.data) === text) {
			if (loose(node.parentElement?.textContent ?? "") !== text) out.push(node)
		}
	}
	return out
}

/**
 * The one field showing this text, or, when several hold the same and the page shows each once,
 * the one at the same place among them as `shown` is among the page's: fields in the content's
 * order, as a template mostly shows them
 */
function match(text: string, candidates: Iterable<Blok>, story: number, shown?: Node) {
	const found = matches(text, candidates, story)
	if (found.length === 1) return found[0]
	if (found.length < 2 || !shown) return
	const scope = block_of(shown instanceof Element ? shown : shown.parentElement) ?? document.body
	const places = showing(scope, text)
	return places.length === found.length ? found[places.indexOf(shown)] : undefined
}

/** Where text inside a link to another story comes from: its name, or one of its fields */
function linked_source(text: string, story: Linked): Source | undefined {
	if (loose(story.name) === text) return { story: story.id, name: true, max: 255 }
	return match(text, each_blok(story.content), story.id)
}

/** Where this text comes from: its blok's field first, then a story the link around it goes to, then the page's own story */
/**
 * Whether this is one line of rich text the page shows, from one of these bloks: a plain field
 * whose words happen to match it, like a suptitle matching a heading in a body, isn't where it's
 * from, even when which of several identical bodies it is can't be told
 */
function in_rich(shown: Node, owners: Array<Blok | undefined>) {
	const compacts = owners.flatMap((owner) =>
		owner ? rich_fields(owner).map(({ value }) => rich_compact(value)) : []
	)
	if (!compacts.length) return false
	const own = (shown.textContent ?? "").replace(/\s+/g, "")
	for (let at = shown.parentElement; at && !at.hasAttribute("data-blok-c"); at = at.parentElement) {
		const text = (at.textContent ?? "").replace(/\s+/g, "")
		if (text !== own && compacts.some((compact) => compact && shows_rich(text, compact)))
			return true
	}
	return false
}

async function source_of(
	node: HTMLElement,
	text: string,
	/** what shows the text, when it's not `node` itself, like loose text in it */
	shown: Node = node
): Promise<Source | undefined> {
	await load_schema()
	const block = block_of(node)
	const blok = await blok_for(block)
	const page = editor.story
	if (in_rich(shown, [blok, page?.uid ? page_blok(page.uid) : undefined])) return
	const own =
		blok &&
		block &&
		(match(text, [blok], Number(meta(block).id), shown) ??
			match(text, inner_bloks(blok), Number(meta(block).id), shown))
	if (own) return own
	const story = await story_at(node.closest("a[href]"))
	if (story) return linked_source(text, story)
	// outside every block, or in the page's own: a template showing the page's fields under names
	// of its own, or the page's name, like its title
	const at_root = !block || (page?.uid !== undefined && meta(block).uid === page.uid)
	const root = at_root && page?.uid ? page_blok(page.uid) : undefined
	if (!page || !root) return
	if (loose(page.name) === text) return { story: page.id, name: true, max: 255 }
	return match(text, [root], page.id, shown) ?? match(text, inner_bloks(root), page.id, shown)
}

// --- how it all looks on the page

/*
 * In a layer, so a site restyles any of it without fighting specificity: `[data-field]` and
 * `[data-rich]` for editable text, `[data-storyloco-hover]` and `-selected` for blocks
 */
const STYLE = `[data-field],[data-rich]{cursor:text;pointer-events:auto;border-radius:2px;transition:opacity .2s;caret-color:var(--editor-accent,#05807f)}
[data-field]:focus,[data-storyloco=rich],[data-storyloco-field]{outline:1.5px solid color-mix(in srgb,var(--editor-accent,#05807f) 70%,transparent);outline-offset:4px}
[data-edit=saving]{opacity:.55}
[data-edit=error]{box-shadow:0 0 0 2px var(--editor-danger,#e5484d)}
[data-image]{outline:2px solid color-mix(in srgb,var(--editor-accent,#05807f) 60%,transparent);outline-offset:-2px}
[data-storyloco-hover]{outline:1px solid color-mix(in srgb,var(--editor-accent,#05807f) 70%,transparent);outline-offset:-1px}
[data-storyloco-selected]{outline:2px solid var(--editor-accent,#05807f)!important;outline-offset:-2px}
[data-blok-c][data-storyloco-empty]{min-block-size:3.5rem;background:repeating-linear-gradient(-45deg,transparent 0 8px,color-mix(in srgb,var(--editor-accent,#05807f) 6%,transparent) 8px 16px)}
[data-blok-c]:focus-visible{outline:2px solid var(--editor-accent,#05807f);outline-offset:-2px}`

/* Outside the layer, so a site's reset can't unpin our own bits */
const OURS = `button.storyloco-replace{position:fixed;z-index:2147483000;white-space:nowrap;display:flex;align-items:center;gap:.375rem;padding:.375rem .75rem;border:0;border-radius:999px;background:var(--editor-accent,#05807f);color:var(--editor-accent-ink,#fff);font:500 .8125rem/1.25 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgb(0 0 0/.2);animation:storyloco-in .16s ease-out}
button.storyloco-replace[hidden]{display:none}
[data-storyloco=field-ring]{position:fixed;z-index:2147482990;pointer-events:none;border-radius:4px;outline:1.5px solid color-mix(in srgb,var(--editor-accent,#05807f) 70%,transparent)}
button.storyloco-replace:focus-visible{outline:2px solid #fff;outline-offset:-4px}
[data-storyloco=tag]{position:fixed;z-index:2147482997;pointer-events:none;padding:.125rem .5rem;border-radius:.375rem .375rem .375rem 0;background:var(--editor-accent,#05807f);color:var(--editor-accent-ink,#fff);font:600 .6875rem/1.4 system-ui,sans-serif;white-space:nowrap;max-inline-size:16rem;overflow:hidden;text-overflow:ellipsis;transition:opacity .12s}
[data-storyloco=tag][hidden]{display:block;opacity:0}
@keyframes storyloco-in{from{opacity:0;translate:0 -2px}}
@media (prefers-reduced-motion:reduce){[data-storyloco],[data-storyloco] *{animation:none!important;transition-property:opacity!important}}`

function style() {
	if (document.getElementById("storyloco-editor-style")) return
	const tag = document.createElement("style")
	tag.id = "storyloco-editor-style"
	// first in <head>, so a site's own rules win without needing more specificity
	tag.textContent = `@layer storyloco{${STYLE}}${OURS}`
	document.head.prepend(tag)
}

// --- hovering: an outline and a name

let tag: HTMLElement | undefined
let hovered: HTMLElement | null = null

/** Outline a block and name it, just above its top edge */
function hover(node: HTMLElement | null, name?: string) {
	if (node === hovered) return place_tag()
	hovered?.removeAttribute("data-storyloco-hover")
	hovered = node
	if (!tag) {
		tag = document.createElement("div")
		tag.dataset.storyloco = "tag"
		tag.setAttribute("aria-hidden", "true")
		document.body.append(tag)
	}
	if (!node) {
		tag.hidden = true
		return
	}
	node.setAttribute("data-storyloco-hover", "")
	tag.textContent = name ?? ""
	place_tag()
	wire_all(node)
}

function place_tag() {
	if (!tag || !hovered) return
	// the selected block has its toolbar there already
	const box = hovered.getBoundingClientRect()
	tag.hidden =
		hovered.hasAttribute("data-storyloco-selected") || box.bottom < 0 || box.top > innerHeight
	tag.style.left = `${Math.max(box.left, 0)}px`
	tag.style.top = `${Math.max(box.top - tag.offsetHeight, 0)}px`
}

// --- text, edited where it is

/** An element's one child that matters, ignoring the comments and empty text a framework anchors its updates with */
function only_child(el: Node) {
	const nodes = [...el.childNodes].filter(
		(node) => node.nodeType !== Node.COMMENT_NODE && !(node instanceof Text && !node.data)
	)
	return nodes.length === 1 ? nodes[0] : undefined
}

/** An element's text when that's all it holds */
const text_child = (el: Node) => {
	const child = only_child(el)
	return child instanceof Text ? child : undefined
}

/* The element holding just the text, reaching through wrappers like a heading around a span */
function holder(target: Element) {
	let node: Node | undefined = target
	for (let depth = 0; depth < 3 && node instanceof HTMLElement; depth++) {
		if (text_child(node)) return node
		node = only_child(node)
	}
}

/** Tags that only style a stretch of text, like an accent on a title's last words */
const INLINE = /^(SPAN|EM|STRONG|B|I|U|SMALL|MARK|SUB|SUP|BR|WBR)$/

/** An element showing one piece of text in inline parts, like `Title <span class="accent">words</span>` */
function inline_run(el: Element) {
	const parts = [...el.childNodes].filter(
		(node) => node.nodeType !== Node.COMMENT_NODE && !(node instanceof Text && !node.data.trim())
	)
	return (
		parts.length > 1 &&
		parts.every(
			(node) => node instanceof Text || (node instanceof Element && INLINE.test(node.tagName))
		) &&
		[...el.querySelectorAll("*")].every((inner) => INLINE.test(inner.tagName))
	)
}

/** The outermost run of inline text around, or just inside, what the pointer's on */
function run_at(el: Element) {
	let found: HTMLElement | null = null
	for (let at: Element | null = el, i = 0; at && i < 4 && !at.hasAttribute("data-blok-c"); i++) {
		if (inline_run(at)) found = at as HTMLElement
		at = at.parentElement
	}
	if (found) return found
	for (let at: Node | undefined = el, i = 0; at instanceof HTMLElement && i < 3; i++) {
		if (inline_run(at)) return at
		at = only_child(at)
	}
	return null
}

const wired = new Map<HTMLElement, () => void>()

/** Text on the page that others may type in too: joining it to watch, and leaving when they've gone */
const shareable = new Map<HTMLElement, { key: string; watch(): void; done(): void }>()

/** The room a field's text is typed in together in */
const room_key = (source: Source) =>
	"name" in source ? `${source.story}:name` : `${source.story}:${source.uid}:${source.field}`

/**
 * The fields someone else is typing in right now, by what they've said they're in: everyone
 * watching a field is in its room too, so the room alone would keep watchers watching each other
 */
const typed_in = () =>
	others()
		.filter((p) => p.select?.field)
		.flatMap((p) => p.rooms.filter((key) => key.endsWith(`:${p.select!.uid}:${p.select!.field}`)))

/** Join the text others are typing in on this page, so it changes here as they type; leave once they stop */
function follow() {
	const busy = new Set(typed_in())
	for (const { key, watch, done } of shareable.values()) {
		if (busy.has(key)) watch()
		else done()
	}
	// text nobody here has hovered isn't ready to share yet: ready it, and it joins once it is
	for (const key of busy) {
		const uid = key.split(":")[1]
		const block = uid && uid !== "name" ? element_of(uid) : null
		if (block && ![...shareable.values()].some((s) => s.key === key)) wire_all(block)
	}
}

/** The field being typed in on the page, so selecting its block still says so to the others */
let typing_in: { uid: string; field: string } | null = null

/** The text in a text node, at a character `index` of all the text in `node` */
function text_at(node: Node, index: number) {
	const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
	for (let at = walker.nextNode() as Text | null; at; at = walker.nextNode() as Text | null) {
		if (index <= at.length) return { node: at, offset: index }
		index -= at.length
	}
}

/**
 * What a field's text shows in: its one text node, or for a run in parts, something like one whose
 * text is all of theirs and which leaves them for the page to update, as it will once it reloads
 */
type Shows = { data: string }

function wire(node: HTMLElement, text: Shows, source: Source) {
	const key = room_key(source)
	let sharing: ReturnType<typeof share_text> | null = null

	/* Typing can replace the text node; put Svelte's own back so later updates still land */
	// the framework's comment anchors go back exactly where they were, or its later updates go astray
	const original = [...node.childNodes]
	function settle(value: string) {
		text.data = value
		node.replaceChildren(...original)
	}

	const tidy = (raw: string) =>
		source.multiline
			? raw
					.replace(/[^\S\n]+/g, " ")
					.replace(/ *\n */g, "\n")
					.trim()
			: raw.replace(/\s+/g, " ").trim()

	const typing = () => document.activeElement === node

	/** Where the text shows: a copy while it's typed in, so Svelte's own node isn't changed under it */
	const surface: Surface = {
		typing,
		show(value, at) {
			if (!typing()) return void (text.data = value)
			node.textContent = value
			const spot = at === null ? null : text_at(node, Math.min(at, value.length))
			if (spot) getSelection()?.collapse(spot.node, spot.offset)
		},
		at() {
			const selection = getSelection()
			if (!typing() || !selection?.anchorNode || !node.contains(selection.anchorNode)) return null
			const range = document.createRange()
			range.selectNodeContents(node)
			range.setEnd(selection.anchorNode, selection.anchorOffset)
			return range.toString().length
		},
		spot(index) {
			const spot = text_at(node, index)
			if (!spot) return null
			const range = document.createRange()
			range.setStart(spot.node, spot.offset)
			const box = range.getClientRects()[0]
			if (box?.height) return box
			// a caret on its own has no box at the end of a line: take the edge of the character before it
			if (!spot.offset) return null
			range.setStart(spot.node, spot.offset - 1)
			range.setEnd(spot.node, spot.offset)
			const before = range.getClientRects()[0]
			return before ? new DOMRect(before.right, before.top, 0, before.height) : null
		},
	}

	/** Saved while being typed in, so the page's data catches up once it's left */
	let behind = false
	async function persist(value: string, together = false) {
		node.dataset.edit = "saving"
		const change =
			"name" in source
				? { op: "name", story: source.story, value }
				: { op: "set", story: source.story, uid: source.uid, field: source.field, value }
		const typing = document.activeElement === node
		if (await send(change, together ? "shared" : "change", { again: !typing })) {
			if (typing) behind = true
			delete node.dataset.edit
			forget(source.story)
			return true
		}
		/* The text stays as typed, to try again */
		node.dataset.edit = "error"
		toast(last_problem() ?? "Couldn’t save that", {
			label: "Retry",
			run: () => persist(value, together),
		})
		return false
	}

	function share() {
		sharing ??= share_text(key, surface, {
			initial: text.data,
			tidy,
			save: persist,
			fresh:
				"name" in source
					? undefined
					: () =>
							call<{ blok: Blok }>({ op: "blok", story: source.story, uid: source.uid }).then(
								({ blok }) => text_of(blok[source.field])
							),
		})
	}

	async function unshare() {
		const was = sharing
		sharing = null
		await was?.stop()
	}

	function keydown(event: KeyboardEvent) {
		// Enter finishes a line of text; in a longer field it's a new line, and ⌘/Ctrl+Enter finishes
		const finish = event.key === "Enter" && (!source.multiline || event.metaKey || event.ctrlKey)
		if (finish || event.key === "Escape") {
			event.preventDefault()
			node.blur()
		}
	}

	function before(event: InputEvent) {
		const length = (node.textContent ?? "").length
		const adding = event.data?.length ?? (event.inputType.startsWith("insert") ? 1 : 0)
		if (source.max && adding && length + adding > source.max) {
			event.preventDefault()
			toast(`That field takes up to ${source.max} characters`)
		}
	}

	/* What the page showed, which can differ from the field, like a `{{phone}}` the site fills in */
	let shown: string | null = null
	const input = () => {
		shown = null
		sharing?.typed(node.textContent ?? "")
	}
	const moved = () => typing() && sharing?.moved()

	const focus = () => {
		bar.hide()
		shown = text.data
		node.replaceChildren(document.createTextNode(sharing?.value() ?? text.data))
		share()
		if ("uid" in source) {
			typing_in = { uid: source.uid, field: source.field }
			tell(typing_in)
		}
	}

	async function blur() {
		const value = tidy(source.multiline ? node.innerText : (node.textContent ?? ""))
		// left as it was: the page's own rendering of it, since nothing reloads to put that back
		settle(shown ?? value)
		reselect()
		typing_in = null
		tell(selected ? { uid: selected.uid } : null)
		// with someone else still typing in it, it stays joined to watch; otherwise leaving saves what changed
		if (sharing && !typed_in().includes(key)) await unshare()
		if (behind) {
			behind = false
			await refresh()
		}
	}

	node.contentEditable = "plaintext-only"
	node.dataset.field = "name" in source ? "name" : source.field
	node.addEventListener("keydown", keydown)
	node.addEventListener("beforeinput", before)
	node.addEventListener("input", input)
	node.addEventListener("focus", focus)
	node.addEventListener("blur", blur)
	document.addEventListener("selectionchange", moved)
	shareable.set(node, {
		key,
		watch: share,
		done: () => !typing() && sharing && unshare(),
	})
	follow()

	wired.set(node, () => {
		node.removeEventListener("keydown", keydown)
		node.removeEventListener("beforeinput", before)
		node.removeEventListener("input", input)
		node.removeEventListener("focus", focus)
		node.removeEventListener("blur", blur)
		document.removeEventListener("selectionchange", moved)
		node.removeAttribute("contenteditable")
		delete node.dataset.field
		shareable.delete(node)
		unshare()
		wired.delete(node)
	})
}

/** The text node, and the place in it, under a point */
function caret_at(x: number, y: number) {
	type Caret = { offsetNode: Node; offset: number }
	const doc = document as Document & { caretPositionFromPoint?(x: number, y: number): Caret | null }
	const caret = doc.caretPositionFromPoint?.(x, y)
	if (caret) return { node: caret.offsetNode, offset: caret.offset }
	const range = document.caretRangeFromPoint?.(x, y)
	return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/**
 * Text set straight into an element beside others, like a subtitle beside a "Show more" button,
 * has no element of its own to type in. Pressed, a stand-in of ours takes its place while it's
 * typed in, with Svelte's own node emptied meanwhile and filled again after, still Svelte's
 */
async function edit_loose(event: PointerEvent) {
	// the press's own mousedown moves the focus, to the block, so typing starts once it's let go
	const released = new Promise<void>((done) => {
		addEventListener("pointerup", () => done(), { once: true, capture: true })
		setTimeout(done, 1000)
	})
	const caret = caret_at(event.clientX, event.clientY)
	const text = caret?.node
	if (!(text instanceof Text) || !text.parentElement) return
	const parent = text.parentElement
	// its own text, or a run of parts that is a field, is typed in where it is
	if (text_child(parent) || wired.has(parent) || ours(parent)) return
	if (parent.closest("a[href], [data-field], [data-rich]")) return
	const kept = text.data
	const value = loose(kept)
	const source = value ? await source_of(parent, value, text) : undefined
	// found before the press is let go, so its click edits rather than presses a button round it
	const button = parent.closest("button")
	if (source && button) claimed.add(button)
	await released
	if (!source || !active || !text.isConnected || text.data !== kept) return
	const stand = document.createElement("span")
	stand.textContent = kept
	text.before(stand)
	text.data = ""
	wire(
		stand,
		{
			get data() {
				return loose(stand.textContent ?? "")
			},
			set data(next) {
				text.data = next
			},
		},
		source
	)
	// after the field's own blur has put its text back on Svelte's node
	stand.addEventListener(
		"blur",
		() => {
			if (!text.data) text.data = kept
			stand.remove()
			setTimeout(() => wired.get(stand)?.(), 2000)
		},
		{ once: true }
	)
	stand.focus()
	const spot = text_at(stand, Math.min(caret?.offset ?? 0, stand.textContent?.length ?? 0))
	if (spot) getSelection()?.collapse(spot.node, spot.offset)
}

/** Buttons whose text a press is about to edit, so their click doesn't press them too */
const claimed = new WeakSet<Element>()

/** A press's look for loose text to type in, which its click waits for before selecting */
let loosening: Promise<void> | null = null

/** Make this element's text editable, if it shows a field */
function try_wire(node: HTMLElement) {
	const first = text_child(node)
	const run = !first && inline_run(node)
	if (wired.has(node) || (!first && !run) || ours(node)) return
	// a run whose parts are already someone's text is theirs
	if (run && [...wired.keys()].some((other) => node.contains(other))) return
	const text = loose(first ? first.data : (node.textContent ?? ""))
	if (!text) return
	const parts: Shows = {
		get data() {
			return loose(node.textContent ?? "")
		},
		set data(_) {},
	}
	source_of(node, text).then((source) => {
		if (!active || !source || wired.has(node)) return
		if (first ? text_child(node) === first : inline_run(node)) wire(node, first ?? parts, source)
	})
}

/**
 * Every piece of editable text in a block, found when it's first hovered, so the whole block
 * shows what can be changed rather than one piece at a time. Nested blocks look after their own.
 */
let swept = new WeakSet<HTMLElement>()
function wire_all(block: HTMLElement) {
	if (swept.has(block)) return
	swept.add(block)
	for (const el of block.querySelectorAll<HTMLElement>("*")) {
		if (block_of(el) !== block) continue
		if (text_child(el)) try_wire(el)
		else if (inline_run(el) && !(el.parentElement && inline_run(el.parentElement))) try_wire(el)
	}
	mark_riches(block)
}

/**
 * The block's richtext, found from the outside in: the first element whose text, spaces aside,
 * is a richtext field's is the outermost wrapper showing it, and nothing inside needs a look
 */
async function mark_riches(block: HTMLElement) {
	const blok = await blok_for(block)
	const fields = blok ? rich_fields(blok) : []
	if (!fields.length) return
	const wanted = fields.map(({ value, ...rich }) => [rich_compact(value), rich] as const)
	// the outermost element showing each text, in order, so the same text in several fields pairs
	// up with where it shows, as `match` does
	const shown = new Map<string, Array<HTMLElement>>()
	let inside: Element | null = null
	for (const el of block.querySelectorAll<HTMLElement>("*")) {
		if (inside?.contains(el) || block_of(el) !== block) continue
		const text = (el.textContent ?? "").replace(/\s+/g, "")
		if (!text || el.querySelector("[data-blok-c]")) continue
		const compact = wanted.find(([want]) => shows_rich(text, want))?.[0]
		if (compact === undefined) continue
		shown.set(compact, [...(shown.get(compact) ?? []), el])
		inside = el
	}
	for (const [compact, els] of shown) {
		const owners = wanted.filter(([want]) => want === compact).map(([, rich]) => rich)
		if (owners.length !== els.length) continue
		els.forEach((el, i) => {
			riches.set(el, owners[i])
			el.dataset.rich = owners[i].field
		})
	}
}

// --- images, replaced from the library or an upload

type Asset = {
	fieldtype?: string
	filename?: string | null
	alt?: string | null
	focus?: string | null
	id?: number | null
}
type Spot = { story: number; uid: string; field: string; index?: number; asset: Asset }

/** An image URL's path without the image service's resizing, so a rendition matches its field */
const asset_path = (src: string) => {
	try {
		return new URL(src, location.href).pathname.split("/m/")[0]
	} catch {
		return ""
	}
}

/** The one asset field, or multiasset entry, among these bloks that this image shows */
function image_field(img: HTMLImageElement, candidates: Iterable<Blok>, story: number) {
	const path = asset_path(img.currentSrc || img.src)
	if (!path) return
	const found: Array<Spot> = []
	for (const blok of candidates)
		for (const [field, value] of Object.entries(blok)) {
			if (field.startsWith("_")) continue
			const list: Array<unknown> = Array.isArray(value) ? value : [value]
			list.forEach((item, i) => {
				const asset = item as Asset | null
				if (asset?.fieldtype === "asset" && asset.filename && asset_path(asset.filename) === path)
					found.push({
						story,
						uid: blok._uid!,
						field,
						index: Array.isArray(value) ? i : undefined,
						asset,
					})
			})
		}
	return found.length === 1 ? found[0] : undefined
}

async function spot_of(img: HTMLImageElement): Promise<Spot | undefined> {
	const block = block_of(img)
	const blok = await blok_for(block)
	const own = blok && block && image_field(img, [blok], Number(meta(block).id))
	if (own) return own
	const story = await story_at(img.closest("a[href]"))
	return story ? image_field(img, each_blok(story.content), story.id) : undefined
}

let replace: HTMLButtonElement | undefined
let offered: HTMLImageElement | undefined

function withdraw() {
	if (replace) replace.hidden = true
	if (offered) delete offered.dataset.image
	offered = undefined
}

/** A Replace button over the image, which stays while the pointer moves between the two */
function offer(img: HTMLImageElement, spot: Spot) {
	if (!replace) {
		replace = document.createElement("button")
		replace.type = "button"
		replace.className = "storyloco-replace"
		replace.dataset.storyloco = "replace"
		replace.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>Replace image`
		replace.addEventListener("pointerleave", (e) => e.relatedTarget !== offered && withdraw())
		addEventListener("scroll", withdraw, { passive: true })
		document.body.append(replace)
	}
	if (offered !== img) {
		withdraw()
		offered = img
		img.dataset.image = ""
		img.addEventListener(
			"pointerleave",
			(e) => e.relatedTarget !== replace && offered === img && withdraw(),
			{ once: true }
		)
	}
	const box = img.getBoundingClientRect()
	replace.style.top = `${Math.max(box.top, 0) + 8}px`
	replace.style.right = `${Math.max(innerWidth - box.right, 0) + 8}px`
	replace.onclick = (e) => {
		e.preventDefault()
		e.stopPropagation()
		withdraw()
		open_picker({
			current: spot.asset,
			save: async (choice) =>
				(await send({
					op: "image",
					story: spot.story,
					uid: spot.uid,
					field: spot.field,
					index: spot.index,
					...choice,
				}))
					? (forget(spot.story), null)
					: last_problem(),
		})
	}
	replace.hidden = false
}

type Choice = { asset: number; alt: string; focus: string; filename: string }

/** The image picker, loaded only when someone opens it */
export async function open_picker({
	current,
	save,
	images = true,
	closed,
}: {
	current: Asset
	save: (choice: Choice) => Promise<string | null>
	images?: boolean
	/** Hears it close, chosen or not */
	closed?: () => void
}) {
	const { default: Picker } = await import("./image_picker.svelte")
	const picker = mount(Picker, {
		target: document.body,
		props: {
			current,
			images,
			list: (search: string, page: number) => call({ op: "assets", search, page }),
			upload: (filename: string, size?: string) => call({ op: "upload", filename, size }),
			uploaded: (asset: number) => call({ op: "uploaded", asset }),
			suggest: (url: string) =>
				call<{ alt: string }>({ op: "ai", do: "alt", url }).then(({ alt }) => alt),
			save,
			close: () => {
				unmount(picker)
				closed?.()
			},
		},
	})
}

/** What a richtext field can have put into it: an image from the library, and the bloks it allows */
export async function rich_inserts(field: Field | undefined): Promise<Inserts> {
	const components = [...(await load_schema()).values()]
	return {
		image: () =>
			new Promise((resolve) => {
				void open_picker({
					current: {},
					closed: () => resolve(null),
					save: async ({ asset, alt, filename }) => {
						resolve({ src: filename, alt, id: asset })
						return null
					},
				})
			}),
		bloks: allowed(components, field).map((component) => ({
			label: component.display_name || component.name.replace(/_/g, " "),
			make: () => fresh_blok(component),
		})),
	}
}

// --- richtext, edited where it shows

/** The richtext field each element shows; its content is read fresh when editing starts */
const riches = new WeakMap<Element, Rich>()

/**
 * The element showing one of its blok's richtext fields: the nearest one around `el` whose
 * text, spaces aside, is the field's. Embedded bloks or anything else in the way and it doesn't
 * match, so only what can be edited whole is offered.
 */
async function rich_at(el: Element): Promise<HTMLElement | undefined> {
	const block = block_of(el)
	const blok = await blok_for(block)
	if (!block || !blok) return
	const fields = rich_fields(blok)
	if (!fields.length) return
	for (let node: Element | null = el; node && node !== block; node = node.parentElement) {
		if (riches.has(node)) return node as HTMLElement
		if (node.querySelector("[data-blok-c]")) return
		const text = (node.textContent ?? "").replace(/\s+/g, "")
		if (!text) continue
		const found = fields.filter(({ value }) => shows_rich(text, rich_compact(value)))
		if (found.length === 1) {
			// the outermost wrapper showing just this text, so the editor takes the site's richtext container
			let outer = node
			while (
				outer.parentElement &&
				outer.parentElement !== block &&
				(outer.parentElement.textContent ?? "").replace(/\s+/g, "") === text
			)
				outer = outer.parentElement
			const { blok: owner, field } = found[0]
			riches.set(outer, { blok: owner, field })
			;(outer as HTMLElement).dataset.rich = field
			return outer as HTMLElement
		}
	}
}

let editing_rich: (() => void) | null = null

async function edit_rich(node: HTMLElement, at: { x: number; y: number }) {
	// taken before anything is awaited: one click arrives twice (pointer and click), and both would
	// otherwise get past this to open two editors on the one field
	if (editing_rich) return
	editing_rich = () => {}
	const { blok, field } = riches.get(node) ?? {}
	const block = block_of(node)
	if (!field || !block || !blok?._uid) return void (editing_rich = null)
	const source = { story: Number(meta(block).id), uid: blok._uid, field }
	bar.hide()
	const room = enter(room_key(source))
	const loaded = await import("./richtext.js").catch(() => null)
	const first = await room.ready
	// edit mode went off meanwhile, or the editor didn't load (say after a deploy): let go
	if (!loaded || !active) {
		editing_rich = null
		leave_room(room)
		if (!loaded) toast("Couldn’t open the text editor; try again")
		return
	}
	const { edit_in_place, shared_doc } = loaded
	const schema = (await load_schema().catch(() => null))?.get(blok.component ?? "")?.schema[field]
	const inserts = await rich_inserts(schema).catch(() => undefined)
	// the first one in starts it from what's saved, not what the page last showed
	const saved = first
		? await call<{ blok: Blok }>({ op: "blok", story: source.story, uid: source.uid })
				.then(({ blok }) => blok[field] as Record<string, unknown> | undefined)
				.catch(() => undefined)
		: undefined
	if (!active) {
		editing_rich = null
		leave_room(room)
		return
	}
	const doc = saved ?? (blok[field] as Record<string, unknown>)

	// saves while it's open leave the page's data be; it catches up once, when the editing's done
	let open = true
	let behind = false
	async function save(value: unknown, together = false) {
		node.dataset.edit = "saving"
		const values = { [source.field]: value }
		const change = { op: "fields", story: source.story, uid: source.uid, values }
		const ok = await send(change, together ? "shared" : "change", { again: !open })
		if (ok && open) behind = true
		delete node.dataset.edit
		if (ok) {
			riches.delete(node)
			delete node.dataset.rich
		} else
			toast(last_problem() ?? "Couldn’t save that", {
				label: "Retry",
				run: () => send(change, together ? "shared" : "change"),
			})
		return Boolean(ok)
	}
	room.value = () => shared_doc(room)
	room.save = save

	tell({ uid: source.uid, field })
	editing_rich = edit_in_place(node, doc, {
		at,
		field: schema as RichField | undefined,
		inserts,
		together: { room, seed: first && !room.doc.getXmlFragment("rich").length },
		end: () => {
			editing_rich = null
			reselect()
			tell(selected ? { uid: selected.uid } : null)
			open = false
			// leaving saves what's unsaved when it's this browser's to save
			void leave_room(room).then(() => {
				if (behind) return refresh()
			})
		},
		save,
	})
	// what's saved: the stored text, or as the editor holds it once it has started the field, so an
	// untouched field isn't saved again just for how the editor writes it
	room.saved ??= first ? room.value() : doc
}

// --- the selected block: its toolbar, and its settings

let bar: { show(target: Target | null): void; hide(): void }

type Inspector = {
	open(selection: Selection, keyboard?: boolean): void
	typing(at: { uid: string; field: string } | null): void
	refresh(): void
	close(): void
	showing(): boolean
}
let inspector: Promise<Inspector> | undefined

/** Where this person is, for the others, and for the settings, which mark the field typed in on the page */
function tell(at: { uid: string; field?: string } | null) {
	live_select(at)
	const field = at?.field
	inspector?.then((panel) => panel.typing(field ? { uid: at.uid, field } : null))
}

/**
 * What the settings can show straight away, from content the page already has: the blok, the
 * bloks it's inside as far as the page shows them, and the schema. The server's copy follows.
 */
function peek({ story, uid }: Selection) {
	if (!components.size) return
	const node = element_of(uid)
	const content = known.get(story)
	const blok =
		(node && (bloks.get(node) as Blok | undefined)) ??
		(page_blok(uid) as Blok | undefined) ??
		(content && (find_blok(content, uid) as Blok | undefined))
	if (!blok?.component) return
	const trail: Array<{ uid: string; component: string }> = []
	for (let at = node?.parentElement?.closest<HTMLElement>("[data-blok-c]"); at;) {
		const { id, uid: above, name } = meta(at)
		if (Number(id) === story && above && name) trail.unshift({ uid: above, component: name })
		at = at.parentElement?.closest<HTMLElement>("[data-blok-c]")
	}
	// the story itself above a block at the top of it, as the server's copy will have it, so the
	// panel's header is its full height from the start rather than growing when that arrives
	if (!trail.length) {
		const root =
			(content?._uid ? content : undefined) ??
			(editor.story?.id === story && editor.story.uid
				? (page_blok(editor.story.uid) as Blok | undefined)
				: undefined)
		if (root?._uid && root.component && root._uid !== uid)
			trail.push({ uid: root._uid, component: root.component })
	}
	trail.push({ uid, component: blok.component })
	return { blok, trail, components }
}

function inspect() {
	return (inspector ??= import("./inspector.svelte")
		.then(
			({ default: Panel }) =>
				mount(Panel, {
					target: document.body,
					props: {
						select,
						highlight,
						picker: open_picker,
						inserts: rich_inserts,
						schema: load_schema,
						deleted,
						peek,
					},
				}) as unknown as Inspector
		)
		// a chunk that didn't load, say after a deploy, is tried again next time
		.catch((e) => {
			inspector = undefined
			throw e
		}))
}

let selected: Selection | null = null

/** Outline the blok with this `_uid` as the selected one, or none */
let told = ""

function highlight(uid: string | null) {
	for (const node of document.querySelectorAll("[data-storyloco-selected]"))
		node.removeAttribute("data-storyloco-selected")
	if (uid) element_of(uid)?.setAttribute("data-storyloco-selected", "")
	place_tag()
	// the others outline it in this person's colour, and the field in it being typed in
	const field = typing_in?.uid === uid ? typing_in.field : undefined
	const telling = `${uid}:${field ?? ""}`
	if (telling !== told) tell(uid ? { uid, field } : null)
	told = telling
}

/** Put the toolbar back on the selected block, say after its text was edited */
function reselect() {
	const node = selected && element_of(selected.uid)
	bar.show((node && target_of(node)) ?? null)
}

/**
 * Select a blok, or a story's root: outline it, pin its toolbar and open its settings.
 * From the keyboard, focus moves into the settings and comes back to the block after.
 */
export async function select(selection: Selection | null, keyboard = false) {
	const before = selected
	selected = selection
	highlight(selection?.uid ?? null)
	const node = selection && element_of(selection.uid)
	bar.show((node && target_of(node)) ?? null)
	if (node) {
		// keep it clear of the settings, which take the lower part of a small screen
		// only when none of it would show: a tall block clicked partway down stays where it is
		const box = node.getBoundingClientRect()
		const room = innerWidth < 640 ? innerHeight * 0.35 : innerHeight
		if (box.bottom < 48 || box.top > room - 48)
			scrollTo({ top: scrollY + box.top - 96, behavior: keyboard ? "auto" : "smooth" })
	}
	const panel = await inspect().catch(() => null)
	if (!panel) return toast("Couldn’t open the block’s settings; try again")
	if (selection) panel.open(selection, keyboard)
	else {
		panel.close()
		if (keyboard && before) element_of(before.uid)?.focus()
	}
}

/** What a click picks: a card linking to another story picks that story, else the blok it's in */
async function selection_at(el: Element): Promise<Selection | undefined> {
	const block = block_of(el)
	const link = el.closest("a[href]")
	if (link && (!block || block.contains(link))) {
		const story = await story_at(link)
		// a link showing the story's name is a card for it, rather than a blok's own link
		if (story && link.textContent?.includes(story.name.trim()) && story.content._uid)
			return { story: story.id, uid: story.content._uid }
	}
	if (!block) return
	const { id, uid } = meta(block)
	return uid ? { story: Number(id), uid } : undefined
}

// --- a word after a change, with a way back

const TOAST = `[data-storyloco=toast]{position:fixed;left:50%;bottom:1.25rem;translate:-50% 0;z-index:2147483003;display:flex;align-items:center;gap:.75rem;max-inline-size:calc(100vw - 2rem);padding:.5rem .5rem .5rem .875rem;border-radius:999px;background:var(--editor-pill,var(--editor-ink,#1b243f));color:#fff;font:500 .8125rem/1.25 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0/.25);transition:opacity .2s,translate .2s}
[data-storyloco=toast][hidden]{display:flex;opacity:0;translate:-50% .75rem;pointer-events:none}
[data-storyloco=toast]:not(:has(button)){padding-inline-end:.875rem}
[data-storyloco=toast] button{all:unset;cursor:pointer;padding:.3rem .75rem;border-radius:999px;background:rgb(255 255 255/.14);white-space:nowrap}
[data-storyloco=toast] button:hover{background:rgb(255 255 255/.24)}
[data-storyloco=toast] button:focus-visible{outline:2px solid #fff;outline-offset:1px}`

let toast_el: HTMLElement | undefined
let toast_timer: ReturnType<typeof setTimeout> | undefined

const DOING: Record<string, string> = { Undo: "Undoing…", Redo: "Redoing…", Refresh: "Refreshing…" }

/** A short note at the foot of the page, with a way back or a retry when there is one */
export function toast(
	message: string,
	action?: { label: string; run: () => Promise<unknown> },
	lasts = action ? 7000 : 3000
) {
	if (!toast_el) {
		const tag = document.createElement("style")
		tag.textContent = TOAST
		document.head.append(tag)
		toast_el = document.createElement("div")
		toast_el.dataset.storyloco = "toast"
		toast_el.setAttribute("role", "status")
		toast_el.hidden = true
		document.body.append(toast_el)
	}
	const el = toast_el
	clearTimeout(toast_timer)
	const text = document.createElement("span")
	text.textContent = message
	el.replaceChildren(text)
	if (action) {
		const button = document.createElement("button")
		button.type = "button"
		button.textContent = action.label
		button.onclick = async () => {
			button.disabled = true
			text.textContent = DOING[action.label] ?? "Trying again…"
			await action.run()
			el.hidden = true
		}
		el.append(button)
	}
	requestAnimationFrame(() => (el.hidden = false))
	toast_timer = setTimeout(() => (el.hidden = true), lasts)
}

/** Undo or redo the last change, saying which, with the way to take that back too */
export async function step(back: boolean) {
	const label = await (back ? undo() : redo())
	if (!label) return toast(last_problem() ?? (back ? "Nothing to undo" : "Nothing to redo"))
	toast(`${back ? "Undid" : "Redid"} ${label}`, {
		label: back ? "Redo" : "Undo",
		run: () => step(!back),
	})
}

/** Deleted, with a way back, from the toolbar or the settings alike */
export function deleted(name: string, _story: unknown, undoable: unknown, after?: () => void) {
	if (!undoable) return toast(`Deleted ${label_of(name)}`)
	toast(`Deleted ${label_of(name)}`, {
		label: "Undo",
		// the delete is the newest change, so it's the one an undo takes back
		run: async () => {
			await undo()
			after?.()
		},
	})
}

// --- the listeners

let active = false

function over(event: PointerEvent) {
	if (!active) return
	const el = event.target as Element
	if (ours(el)) return
	const block = block_of(el)
	// touch has no hover: a tap selects, and the settings carry what hovering would show
	const mouse = event.pointerType === "mouse"
	if (mouse) hover(block, block ? label_of(meta(block).name ?? "") : undefined)

	if (el instanceof HTMLImageElement) {
		if (mouse) spot_of(el).then((spot) => active && spot && offer(el, spot))
		return
	}

	if (!editing_rich) rich_at(el)

	// a held key means press what's there, as it follows a link
	const held = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
	if (event.type === "pointerdown" && !held && !wired.has(el as HTMLElement))
		loosening = edit_loose(event)
	const node = holder(el)
	const run = run_at(el)
	if (run && run !== node) try_wire(run)
	if (!node) return
	try_wire(node)
	// pressing a wrapper's padding edits the text inside it
	if (event.type === "pointerdown" && event.target !== node && wired.has(node))
		requestAnimationFrame(() => node.focus())
}

function click(event: MouseEvent) {
	if (!active) return
	const el = event.target as Element
	if (ours(el)) return
	const block = block_of(el)
	const link = el.closest("a[href]")
	if (!block) return
	// in edit mode a link inside content picks what it shows; held keys still follow it
	if (link && block.contains(link)) {
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
	}
	// so does a button's text, which is edited rather than pressed, like a tab's label
	const button = el.closest("button")
	const editing_label = el.closest("[data-field], [data-rich]") || (button && claimed.has(button))
	if (button && block.contains(button) && editing_label) {
		claimed.delete(button)
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
		event.preventDefault()
		event.stopPropagation()
	}
	const rich = el.closest<HTMLElement>("[data-rich]")
	if (rich && riches.has(rich)) {
		event.preventDefault()
		edit_rich(rich, { x: event.clientX, y: event.clientY })
	}
	const pending = loosening
	selection_at(el).then(async (s) => {
		await pending
		if (!s) return
		// typing in place keeps the toolbar out of the way; the settings follow along if open. The
		// press may have just given text a stand-in to type in, which has the focus by now
		const typing =
			el.closest("[contenteditable]") || wired.has(document.activeElement as HTMLElement)
		if (rich || typing) {
			selected = s
			highlight(s.uid)
			inspector?.then((panel) => panel.showing() && panel.open(s))
		} else select(s)
	})
}

function keydown(event: KeyboardEvent) {
	if (!active && event.key !== "e") return
	const el = event.target as HTMLElement | null
	const typing = el?.closest("input, textarea, select, [contenteditable]")
	const plain = !event.metaKey && !event.ctrlKey && !event.altKey
	if (event.defaultPrevented || typing) return

	if (event.key === "e" && plain && editor.user) {
		set_editing(!editor.editing)
		return
	}
	if (event.key === "c" && plain) {
		event.preventDefault()
		comment()
		return
	}
	// ⌘Z and ⇧⌘Z, or Ctrl+Z and Ctrl+Y, outside a field, where typing has its own undo
	const command = (event.metaKey || event.ctrlKey) && !event.altKey
	if (command && (event.key.toLowerCase() === "z" || event.key === "y")) {
		event.preventDefault()
		step(event.key.toLowerCase() === "z" && !event.shiftKey)
		return
	}
	// a focused block opens with Enter, like any other control
	const block = el?.matches?.("[data-blok-c]") ? el : null
	if (block && event.key === "Enter") {
		event.preventDefault()
		const { id, uid } = meta(block)
		if (uid) select({ story: Number(id), uid }, true)
		return
	}
	// Escape climbs out: to the block around the selected one, then to nothing
	if (event.key === "Escape" && selected) {
		event.preventDefault()
		const node = element_of(selected.uid)
		const up = node && target_of(node) && parent_of(target_of(node)!)
		const keyboard = !!el?.closest("[data-storyloco], [data-blok-c]")
		select(up ? { story: up.story, uid: up.uid } : null, keyboard)
	}
}

/** Blocks take focus in edit mode, so the keyboard reaches each one; empty ones get room to be clicked */
function prepare(on: boolean) {
	for (const node of document.querySelectorAll<HTMLElement>("[data-blok-c]")) {
		if (on && !node.hasAttribute("tabindex")) {
			node.tabIndex = 0
			node.dataset.storylocoTab = ""
			// a site's own label stays; only an unlabelled block is named after its component
			if (!node.hasAttribute("aria-label")) {
				node.setAttribute("aria-label", `${label_of(meta(node).name ?? "")} block`)
				node.dataset.storylocoLabel = ""
			}
		}
		if (!on && node.hasAttribute("data-storyloco-tab")) {
			node.removeAttribute("tabindex")
			delete node.dataset.storylocoTab
			if (node.hasAttribute("data-storyloco-label")) {
				node.removeAttribute("aria-label")
				delete node.dataset.storylocoLabel
			}
		}
		if (on && node.offsetHeight < 8 && target_of(node)) node.dataset.storylocoEmpty = ""
		if (!on) delete node.dataset.storylocoEmpty
	}
}

let hide_presence: (() => void) | null = null

type Comments = { place(on?: boolean): void }
let comments: Promise<Comments> | undefined

/** Comments on the page, with their pins, while edit mode is on */
function show_comments() {
	return (comments ??= import("./comments.svelte").then(
		({ default: Panel }) =>
			mount(Panel, {
				target: document.body,
				props: {
					element_of,
					spot_at: (x: number, y: number) => {
						// what's under the point on the page itself, not a pin being dragged over it
						const under = document
							.elementsFromPoint(x, y)
							.find((el) => !el.closest("[data-storyloco]"))
						const block = block_of(under ?? null)
						const { id, uid } = block ? meta(block) : {}
						if (!block || !uid) return null
						const box = block.getBoundingClientRect()
						return {
							story: Number(id),
							uid,
							rx: (x - box.left) / box.width,
							ry: (y - box.top) / box.height,
							anchor: under ? anchor_at(block, under, x, y) : null,
						}
					},
					color_of: (user: string) =>
						String(editor.user?.id) === user
							? editor.here.color
							: (others().find((p) => String(p.user.id) === user)?.color ?? null),
				},
			}) as unknown as Comments
	))
}

type Tools = { open(view: string): Promise<void> }
let tools: Promise<Tools> | undefined

/** One of the editor's sheets: ⌘K, the page's history, a new page, a review, or a device preview */
export async function tool(
	view:
		| "palette"
		| "history"
		| "compare"
		| "new_page"
		| "review"
		| "share"
		| "verify"
		| "phone"
		| "tablet"
) {
	tools ??= import("./tools.svelte").then(
		({ default: Sheet }) =>
			mount(Sheet, {
				target: document.body,
				props: {
					blocks: () =>
						[...document.querySelectorAll<HTMLElement>("[data-blok-c]")]
							.map(target_of)
							.filter((target) => !!target)
							.map(({ story, uid, name }) => ({ story, uid, name })),
					pick: ({ story, uid }: { story: number; uid: string }) => {
						select({ story, uid })
						element_of(uid)?.scrollIntoView({ block: "center", behavior: "smooth" })
					},
					label: label_of,
					comment,
				},
			}) as unknown as Tools
	)
	await load_schema().catch(() => {})
	await (await tools).open(view)
}

/** Place a new comment: the next click on the page says where. A guest from the link says who they are first */
export async function comment() {
	const guest = editor.guest
	if (!active && guest?.role !== "comment") return
	if (guest && !guest.named) return tool("verify")
	;(await show_comments()).place()
}

/** Everyone else's pointers and selections on the page, and this person's to them */
// --- the field being changed in the settings, marked where the page shows it

/** Where the page shows a field: text typed in place, or rich text */
function shown_at(uid: string, field: string) {
	const found: Array<HTMLElement> = []
	for (const [node, { key }] of shareable)
		if (node.isConnected && key.endsWith(`:${uid}:${field}`)) found.push(node)
	for (const node of document.querySelectorAll<HTMLElement>("[data-rich]")) {
		const rich = riches.get(node)
		if (rich?.blok._uid === uid && rich.field === field) found.push(node)
	}
	return found
}

/** Text set straight into an element beside others, showing a field: no element of its own to mark */
function loose_text(uid: string, field: string) {
	const value = loose(
		text_of((page_blok(uid) as Record<string, unknown> | undefined)?.[field]) ?? ""
	)
	if (!value) return null
	const walker = document.createTreeWalker(element_of(uid) ?? document.body, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null)
		if (loose(node.data) === value && node.parentElement && !ours(node.parentElement)) return node
	return null
}

/** An outline drawn round loose text, kept on it as the page scrolls */
let ring: { el: HTMLElement; place(): void } | null = null
function ring_round(text: Text) {
	const el = document.createElement("div")
	el.dataset.storyloco = "field-ring"
	const range = document.createRange()
	range.selectNodeContents(text)
	const place = () => {
		const box = range.getBoundingClientRect()
		Object.assign(el.style, {
			top: `${box.top - 4}px`,
			left: `${box.left - 4}px`,
			width: `${box.width + 8}px`,
			height: `${box.height + 8}px`,
		})
	}
	place()
	document.body.append(el)
	addEventListener("scroll", place, { passive: true })
	ring = { el, place }
}

function unring() {
	if (!ring) return
	removeEventListener("scroll", ring.place)
	ring.el.remove()
	ring = null
}

let marking = 0
function mark_field(event: Event) {
	const at = (event as CustomEvent<{ uid: string; field: string } | null>).detail
	const mark = ++marking
	for (const node of document.querySelectorAll("[data-storyloco-field]"))
		node.removeAttribute("data-storyloco-field")
	unring()
	if (!at || !active) return
	// its block's text is found as it's first hovered; for this, find it now
	const block = element_of(at.uid)
	if (block) wire_all(block)
	setTimeout(() => {
		if (mark !== marking) return
		const found = shown_at(at.uid, at.field)
		for (const node of found) node.setAttribute("data-storyloco-field", "")
		if (found[0]) return found[0].scrollIntoView({ block: "nearest", behavior: "smooth" })
		const text = loose_text(at.uid, at.field)
		if (!text) return
		text.parentElement!.scrollIntoView({ block: "nearest", behavior: "smooth" })
		ring_round(text)
	}, 150)
}

function present() {
	go_live()
	hide_presence ??= show_presence({
		element_of,
		block_of,
		uid_of: (node) => meta(node).uid,
		field_of: (uid, field) => {
			for (const [node, { key }] of shareable)
				if (node.isConnected && key.endsWith(`:${uid}:${field}`)) return node
			return element_of(uid)?.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)
		},
	})
}

let welcomed = false

/** A guest's page, the draft shared with them: who else is here, and the comments if they may comment */
export function welcome() {
	if (welcomed || installed) return
	welcomed = true
	present()
	if (editor.guest?.role === "comment") show_comments()
}

function arm(on: boolean) {
	active = on
	if (on) {
		present()
		show_comments()
		load_schema()
			.then(() => active && prepare(true))
			.catch(() => {})
		// the settings and the richtext editor, ready before the first click rather than after it
		;(window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 300)))(() => {
			if (!active) return
			inspect().catch(() => {})
			import("./richtext.js").catch(() => {})
		})
		return
	}
	go_offline()
	hide_presence?.()
	hide_presence = null
	comments?.then((panel) => unmount(panel as unknown as Record<string, unknown>))
	comments = undefined
	bar?.hide()
	hover(null)
	withdraw()
	editing_rich?.()
	for (const unwire of [...wired.values()]) unwire()
	for (const node of document.querySelectorAll<HTMLElement>("[data-rich]")) delete node.dataset.rich
	prepare(false)
	if (selected) select(null)
}

/**
 * Without `connect()`, the page's story is the one most of its blocks come from, which
 * outnumbers a layout's header and footer; fetched for its status, and again after each save
 */
async function detect() {
	if (connected_story()) return detected_story(null)
	const counts = new Map<number, number>()
	for (const node of document.querySelectorAll("[data-blok-c]")) {
		const id = Number(meta(node).id)
		if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
	}
	const [story] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? []
	if (!story) return detected_story(null)
	const found = await call<{ story: Parameters<typeof detected_story>[0] }>({
		op: "story",
		story,
	}).catch(() => null)
	detected_story(found?.story ?? null)
	// the others' lists of who's on this page say which story it is
	here()
}

/** The save someone else made that the page last said so about, so it says so once */
let noticed = ""

/** Someone else saving the page's story while it's open: say so, before edits pile up on an older copy */
async function check() {
	const story = editor.story
	if (!active || !story?.updated_at || editor.saving || document.hidden) return
	const found = await call<{
		story: { updated_at: string }
		by: { id: number; name: string | null } | null
	}>({ op: "story", story: story.id }).catch(() => null)
	if (!found || found.story.updated_at === noticed || editor.saving) return
	const newer = Date.parse(found.story.updated_at) - Date.parse(story.updated_at) > 1000
	if (!newer || found.by?.id === editor.user?.id) return
	noticed = found.story.updated_at
	const who = found.by?.name?.split(" ")[0] ?? "Someone"
	toast(`${who} changed this page`, { label: "Refresh", run: refresh }, 30_000)
}

let installed = false

/**
 * What may go beside each block, for the bar's add menu: kept until the page changes, which is
 * all that changes it, short of the schema
 */
type Menu = { full: boolean; components: Array<{ name: string; display_name: string }> }
const menus = new Map<string, Promise<Menu>>()
function menu_for(story: number, uid: string) {
	const key = `${story}:${uid}`
	let menu = menus.get(key)
	if (!menu) {
		menu = call<Menu>({ op: "blocks", story, uid })
		menu.catch(() => menus.delete(key))
		menus.set(key, menu)
	}
	return menu
}

/** Set the page up for editing, once, the first time a blok is marked */
export function install() {
	if (installed) return
	installed = true
	style()
	bar = mount(BlockBar, {
		target: document.body,
		props: {
			act: async (change: Record<string, unknown>) => {
				const reply = (await send(change)) as { uid?: string; undo?: unknown } | null
				// a list's length is what says it's full
				menus.clear()
				if (!reply) return last_problem() ?? "Couldn’t save"
				if (change.op === "remove") deleted(String(change.name ?? ""), change.story, reply.undo)
				return reply
			},
			choices: menu_for,
			// the blocks in the same list, from the story: a site may wrap each block in an element of its own
			siblings: async (story: number, uid: string) =>
				(locate(await content_for(story), uid)?.list ?? []).map((blok) =>
					typeof blok._uid === "string" ? (element_of(blok._uid) ?? null) : null
				),
			find,
			select: (target: Target | null) =>
				select(target ? { story: target.story, uid: target.uid } : null),
			parent: parent_of,
			label: (name: string) => components.get(name)?.display_name || undefined,
		},
	}) as unknown as typeof bar
	document.addEventListener("pointerover", over)
	document.addEventListener("pointerdown", over)
	document.addEventListener("click", click, true)
	document.addEventListener("keydown", keydown)
	// a blok embedded in richtext, clicked in the text: its own fields, as the block it belongs to's story
	document.addEventListener("storyloco:embed", (event) => {
		const { uid } = (event as CustomEvent<{ uid: string }>).detail
		const story = selected?.story ?? editor.story?.id
		if (uid && story) select({ story, uid }, true)
	})
	addEventListener("scroll", place_tag, { passive: true })
	addEventListener("storyloco:panel-field", mark_field)
	// a save re-renders the page, and the selected blok's element with it
	on_saved(() => {
		swept = new WeakSet()
		fetched = new Map()
		known.clear()
		if (selected) highlight(selected.uid)
		if (selected && !document.activeElement?.closest("[contenteditable]")) reselect()
		if (active) prepare(true)
		inspector?.then((panel) => panel.refresh())
	})
	on_editing(arm)
	arm(editor.editing)
	detect()
	on_saved(detect)
	// whether there's anything to publish, by content rather than by when it was last saved
	let checking: ReturnType<typeof setTimeout> | undefined
	const live_check = () => {
		clearTimeout(checking)
		checking = setTimeout(() => editor.story && check_live(editor.story.id), 800)
	}
	// straight away on arrival, so the edit bar doesn't show a guess first
	if (editor.story) check_live(editor.story.id)
	else live_check()
	on_saved(live_check)
	on_navigate(live_check)
	on_navigate(() => {
		detect()
		if (active) prepare(true)
		// a block selected on the last page isn't on this one
		if (selected && !element_of(selected.uid)) select(null)
		// nor is text from it that was ready to edit, which lets go of its field
		for (const [node, unwire] of wired) if (!node.isConnected) unwire()
	})
	on_people(follow)
	setInterval(check, 30_000)
	document.addEventListener("visibilitychange", check)
}
