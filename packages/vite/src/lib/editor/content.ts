/** A story's content, or any part of it */
export type Node = Record<string, unknown>

/** The blok with this `_uid`, anywhere in the content — nested bloks and richtext embeds included */
export function find_blok(value: unknown, uid: string): Node | undefined {
	if (!value || typeof value !== "object") return
	if ((value as Node)._uid === uid) return value as Node
	for (const child of Object.values(value)) {
		const found = find_blok(child, uid)
		if (found) return found
	}
}

/** What a text field shows: a plain string, or the `text` of a heading-style plugin value */
export function text_of(value: unknown): string | undefined {
	if (typeof value === "string") return value
	if (value && typeof value === "object" && typeof (value as Node).text === "string")
		return (value as Node).text as string
}

/**
 * Set a blok's text field, keeping a plugin value's other properties (a heading's level and
 * tag). Only fields that already hold text, so a typo'd field can't clobber a richtext or asset.
 */
export function set_text(blok: Node, field: string, value: string) {
	const existing = blok[field]
	if (typeof existing === "string") blok[field] = value
	else if (text_of(existing) !== undefined) blok[field] = { ...(existing as Node), text: value }
	else return false
	return true
}

const is_asset = (value: unknown): value is Node =>
	!!value && typeof value === "object" && (value as Node).fieldtype === "asset"

/**
 * Put an asset into a blok's asset field, or at `index` in a multiasset, keeping whatever else
 * the field held. Only fields that already hold assets, like `set_text`.
 */
export function set_asset(blok: Node, field: string, index: number | undefined, asset: Node) {
	const existing = blok[field]
	if (index === undefined) {
		if (!is_asset(existing)) return false
		blok[field] = { ...existing, ...asset }
		return true
	}
	if (!Array.isArray(existing) || !is_asset(existing[index])) return false
	existing[index] = { ...existing[index], ...asset }
	return true
}

/** Where a blok sits: the list holding it, and the blok and field that list belongs to */
export type Place = { parent: Node; field: string; list: Array<Node>; index: number }

/** Bloks fields and richtext embeds alike, so a nested blok can be found wherever it lives */
export function locate(value: unknown, uid: string): Place | undefined {
	if (!value || typeof value !== "object") return
	for (const [field, child] of Object.entries(value)) {
		if (Array.isArray(child)) {
			const index = child.findIndex((item) => (item as Node | null)?._uid === uid)
			if (index !== -1) return { parent: value as Node, field, list: child as Array<Node>, index }
		}
		const found = locate(child, uid)
		if (found) return found
	}
}

/** A copy with fresh `_uid`s all the way down, as Storyblok's own duplicate makes */
export function copy_blok(blok: Node, uid: () => string = () => crypto.randomUUID()): Node {
	const fresh = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(fresh)
		if (!value || typeof value !== "object") return value
		const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fresh(v)]))
		if (typeof out._uid === "string") out._uid = uid()
		return out
	}
	return fresh(structuredClone(blok)) as Node
}

/** The bloks from the content's root down to the one with this `_uid`, both included */
export function trail(
	value: unknown,
	uid: string,
	above: Array<Node> = []
): Array<Node> | undefined {
	if (!value || typeof value !== "object") return
	const node = value as Node
	const here =
		typeof node._uid === "string" && typeof node.component === "string" ? [...above, node] : above
	if (node._uid === uid) return here
	for (const child of Object.values(value)) {
		const found = trail(child, uid, here)
		if (found) return found
	}
}

/** Richtext nodes and marks the editor can round-trip without losing anything */
export const RICH_NODES = new Set([
	"doc",
	"paragraph",
	"text",
	"heading",
	"bullet_list",
	"ordered_list",
	"list_item",
	"blockquote",
	"hard_break",
	"horizontal_rule",
	"code_block",
	"image",
	"blok",
	"table",
	"tableRow",
	"tableCell",
	"tableHeader",
])
export const RICH_MARKS = new Set([
	"bold",
	"italic",
	"strike",
	"underline",
	"code",
	"link",
	"superscript",
	"subscript",
	"highlight",
	"styled",
	"textStyle",
	"anchor",
])

type Rich = {
	type?: string
	text?: string
	content?: Array<Rich>
	marks?: Array<{ type?: string }>
}

/** Whether every node and mark in a richtext value is one the editor knows */
export function rich_supported(value: unknown): boolean {
	const node = value as Rich | null
	if (!node || typeof node !== "object" || !RICH_NODES.has(node.type ?? "")) return false
	if (node.marks?.some((mark) => !RICH_MARKS.has(mark.type ?? ""))) return false
	return (node.content ?? []).every(rich_supported)
}

const EMBED = "\0"

/** A richtext value's text with no spaces at all, to find the element showing it; a blok in it is a gap */
export function rich_compact(value: unknown): string {
	const node = value as Rich | null
	if (!node || typeof node !== "object") return ""
	if (node.type === "blok") return EMBED
	return (node.text ?? "").replace(/\s+/g, "") + (node.content ?? []).map(rich_compact).join("")
}

/**
 * Whether an element's text, spaces aside, is a richtext value's: the same, or with whatever the
 * site shows for each blok embedded in it, a button's label say, in its gaps
 */
export function shows_rich(text: string, compact: string) {
	const pieces = compact.split(EMBED)
	if (pieces.length === 1) return text === compact
	if (!pieces.join("") || !text.startsWith(pieces[0]) || !text.endsWith(pieces.at(-1)!))
		return false
	let at = pieces[0].length
	for (const piece of pieces.slice(1, -1)) {
		const found = text.indexOf(piece, at)
		if (found < 0) return false
		at = found + piece.length
	}
	return at <= text.length - pieces.at(-1)!.length
}

/** A richtext document, as opposed to a string or a plugin's object */
export const is_rich = (value: unknown) =>
	!!value && typeof value === "object" && (value as Rich).type === "doc"

const is_blok = (value: unknown): value is Node =>
	!!value &&
	typeof value === "object" &&
	typeof (value as Node)._uid === "string" &&
	typeof (value as Node).component === "string"

/** Every blok in some content by `_uid`, the root included, with the blok it's inside */
function bloks_of(content: unknown) {
	const all = new Map<string, Node>()
	const above = new Map<string, string>()
	const walk = (value: unknown, parent?: string) => {
		if (!value || typeof value !== "object") return
		if (is_blok(value)) {
			all.set(value._uid as string, value)
			if (parent) above.set(value._uid as string, parent)
			parent = value._uid as string
		}
		for (const child of Object.values(value)) walk(child, parent)
	}
	walk(content)
	return { all, above }
}

const holds_bloks = (value: unknown) => Array.isArray(value) && value.every(is_blok)

/**
 * Only what shows: no nulls, empty objects or Storyblok's editor markers, and richtext marks in
 * any order. Editors save richtext with or without `attrs: { textAlign: null }`, bold before or
 * after a colour, and the page looks the same either way.
 */
function meaningful(value: unknown, key = ""): unknown {
	if (Array.isArray(value)) {
		const items = value.map((item) => meaningful(item))
		return key === "marks"
			? items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
			: items
	}
	if (!value || typeof value !== "object") return value
	// in key order, since Storyblok hands back a node's keys in an order of its own
	const kept = Object.entries(value)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.filter(([k]) => k !== "_editable")
		.map(([k, v]) => [k, meaningful(v, k)] as const)
		.filter(
			([, v]) =>
				v !== null &&
				v !== undefined &&
				!(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)
		)
	return Object.fromEntries(kept)
}

/** A blok's own fields, leaving out the bloks inside it, which are compared on their own */
const own = (blok: Node) =>
	JSON.stringify(
		Object.keys(blok)
			.filter((key) => key !== "_editable" && !holds_bloks(blok[key]))
			.sort()
			.map((key) => [key, meaningful(blok[key])])
	)

/** The order of a blok's children, counting only those in both versions, so adding one isn't also a move */
const order = (blok: Node, keep: (uid: string) => boolean) =>
	Object.keys(blok)
		.filter((key) => holds_bloks(blok[key]))
		.sort()
		.map(
			(key) =>
				`${key}:${(blok[key] as Array<Node>)
					.map((child) => child._uid as string)
					.filter(keep)
					.join()}`
		)
		.join("|")

const HINTS = ["title", "headline", "heading", "name", "label", "text", "subtitle", "suptitle"]

/** A few words of a blok's own text, to tell it from others of its kind */
function hint_of(blok: Node) {
	const keys = [...HINTS, ...Object.keys(blok)]
	for (const key of keys) {
		if (key.startsWith("_") || key === "component") continue
		const text = text_of(blok[key])?.trim()
		if (text && !/^(https?:|#|\/)/.test(text) && text.length < 300)
			return text.length > 48 ? `${text.slice(0, 47)}…` : text
	}
}

export type Difference = {
	uid: string
	component: string
	kind: "added" | "removed" | "edited" | "reordered"
	hint?: string
}

/** What changed between a story's published content and its draft, block by block */
export function differences(published: unknown, draft: unknown): Array<Difference> {
	const { all: before, above: was_in } = bloks_of(published)
	const { all: after, above: is_in } = bloks_of(draft)
	const both = (uid: string) => before.has(uid) && after.has(uid)
	const out: Array<Difference> = []
	for (const [uid, blok] of after) {
		const was = before.get(uid)
		// a new blok's own children come with it
		const parent = is_in.get(uid)
		if (!was && parent && !before.has(parent)) continue
		const kind = !was
			? "added"
			: own(was) !== own(blok)
				? "edited"
				: order(was, both) !== order(blok, both)
					? "reordered"
					: null
		if (kind) out.push({ uid, component: blok.component as string, kind, hint: hint_of(blok) })
	}
	for (const [uid, blok] of before)
		if (!after.has(uid) && after.has(was_in.get(uid) ?? ""))
			out.push({ uid, component: blok.component as string, kind: "removed", hint: hint_of(blok) })
	return out
}

/** Whether two values show the same, by the measure `differences` uses */
export const same = (a: unknown, b: unknown) =>
	JSON.stringify(meaningful(a)) === JSON.stringify(meaningful(b))

const is_story = (value: unknown): value is Node =>
	!!value &&
	typeof value === "object" &&
	typeof (value as Node).uuid === "string" &&
	"content" in value &&
	"full_slug" in value

/** A field as a saved version keeps it: resolved relations back to their ids, links without their stories */
function unresolved(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(unresolved)
	if (!value || typeof value !== "object") return value
	if (is_story(value)) return value.uuid
	const out: Node = {}
	for (const [key, child] of Object.entries(value))
		if (!(key === "story" && "linktype" in value)) out[key] = unresolved(child)
	return out
}

/**
 * A saved version's content as the page would have it, to show in its place. A version keeps
 * relations and links as ids where the page has their stories resolved, so a field the page has
 * the same takes the page's value, and a changed relation takes a story the page already has, or
 * is left out: a component never gets an id where it expects a story.
 */
export function like_page(version: unknown, page: unknown): unknown {
	const stories = new Map<string, Node>()
	const bloks = new Map<string, Node>()
	const collect = (value: unknown) => {
		if (!value || typeof value !== "object") return
		if (is_story(value)) stories.set(value.uuid as string, value)
		if (is_blok(value)) bloks.set(value._uid as string, value)
		for (const child of Object.values(value)) collect(child)
	}
	collect(page)
	const walk = (value: unknown, theirs: unknown): unknown => {
		if (typeof value === "string") return is_story(theirs) ? (stories.get(value) ?? null) : value
		if (Array.isArray(value)) {
			if (Array.isArray(theirs) && theirs.some(is_story))
				return value.flatMap((item) =>
					typeof item === "string" ? (stories.has(item) ? [stories.get(item)] : []) : [item]
				)
			return value.map((item) => walk(item, undefined))
		}
		if (!value || typeof value !== "object") return value
		const mine = is_blok(value) ? bloks.get(value._uid as string) : (theirs as Node | undefined)
		const out: Node = {}
		for (const [key, child] of Object.entries(value)) {
			const page_value = mine && typeof mine === "object" ? mine[key] : undefined
			out[key] =
				page_value !== undefined && JSON.stringify(unresolved(page_value)) === JSON.stringify(child)
					? page_value
					: walk(child, page_value)
		}
		return out
	}
	return walk(version, page)
}

/** A component as far as choosing and making one goes */
type Component = {
	name: string
	is_nestable?: boolean
	component_group_uuid?: string | null
	internal_tag_ids?: Array<string | number> | null
	schema: Record<string, { type?: string; default_value?: unknown }>
}

/** Which components a bloks field or a richtext field's embeds may hold */
type Restricts = {
	type?: string
	restrict_components?: boolean
	restrict_type?: string | null
	component_whitelist?: Array<string> | null
	component_group_whitelist?: Array<string> | null
	component_tag_whitelist?: Array<string | number> | null
}

/** What the list's field allows, as its schema says; any nestable blok in a richtext embed */
export function allowed<C extends Component>(components: Array<C>, field: Restricts | undefined) {
	const nestable = components.filter((c) => c.is_nestable)
	if (!field?.restrict_components) return nestable
	if (field.restrict_type === "groups")
		return nestable.filter((c) =>
			field.component_group_whitelist?.includes(c.component_group_uuid ?? "")
		)
	if (field.restrict_type === "tags")
		return nestable.filter((c) =>
			c.internal_tag_ids?.some((tag) =>
				field.component_tag_whitelist?.map(String).includes(String(tag))
			)
		)
	return nestable.filter((c) => field.component_whitelist?.includes(c.name))
}

/** A new blok with its schema's defaults, as Storyblok makes one */
export function fresh_blok(component: Component): Node {
	const blok: Node = { _uid: crypto.randomUUID(), component: component.name }
	for (const [key, field] of Object.entries(component.schema)) {
		const value = field.default_value
		if (value === undefined || value === null || value === "") continue
		if (field.type === "boolean") blok[key] = value === true || value === "true"
		else if (field.type === "number") blok[key] = Number(value)
		else blok[key] = value
	}
	return blok
}
