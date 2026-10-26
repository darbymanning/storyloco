import { Editor, Mark, Node, mergeAttributes, type JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import Code from "@tiptap/extension-code"
import CodeBlock from "@tiptap/extension-code-block"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
import Image from "@tiptap/extension-image"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import Text from "@tiptap/extension-text"
import Underline from "@tiptap/extension-underline"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap"
import { call } from "./client.js"
import { quietly, type Room } from "./live.js"

/*
 * Richtext edited as Storyblok stores it. The extensions take Storyblok's names and attributes
 * (`bullet_list`, a link's `uuid` and `linktype`, embedded `blok`s), so a document goes in and
 * comes out as the same JSON, with nothing turned into HTML and back on the way.
 */

const attrs = (names: Record<string, unknown>) => () =>
	Object.fromEntries(Object.entries(names).map(([name, value]) => [name, { default: value }]))

/** A table cell's attributes, its background colour among them */
function coloured(this: { parent?: (() => Record<string, unknown>) | null }) {
	return {
		...this.parent?.(),
		backgroundColor: {
			default: null,
			renderHTML: ({ backgroundColor }: { backgroundColor?: string | null }) =>
				backgroundColor ? { style: `background-color:${backgroundColor}` } : {},
		},
	}
}

/** A block's alignment, kept as Storyblok keeps it and shown while editing */
const aligned = (names: Record<string, unknown>) => () => ({
	...attrs(names)(),
	textAlign: {
		default: null,
		renderHTML: ({ textAlign }: { textAlign?: string | null }) =>
			textAlign ? { style: `text-align:${textAlign}` } : {},
	},
})

/**
 * What the site shows of the text: a colour or highlight it doesn't render isn't shown while
 * editing either, and each kind of element carries the classes the site's own does, so styles
 * scoped to them, like a component's, reach the editor's copy too
 */
type Shows = {
	colour: boolean
	classes?: Partial<Record<Tag, string>>
	/** How the site shows each blok embedded in the text, by its `_uid`, to show it the same */
	embeds?: Map<string, Element>
	/** The element and classes the site shows each kind of text as, like a paragraph as an `h1` */
	looks?: Partial<Record<Look, { tag: string; class: string }>>
}
type Tag = "p" | "h" | "blockquote" | "ul" | "ol" | "li" | "strong" | "em" | "a" | "code" | "table"

type Look = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bold" | "italic" | "table"

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, "")

/**
 * The innermost element in `source` showing just this text, spaces aside; for a block, the
 * innermost that's laid out as one, not a link or bold run that happens to fill it
 */
function showing(source: Element, text: string, block = false) {
	if (!text) return null
	const fits = (el: Element) =>
		squash(el.textContent) === text && (!block || getComputedStyle(el).display !== "inline")
	let found = [...source.querySelectorAll("*")].find(fits)
	for (let only = found; only?.children.length === 1;) {
		only = only.firstElementChild!
		if (!fits(only)) break
		found = only
	}
	return found ?? null
}

/**
 * How the site shows each kind of text, found by its words: the first paragraph, heading of
 * each level, and bold or italic run, as the element showing just that text. A site that shows a
 * title's paragraph as a styled `h1`, or bold as a gradient `span`, is shown that way editing too.
 */
function looks_in(source: Element, doc: RichDoc) {
	const looks: Partial<Record<Look, { tag: string; class: string }>> = {}
	const note = (look: Look, el: Element | null) => {
		if (el && !looks[look])
			looks[look] = { tag: el.localName, class: el.getAttribute("class") ?? "" }
	}
	const walk = (node: JSONContent) => {
		if (node.type === "paragraph" || node.type === "heading") {
			const look = node.type === "heading" ? (`h${node.attrs?.level ?? 2}` as Look) : "p"
			if (!looks[look]) note(look, showing(source, squash(rich_text(node)), true))
		}
		if (node.type === "text" && node.marks?.length === 1 && squash(node.text).length > 1) {
			const look = ({ bold: "bold", italic: "italic" } as const)[node.marks[0].type as "bold"]
			if (look && !looks[look]) note(look, showing(source, squash(node.text)))
		}
		node.content?.forEach(walk)
	}
	walk(doc)
	// the element a site puts round each table, like a scroller its table styles hang off
	const table = source.querySelector("table")
	const wrapper = table?.parentElement
	if (wrapper && wrapper !== source && source.contains(wrapper) && wrapper.children.length === 1)
		note("table", wrapper)
	return looks
}

const rich_text = (node: JSONContent): string =>
	(node.text ?? "") + (node.content ?? []).map(rich_text).join("")

/**
 * What the site shows for each blok embedded in the text: what's among the text's blocks that isn't
 * one, in order, when there's one each
 */
function embeds_in(source: Element, doc: RichDoc) {
	const uids = (doc.content ?? [])
		.filter((node) => node.type === "blok")
		.map((node) => (node.attrs?.body as Array<{ _uid?: string }> | undefined)?.[0]?._uid ?? "")
	const shown = [...source.children].filter(
		(el) => !el.matches("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,hr,pre,img,figure,br")
	)
	if (!uids.length || shown.length !== uids.length) return undefined
	return new Map(uids.map((uid, i) => [uid, shown[i]]))
}

/** The classes the site gave its first element of each kind in this text */
function classes_in(source: Element) {
	const selectors: Record<Tag, string> = {
		p: "p",
		h: "h1,h2,h3,h4,h5,h6",
		blockquote: "blockquote",
		ul: "ul",
		ol: "ol",
		li: "li",
		strong: "strong,b",
		em: "em,i",
		a: "a",
		code: "code",
		table: "table",
	}
	const out: Partial<Record<Tag, string>> = {}
	for (const [tag, selector] of Object.entries(selectors) as Array<[Tag, string]>) {
		const found = source.querySelector(selector)?.getAttribute("class")
		if (found) out[tag] = found
	}
	return out
}

/** The panel's editor is the panel's, not the page's: no colours or classes from the site, so the text and caret read on it */
function extensions(shows: Shows = { colour: false }) {
	/** As the site shows this kind of text, where it's been seen, else as the editor would */
	const looking = (
		look: Look,
		tag: string,
		options: Record<string, unknown>,
		attributes: Record<string, unknown>
	) => {
		const seen = shows.looks?.[look]
		return [
			seen?.tag ?? tag,
			seen
				? mergeAttributes(attributes, { class: seen.class })
				: mergeAttributes(options, attributes),
			0,
		] as const
	}
	// rendered, not stored: the class is the site's, and never reaches the content
	const like = (tag: Tag) => ({
		HTMLAttributes: shows.classes?.[tag] ? { class: shows.classes[tag] } : {},
	})
	return [
		Document,
		Text,
		Paragraph.extend({
			addAttributes: aligned({}),
			renderHTML({ HTMLAttributes }) {
				return looking("p", "p", this.options.HTMLAttributes, HTMLAttributes)
			},
		}).configure(like("p")),
		Heading.extend({
			addAttributes: aligned({ level: 2 }),
			renderHTML({ node, HTMLAttributes }) {
				const tag = `h${node.attrs.level}` as Look
				return looking(tag, tag, this.options.HTMLAttributes, HTMLAttributes)
			},
		}).configure(like("h")),
		Blockquote.configure(like("blockquote")),
		BulletList.extend({
			name: "bullet_list",
			addOptions() {
				return { ...this.parent!(), itemTypeName: "list_item" }
			},
		}).configure(like("ul")),
		OrderedList.extend({
			name: "ordered_list",
			addAttributes: attrs({ order: 1 }),
			addOptions() {
				return { ...this.parent!(), itemTypeName: "list_item" }
			},
		}).configure(like("ol")),
		ListItem.extend({
			name: "list_item",
			addOptions() {
				return {
					...this.parent!(),
					bulletListTypeName: "bullet_list",
					orderedListTypeName: "ordered_list",
				}
			},
		}).configure(like("li")),
		Table.extend({
			renderHTML(props) {
				const table = this.parent!(props)
				const wrap = shows.looks?.table
				return wrap ? [wrap.tag, { class: wrap.class }, table] : table
			},
			// drawn from renderHTML, not Tiptap's own wrapper, so a site's wrapper can stand in its place
		}).configure({ resizable: false, View: null, ...like("table") }),
		TableRow,
		// a cell's colour, kept as Storyblok keeps it, so a table saved from here loses nothing
		TableCell.extend({ addAttributes: coloured }),
		TableHeader.extend({ addAttributes: coloured }),
		HardBreak.extend({ name: "hard_break" }),
		HorizontalRule.extend({ name: "horizontal_rule" }),
		CodeBlock.extend({ name: "code_block", addAttributes: attrs({ class: null }) }),
		Image.extend({
			addAttributes: attrs({
				src: null,
				alt: null,
				title: null,
				id: null,
				source: null,
				copyright: null,
				meta_data: null,
			}),
		}),
		Bold.extend({
			renderHTML({ HTMLAttributes }) {
				return looking("bold", "strong", this.options.HTMLAttributes, HTMLAttributes)
			},
		}).configure(like("strong")),
		Italic.extend({
			renderHTML({ HTMLAttributes }) {
				return looking("italic", "em", this.options.HTMLAttributes, HTMLAttributes)
			},
		}).configure(like("em")),
		Strike,
		Underline,
		Code.configure(like("code")),
		Superscript,
		Subscript,
		Highlight.extend({
			addAttributes: attrs({ color: null }),
			...(shows.colour ? {} : { renderHTML: () => ["span", {}, 0] as const }),
		}),
		Link.extend({
			addAttributes: attrs({
				href: null,
				uuid: null,
				anchor: null,
				target: null,
				linktype: "url",
				custom: null,
				title: null,
			}),
		}).configure({ openOnClick: false, autolink: false, ...like("a") }),
		Mark.create({
			name: "styled",
			addAttributes: attrs({ class: null }),
			renderHTML: ({ HTMLAttributes }) => ["span", shows.classes ? HTMLAttributes : {}, 0],
		}),
		Mark.create({
			name: "textStyle",
			addAttributes: attrs({ color: null, id: null }),
			renderHTML: ({ HTMLAttributes }) => [
				"span",
				{ style: shows.colour && HTMLAttributes.color ? `color:${HTMLAttributes.color}` : null },
				0,
			],
		}),
		Mark.create({
			name: "anchor",
			addAttributes: attrs({ id: null }),
			renderHTML: ({ HTMLAttributes }) => ["span", { id: HTMLAttributes.id }, 0],
		}),
		// a blok embedded in the text keeps everything it holds; it's moved or removed here, and a click opens its fields
		Node.create({
			name: "blok",
			group: "block",
			atom: true,
			draggable: true,
			addAttributes: attrs({ id: null, body: [] }),
			renderHTML: ({ node }) => {
				const [blok] = (node.attrs.body as Array<{ component?: string; _uid?: string }>) ?? []
				const name = (blok?.component ?? "block").replace(/_/g, " ")
				const shown = blok?._uid && shows.embeds?.get(blok._uid)
				if (shown)
					return [
						"div",
						{
							"data-storyloco-embed": blok._uid,
							"data-site": "",
							contenteditable: "false",
							title: `Edit the ${name}`,
						},
						shown.cloneNode(true),
					]
				return [
					"div",
					{
						"data-storyloco-embed": blok?._uid ?? "",
						contenteditable: "false",
						title: `Edit the ${name}`,
					},
					["span", {}, `Embedded ${name}`],
					["span", { "data-storyloco-embed-edit": "" }, "Edit"],
				]
			},
		}),
	]
}

// --- the format bar

const STYLE = `[data-storyloco=format]{position:fixed;z-index:2147483001;display:flex;align-items:center;gap:2px;padding:4px;border-radius:12px;background:var(--editor-pill,var(--editor-ink,#1b243f));color:#fff;font:500 13px/1 system-ui,sans-serif;box-shadow:0 8px 24px rgb(0 0 0/.25);transition:opacity .15s,translate .15s;animation:storyloco-format .16s ease-out}
[data-storyloco=format][data-fixed]{position:sticky;top:0;inset-inline:auto;margin-block-end:6px;width:max-content;max-width:100%;flex-wrap:wrap;background:color-mix(in srgb,var(--editor-ink,#1b243f) 6%,var(--editor-bg,#fff));color:var(--editor-ink,#1b243f);box-shadow:none;animation:none}
[data-storyloco=format] button{all:unset;box-sizing:border-box;display:grid;place-items:center;min-width:28px;height:28px;padding:0 6px;border-radius:8px;cursor:pointer;font:inherit}
[data-storyloco=format] button:hover{background:rgb(255 255 255/.14)}
[data-storyloco=format][data-fixed] button:hover{background:rgb(0 0 0/.07)}
[data-storyloco=format] button[aria-pressed=true]{background:var(--editor-accent,#05807f);color:var(--editor-accent-ink,#fff)}
[data-storyloco=format] button:focus-visible{outline:2px solid var(--editor-accent,#05807f)}
[data-storyloco=format] svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
[data-storyloco=format] .sep{width:1px;height:16px;background:currentColor;opacity:.2;margin:0 3px}
[data-storyloco=format] .word{padding:0 9px;white-space:nowrap}
[data-storyloco=format] .kind{gap:2px;grid-auto-flow:column;min-width:64px;justify-content:space-between;padding:0 6px 0 9px}
[data-storyloco=format] .kind svg{width:13px;height:13px;opacity:.6}
[data-storyloco=format] [aria-expanded=true],[data-storyloco=format] .more-button[aria-pressed=true]{background:rgb(255 255 255/.14)}
[data-storyloco=format] .menu{position:absolute;top:calc(100% + 6px);left:0;z-index:1;display:grid;gap:10px;width:max-content;max-width:min(296px,calc(100vw - 32px));padding:10px;border-radius:12px;background:var(--editor-pill,var(--editor-ink,#1b243f));color:#fff;box-shadow:0 12px 32px rgb(0 0 0/.3);animation:storyloco-format .14s ease-out}
[data-storyloco=format][data-fixed] .menu{background:var(--editor-bg,#fff);color:var(--editor-ink,#1b243f);box-shadow:0 12px 32px rgb(0 0 0/.18),0 0 0 1px rgb(0 0 0/.06)}
[data-storyloco=format] .group{display:grid;gap:4px}
[data-storyloco=format] .legend{padding:0 6px;font-size:11px;font-weight:600;letter-spacing:.02em;opacity:.55}
[data-storyloco=format] .row{display:flex;flex-wrap:wrap;gap:2px}
[data-storyloco=format] .list{display:grid;max-height:260px;overflow:auto;gap:1px}
[data-storyloco=format] .item{justify-content:start;place-items:center start;width:100%;min-width:160px;padding:0 10px;white-space:nowrap}
[data-storyloco=format] .item[data-level]{font-weight:650}
[data-storyloco=format] .item[data-level="1"]{font-size:17px}
[data-storyloco=format] .item[data-level="2"]{font-size:15.5px}
[data-storyloco=format] .item[data-level="3"]{font-size:14.5px}
[data-storyloco=format] .back{opacity:.7}
[data-storyloco=format] .swatch{width:18px;height:18px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(127 127 127/.4)}
[data-storyloco=format] input[type=color]{width:28px;height:28px;padding:4px;border-radius:8px;background:none;cursor:pointer}
[data-storyloco=format] input[type=color]::-webkit-color-swatch-wrapper{padding:0}
[data-storyloco=format] input[type=color]::-webkit-color-swatch{border:0;border-radius:50%;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)!important}
[data-storyloco=format][data-fixed] .menu button:hover{background:rgb(0 0 0/.07)}
.ProseMirror img{max-width:100%;height:auto}
.ProseMirror table{border-collapse:collapse}
[data-storyloco=inspector] .ProseMirror table{width:100%;margin:.5em 0;table-layout:fixed}
[data-storyloco=inspector] .ProseMirror :is(td,th){border:1px solid rgb(127 127 127/.35);padding:4px 6px;vertical-align:top}
[data-storyloco=inspector] .ProseMirror th{font-weight:650;text-align:start}
.ProseMirror .selectedCell{box-shadow:inset 0 0 0 9999px color-mix(in srgb,var(--editor-accent,#05807f) 16%,transparent)}
[data-storyloco=format] button:disabled{cursor:progress;opacity:.6}
[data-storyloco=format] input{all:unset;box-sizing:border-box;width:220px;height:28px;padding:0 8px;border-radius:8px;background:rgb(255 255 255/.12);font:inherit}
[data-storyloco=format][data-fixed] input{background:rgb(0 0 0/.06)}
[data-storyloco=rich] .ProseMirror{cursor:text;font-variant-ligatures:inherit;font-feature-settings:inherit;word-wrap:inherit;overflow-wrap:inherit;white-space:pre-wrap}
[data-storyloco=rich] .ProseMirror>:first-child{margin-top:var(--editor-first,revert-layer)!important}
[data-storyloco=rich] .ProseMirror>:last-child{margin-bottom:var(--editor-last,revert-layer)!important}
[data-storyloco-embed]{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:.75em 0;padding:.75em 1em;border:1px dashed color-mix(in srgb,var(--editor-accent,#05807f) 60%,transparent);border-radius:8px;font:500 13px/1.3 system-ui,sans-serif;color:var(--editor-accent,#05807f);text-transform:capitalize;cursor:pointer;transition:background-color .15s}
[data-storyloco-embed]:hover{background:color-mix(in srgb,var(--editor-accent,#05807f) 8%,transparent)}
[data-storyloco-embed-edit]{font-weight:650;text-transform:none;opacity:.8}
[data-storyloco-embed][data-site]{all:unset;display:block;border-radius:4px;cursor:pointer}
[data-storyloco-embed][data-site]:hover{outline:1px dashed var(--editor-accent,#05807f);outline-offset:4px}
[data-storyloco-embed][data-site] *{pointer-events:none}
[data-storyloco-embed].ProseMirror-selectednode{outline:2px solid var(--editor-accent,#05807f);outline-offset:4px}
.ProseMirror{outline:none;white-space:pre-wrap}
.collaboration-carets__caret{position:relative;margin:0 -1px;border-left:2px solid;pointer-events:none;word-break:normal}
.collaboration-carets__label{position:absolute;left:-2px;bottom:100%;padding:1px 6px;border-radius:4px 4px 4px 0;color:#fff;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;user-select:none;pointer-events:none}
.ProseMirror p.is-empty:first-child::before{content:attr(data-placeholder);opacity:.4;pointer-events:none;float:left;height:0}
@keyframes storyloco-format{from{opacity:0;translate:0 4px}}`

function style() {
	if (document.getElementById("storyloco-format-style")) return
	const tag = document.createElement("style")
	tag.id = "storyloco-format-style"
	tag.textContent = STYLE
	document.head.append(tag)
}

const ICONS: Record<string, string> = {
	bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
	italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
	link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
	bullet_list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
	ordered_list:
		'<path d="M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
	blockquote: '<path d="M3 21c3 0 7-1 7-8V5H3v8h4M14 21c3 0 7-1 7-8V5h-7v8h4"/>',
	clear: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/><path d="m3 3 18 18" />',
	underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>',
	strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16"/>',
	code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
	superscript:
		'<path d="m4 19 8-8M12 19l-8-8M20 12h-4c0-1.5.44-2 1.5-2.5S20 8.33 20 7.3c0-.6-.2-1.18-.6-1.6A2.5 2.5 0 0 0 16 6.2"/>',
	subscript:
		'<path d="m4 5 8 8M12 5l-8 8M20 19h-4c0-1.5.44-2 1.5-2.5S20 15.33 20 14.3c0-.6-.2-1.18-.6-1.6a2.5 2.5 0 0 0-3.4.5"/>',
	"align-left": '<path d="M21 6H3M15 12H3M17 18H3"/>',
	"align-center": '<path d="M21 6H3M17 12H7M19 18H5"/>',
	"align-right": '<path d="M21 6H3M21 12H9M21 18H7"/>',
	"align-justify": '<path d="M3 6h18M3 12h18M3 18h18"/>',
	nocolour: '<circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/>',
	hrule: '<path d="M3 12h18"/>',
	code_block:
		'<path d="M10 9.5 8 12l2 2.5M14 9.5l2 2.5-2 2.5"/><rect x="3" y="4" width="18" height="16" rx="2"/>',
	image:
		'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
	blok: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
	anchor: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
	undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
	redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
	table:
		'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
	more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
	down: '<path d="m6 9 6 6 6-6"/>',
	rewrite:
		'<path d="M9.94 14.06 4 20M14 4l1.1 2.9L18 8l-2.9 1.1L14 12l-1.1-2.9L10 8l2.9-1.1zM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z"/>',
}

/** A richtext field's settings in its block's schema: what its bar offers */
export type RichField = {
	customize_toolbar?: boolean
	toolbar?: Array<string> | null
	style_options?: Array<{ name: string; value: string }> | null
	allow_target_blank?: boolean
}

/** What can be put into the text from elsewhere: an image from the library, a blok the field allows */
export type Inserts = {
	image?: () => Promise<{ src: string; alt: string; id: number } | null>
	bloks?: Array<{ label: string; make: () => Record<string, unknown> }>
}

/** A field's bar when its schema doesn't choose: Storyblok's own, as far as it goes here */
const DEFAULT_TOOLS = [
	"bold",
	"italic",
	"strike",
	"underline",
	"inlinecode",
	"code",
	"link",
	"anchor",
	"paragraph",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"list",
	"olist",
	"quote",
	"hrule",
	"image",
	"blok",
	"color",
	"unset",
	"undo",
	"redo",
	"superscript",
	"subscript",
]

/** The Storyblok toolbar items a field has: its own choice, none when it's customised without one, as Storyblok has it, or the default */
export const tools_of = (field?: RichField) =>
	new Set(field?.customize_toolbar ? (field.toolbar ?? []) : DEFAULT_TOOLS)

type Tool = {
	/** Storyblok's name for it, in a field's toolbar */
	key: string
	label: string
	icon?: string
	text?: string
	swatch?: string
	/** Whether it's offered just now, like a table's tools while the caret's in one */
	shown?: () => boolean
	active: () => boolean
	run: () => void
}

const LEVELS = [1, 2, 3, 4, 5, 6] as const
const ALIGNS = ["left", "center", "right", "justify"] as const

function toolbar(editor: Editor, fixed: boolean, field?: RichField, inserts: Inserts = {}) {
	style()
	const bar = document.createElement("div")
	bar.dataset.storyloco = "format"
	if (fixed) bar.dataset.fixed = ""
	bar.setAttribute("role", "toolbar")
	bar.setAttribute("aria-label", "Text format")
	// pressing the bar mustn't take the selection away from the text
	bar.addEventListener("mousedown", (event) => {
		if (!(event.target instanceof HTMLInputElement)) event.preventDefault()
	})

	const has = tools_of(field)
	const chain = () => editor.chain().focus()
	const tool = (
		key: string,
		label: string,
		look: { icon?: string; text?: string },
		active: () => boolean,
		run: () => void
	): Tool => ({ key, label, ...look, active, run })
	const mark = (key: string, name: string, label: string, toggle: () => void) =>
		tool(key, label, { icon: ICONS[name] }, () => editor.isActive(name), toggle)

	const levels = LEVELS.filter((level) => has.has(`h${level}`))
	const aligns = ALIGNS.filter((align) => has.has(`align-${align}`))
	const align = (to: (typeof ALIGNS)[number]) =>
		tool(
			`align-${to}`,
			`Align ${to}`,
			{ icon: ICONS[`align-${to}`] },
			() => editor.isActive({ textAlign: to }),
			() => {
				const value = editor.isActive({ textAlign: to }) ? null : to
				chain()
					.updateAttributes("paragraph", { textAlign: value })
					.updateAttributes("heading", { textAlign: value })
					.run()
			}
		)

	// the main ones, always in the bar
	const main = [
		mark("bold", "bold", "Bold", () => chain().toggleBold().run()),
		mark("italic", "italic", "Italic", () => chain().toggleItalic().run()),
		tool(
			"link",
			"Link",
			{ icon: ICONS.link },
			() => editor.isActive("link"),
			() => linking()
		),
		mark("list", "bullet_list", "Bulleted list", () => chain().toggleBulletList().run()),
		mark("olist", "ordered_list", "Numbered list", () => chain().toggleOrderedList().run()),
		mark("quote", "blockquote", "Quote", () => chain().toggleBlockquote().run()),
	].filter((t) => has.has(t.key))

	// the rest of what the field allows, under More, in groups
	const groups: Array<[string, Array<Tool>]> = [
		[
			"Text",
			[
				mark("underline", "underline", "Underline", () => chain().toggleUnderline().run()),
				mark("strike", "strike", "Strikethrough", () => chain().toggleStrike().run()),
				mark("inlinecode", "code", "Code", () => chain().toggleCode().run()),
				mark("superscript", "superscript", "Superscript", () => chain().toggleSuperscript().run()),
				mark("subscript", "subscript", "Subscript", () => chain().toggleSubscript().run()),
			].filter((t) => has.has(t.key)),
		],
		["Align", aligns.map(align)],
		[
			"Colour",
			has.has("color")
				? [
						tool(
							"color",
							"No colour",
							{ icon: ICONS.nocolour },
							() => false,
							() => chain().unsetMark("textStyle").run()
						),
					]
				: [],
		],
		[
			"Style",
			(field?.style_options ?? []).map((option) =>
				tool(
					"style",
					option.name,
					{ text: option.name },
					() => editor.isActive("styled", { class: option.value }),
					() =>
						editor.isActive("styled", { class: option.value })
							? chain().unsetMark("styled").run()
							: chain().setMark("styled", { class: option.value }).run()
				)
			),
		],
		[
			"Insert",
			[
				tool(
					"hrule",
					"Divider",
					{ icon: ICONS.hrule },
					() => false,
					() => chain().setHorizontalRule().run()
				),
				mark("code", "code_block", "Code block", () => chain().toggleCodeBlock().run()),
				...(inserts.image
					? [
							tool(
								"image",
								"Image",
								{ icon: ICONS.image },
								() => false,
								() => void picking()
							),
						]
					: []),
				...(inserts.bloks?.length
					? [
							tool(
								"blok",
								"Block",
								{ icon: ICONS.blok },
								() => false,
								() => toggle("bloks")
							),
						]
					: []),
				tool(
					"anchor",
					"Anchor",
					{ icon: ICONS.anchor },
					() => editor.isActive("anchor"),
					() => anchoring()
				),
			].filter((t) => has.has(t.key)),
		],
		["Table", table_tools().filter((t) => has.has(t.key))],
		[
			"",
			[
				tool(
					"undo",
					"Undo",
					{ icon: ICONS.undo },
					() => false,
					() => chain().undo().run()
				),
				tool(
					"redo",
					"Redo",
					{ icon: ICONS.redo },
					() => false,
					() => chain().redo().run()
				),
				tool(
					"unset",
					"Clear formatting",
					{ icon: ICONS.clear },
					() => false,
					() => chain().unsetAllMarks().clearNodes().run()
				),
			].filter((t) => has.has(t.key)),
		],
	]
	const extra = groups.flatMap(([, tools]) => tools)
	// a couple more is no reason for a menu: they go in the bar with the rest
	const few =
		extra.length <= 2 && extra.every((t) => !["color", "style"].includes(t.key) && !t.shown)
	const more = few ? [] : groups.filter(([, tools]) => tools.length)
	const rewrite = tool(
		"rewrite",
		"Rewrite with AI",
		{ icon: ICONS.rewrite },
		() => false,
		() => rewriting()
	)

	const swatch = (colour: string): Tool => ({
		...tool(
			"color",
			colour,
			{},
			() => editor.getAttributes("textStyle").color === colour,
			() => chain().setMark("textStyle", { color: colour }).run()
		),
		swatch: colour,
	})

	/** A table to start with, and while the caret's in one, its rows, columns, headers and cells */
	function table_tools(): Array<Tool> {
		const inside = () => editor.isActive("table")
		const op = (key: string, label: string, run: () => boolean, shown = inside) => ({
			...tool(
				key,
				label,
				{ text: label },
				() => false,
				() => void run()
			),
			shown,
		})
		return [
			{
				...tool(
					"add-table",
					"Table",
					{ icon: ICONS.table },
					() => false,
					() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
				),
				shown: () => !inside(),
			},
			op("insert-row-above", "Row above", () => chain().addRowBefore().run()),
			op("insert-row-below", "Row below", () => chain().addRowAfter().run()),
			op("insert-column-before", "Column left", () => chain().addColumnBefore().run()),
			op("insert-column-after", "Column right", () => chain().addColumnAfter().run()),
			op("toggle-header-row", "Header row", () => chain().toggleHeaderRow().run()),
			op("toggle-header-column", "Header column", () => chain().toggleHeaderColumn().run()),
			op("toggle-header-cell", "Header cell", () => chain().toggleHeaderCell().run()),
			op(
				"merge-cells",
				"Merge cells",
				() => chain().mergeCells().run(),
				() => editor.can().mergeCells()
			),
			op(
				"split-cells",
				"Split cell",
				() => chain().splitCell().run(),
				() => editor.can().splitCell()
			),
			op("delete-row", "Delete row", () => chain().deleteRow().run()),
			op("delete-column", "Delete column", () => chain().deleteColumn().run()),
			op("delete-table", "Delete table", () => chain().deleteTable().run()),
		]
	}

	/** The colours the text already has */
	function colours() {
		const used = new Set<string>()
		editor.state.doc.descendants((node) => {
			for (const m of node.marks)
				if (m.type.name === "textStyle" && m.attrs.color) used.add(String(m.attrs.color))
		})
		return [...used].slice(0, 7)
	}

	const buttons = new Map<HTMLButtonElement, Tool>()
	/** Which menu is open: the text's kind, More, or the bloks to embed */
	let open: "kind" | "more" | "bloks" | null = null

	function button(t: Tool, className = "") {
		const b = document.createElement("button")
		b.type = "button"
		b.title = b.ariaLabel = t.label
		if (className) b.className = className
		if (t.swatch) {
			const dot = document.createElement("span")
			dot.className = "swatch"
			dot.style.background = t.swatch
			b.append(dot)
		} else
			b.innerHTML = t.icon
				? `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>`
				: (t.text ?? "")
		b.addEventListener("click", () => {
			t.run()
			if (open && t.key !== "blok") close()
		})
		buttons.set(b, t)
		return b
	}

	const sep = () => Object.assign(document.createElement("span"), { className: "sep" })

	/** What kind of block the caret's in, as the bar shows it */
	const kind = () => {
		const level = levels.find((l) => editor.isActive("heading", { level: l }))
		return level ? `H${level}` : "Text"
	}
	let kind_button: HTMLButtonElement | null = null

	const marks = main.filter((t) => ["bold", "italic", "link"].includes(t.key))
	const lists = main.filter((t) => !marks.includes(t))

	function render() {
		bar.replaceChildren()
		buttons.clear()
		bar.append(...marks.map((t) => button(t)))
		if (levels.length || lists.length || (few && extra.length)) bar.append(sep())
		kind_button = null
		if (levels.length) {
			kind_button = document.createElement("button")
			kind_button.type = "button"
			kind_button.className = "word kind"
			kind_button.title = kind_button.ariaLabel = "Text or heading"
			kind_button.setAttribute("aria-haspopup", "menu")
			kind_button.addEventListener("click", () => toggle("kind"))
			bar.append(kind_button)
		}
		bar.append(...lists.map((t) => button(t)))
		if (few) bar.append(...extra.map((t) => button(t)))
		if (bar.childElementCount) bar.append(sep())
		if (more.length) {
			const b = document.createElement("button")
			b.type = "button"
			b.className = "more-button"
			b.title = b.ariaLabel = "More formatting"
			b.setAttribute("aria-haspopup", "menu")
			b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.more}</svg>`
			b.addEventListener("click", () => toggle(open === "bloks" ? "bloks" : "more"))
			bar.append(b)
		}
		bar.append(button(rewrite))
		if (open) bar.append(menu())
		update()
	}

	function menu() {
		const box = document.createElement("div")
		box.className = "menu"
		box.setAttribute("role", "menu")
		if (open === "kind") {
			const list = document.createElement("div")
			list.className = "list"
			const choices = [
				tool(
					"paragraph",
					"Text",
					{ text: "Text" },
					() => kind() === "Text",
					() => chain().setParagraph().run()
				),
				...levels.map((level) =>
					tool(
						`h${level}`,
						`Heading ${level}`,
						{ text: `Heading ${level}` },
						() => editor.isActive("heading", { level }),
						() => chain().setHeading({ level }).run()
					)
				),
			]
			for (const t of choices) {
				const b = button(t, "item")
				if (t.key !== "paragraph") b.dataset.level = t.key.slice(1)
				list.append(b)
			}
			box.append(list)
			return box
		}
		if (open === "bloks") {
			const back = document.createElement("button")
			back.type = "button"
			back.className = "item back"
			back.textContent = "‹ Insert a block"
			back.addEventListener("click", () => toggle("more"))
			const list = document.createElement("div")
			list.className = "list"
			for (const choice of inserts.bloks ?? []) {
				const b = document.createElement("button")
				b.type = "button"
				b.className = "item"
				b.textContent = choice.label
				b.addEventListener("click", () => {
					const blok = choice.make()
					chain()
						.insertContent({ type: "blok", attrs: { id: crypto.randomUUID(), body: [blok] } })
						.run()
					close()
				})
				list.append(b)
			}
			box.append(back, list)
			return box
		}
		for (const [name, tools] of more) {
			const group = document.createElement("div")
			group.className = "group"
			if (name)
				group.append(
					Object.assign(document.createElement("span"), { className: "legend", textContent: name })
				)
			const row = document.createElement("div")
			row.className = "row"
			const now = tools.filter((t) => !t.shown || t.shown())
			row.append(...now.map((t) => button(t, t.text ? "word" : "")))
			if (name === "Table" && has.has("cell-color") && editor.isActive("table")) {
				const pick = document.createElement("input")
				pick.type = "color"
				pick.title = pick.ariaLabel = "Cell colour"
				pick.addEventListener("change", () => {
					chain().setCellAttribute("backgroundColor", pick.value).run()
					close()
				})
				row.append(pick)
			}
			if (!row.childElementCount) continue
			if (name === "Colour") {
				// the colours the text has now, which change as it's edited and as others' edits arrive
				row.prepend(...colours().map((colour) => button(swatch(colour))))
				// any colour, from the system's own picker
				const pick = document.createElement("input")
				pick.type = "color"
				pick.title = pick.ariaLabel = "Pick a colour"
				pick.value = /^#[0-9a-f]{6}$/i.test(editor.getAttributes("textStyle").color ?? "")
					? editor.getAttributes("textStyle").color
					: "#000000"
				pick.addEventListener("change", () => {
					chain().setMark("textStyle", { color: pick.value }).run()
					close()
				})
				row.insertBefore(pick, row.lastChild)
			}
			group.append(row)
			box.append(group)
		}
		return box
	}

	function toggle(menu: NonNullable<typeof open>) {
		open = open === menu ? null : menu
		listen(!!open)
		render()
	}
	function close() {
		if (!open) return
		open = null
		listen(false)
		render()
	}
	const outside = (event: PointerEvent) => !bar.contains(event.target as globalThis.Node) && close()
	// focus stays in the text while a menu's open, so Escape is caught before the text's own handler
	const escape = (event: KeyboardEvent) => {
		if (event.key !== "Escape") return
		event.preventDefault()
		event.stopPropagation()
		close()
		editor.commands.focus()
	}
	function listen(on: boolean) {
		document.removeEventListener("pointerdown", outside, true)
		document.removeEventListener("keydown", escape, true)
		if (!on) return
		document.addEventListener("pointerdown", outside, true)
		document.addEventListener("keydown", escape, true)
	}

	function update() {
		for (const [b, t] of buttons) b.setAttribute("aria-pressed", String(t.active()))
		if (kind_button) {
			kind_button.innerHTML = `${kind()}<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.down}</svg>`
			kind_button.setAttribute("aria-expanded", String(open === "kind"))
		}
	}

	/** Something typed into the bar itself, like a link's address, applied on Enter */
	function ask({
		label,
		placeholder,
		value,
		type = "text",
		extra,
		apply,
	}: {
		label: string
		placeholder: string
		value: string
		type?: string
		extra?: HTMLElement
		apply: (value: string) => void
	}) {
		close()
		const input = document.createElement("input")
		input.type = type
		input.placeholder = placeholder
		input.value = value
		input.ariaLabel = label
		let finished = false
		const done = (keep: boolean) => {
			if (finished) return
			finished = true
			if (keep) apply(input.value.trim())
			else editor.commands.focus()
			render()
		}
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault()
				done(true)
			}
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				done(false)
			}
		})
		input.addEventListener("blur", () =>
			setTimeout(() => !bar.contains(document.activeElement) && done(true))
		)
		bar.replaceChildren(input, ...(extra ? [extra] : []))
		input.focus()
	}

	/** The link's address, and whether it opens in a new tab where the field allows that */
	function linking() {
		const current = editor.getAttributes("link")
		let blank = current.target === "_blank"
		let extra: HTMLElement | undefined
		if (field?.allow_target_blank) {
			const toggle_blank = document.createElement("button")
			toggle_blank.type = "button"
			toggle_blank.className = "word"
			toggle_blank.textContent = "New tab"
			toggle_blank.title = "Open the link in a new tab"
			toggle_blank.setAttribute("aria-pressed", String(blank))
			toggle_blank.addEventListener("click", () => {
				blank = !blank
				toggle_blank.setAttribute("aria-pressed", String(blank))
				bar.querySelector("input")?.focus()
			})
			extra = toggle_blank
		}
		ask({
			label: "Link address",
			placeholder: "Paste or type a link, then Enter",
			value: (current.href as string | undefined) ?? "",
			type: "url",
			extra,
			apply: (typed) => {
				// an address typed without its scheme, like example.com, is a web address
				const href =
					typed && !/^([a-z][\w+.-]*:|\/|#)/i.test(typed)
						? typed.includes("@") && !typed.includes("/")
							? `mailto:${typed}`
							: `https://${typed}`
						: typed
				const link = chain().extendMarkRange("link")
				if (!href) link.unsetLink().run()
				else
					link
						.setLink({
							href,
							linktype: href.startsWith("mailto:") ? "email" : "url",
							target: blank ? "_blank" : null,
						} as { href: string })
						.run()
			},
		})
	}

	/** An anchor on the selected text, for links to `#its-id` */
	function anchoring() {
		ask({
			label: "Anchor name",
			placeholder: "Anchor name, like contact, then Enter",
			value: (editor.getAttributes("anchor").id as string | undefined) ?? "",
			apply: (typed) => {
				const id = typed.replace(/^#/, "").trim().replace(/\s+/g, "-")
				if (!id) chain().unsetMark("anchor").run()
				else chain().setMark("anchor", { id }).run()
			},
		})
	}

	/** An image from the library, where the caret is */
	async function picking() {
		const picked = await (inserts.image?.() ?? null)
		if (!picked) return void editor.commands.focus()
		chain()
			.insertContent({
				type: "image",
				attrs: {
					src: picked.src,
					alt: picked.alt,
					id: picked.id,
					title: "",
					source: "",
					copyright: "",
					meta_data: {},
				},
			})
			.run()
	}

	const HOW = {
		shorter: "Shorter",
		friendlier: "Friendlier",
		clearer: "Clearer",
		fix: "Fix spelling",
	}

	/** The selection, or the paragraph the caret's in, rewritten by AI: the bar offers how */
	function rewriting() {
		const { from, to, $from } = editor.state.selection
		const range = from === to ? { from: $from.start(), to: $from.end() } : { from, to }
		const text = editor.state.doc.textBetween(range.from, range.to, "\n\n").trim()
		if (!text) return
		const choices = Object.entries(HOW).map(([how, label]) => {
			const button = document.createElement("button")
			button.type = "button"
			button.className = "word"
			button.textContent = label
			button.addEventListener("click", async () => {
				for (const b of bar.querySelectorAll("button")) b.disabled = true
				button.textContent = "Rewriting…"
				const reply = await call<{ text: string }>({ op: "ai", do: "rewrite", text, how }).catch(
					(e: Error) => e
				)
				if (reply instanceof Error) {
					button.textContent = reply.message
					setTimeout(render, 2500)
					return
				}
				// someone may have typed in it while the rewrite was on its way: that text isn't ours to replace
				if (editor.state.doc.textBetween(range.from, range.to, "\n\n").trim() !== text) {
					button.textContent = "The text changed meanwhile"
					setTimeout(render, 2500)
					return
				}
				const parts = reply.text.split(/\n{2,}/).filter(Boolean)
				// one paragraph's text in place; several as paragraphs of their own
				const content =
					parts.length > 1
						? parts.map((part) => ({ type: "paragraph", content: [{ type: "text", text: part }] }))
						: { type: "text", text: reply.text }
				chain().insertContentAt(range, content).run()
				render()
			})
			return button
		})
		const cancel = document.createElement("button")
		cancel.type = "button"
		cancel.title = cancel.ariaLabel = "Cancel"
		cancel.innerHTML =
			'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
		cancel.addEventListener("click", () => {
			render()
			editor.commands.focus()
		})
		bar.replaceChildren(...choices, cancel)
		choices[0].focus()
	}

	/** Just above the text being edited, kept on screen, so it never covers what's being typed */
	function place() {
		if (fixed) return
		const box = editor.view.dom.getBoundingClientRect()
		const width = bar.offsetWidth
		const height = bar.offsetHeight
		bar.style.left = `${Math.min(Math.max(box.left, 8), innerWidth - width - 8)}px`
		bar.style.top = `${box.top - height - 10 >= 8 ? box.top - height - 10 : Math.min(Math.max(8, box.top + 8), box.bottom - height - 8)}px`
	}

	render()
	// a field Storyblok gives no tools to is plain text, as a textarea is: no bar at all
	const empty = !main.length && !levels.length && !extra.length
	return { bar, update, place, close, empty }
}

// --- editors

export type RichDoc = JSONContent

/** Where a richtext field typed in together keeps its text in the room's document */
const FIELD = "rich"

/** A shared richtext field's value, from the room's document, with or without an editor open on it */
export const shared_doc = (room: Room) =>
	yXmlFragmentToProsemirrorJSON(room.doc.getXmlFragment(FIELD)) as RichDoc

/**
 * A richtext editor in `element`, its format bar floating over the text or `fixed` above it.
 * `change` hears every edit; the caller decides when to save.
 */
export function rich_editor({
	element,
	doc,
	fixed = false,
	change,
	placeholder = "Write something…",
	together,
	shows,
	field,
	inserts,
}: {
	element: HTMLElement
	doc: RichDoc
	fixed?: boolean
	change?: (doc: RichDoc) => void
	placeholder?: string
	shows?: Shows
	/** The field's settings, which say what the bar offers */
	field?: RichField
	inserts?: Inserts
	/** Typed in together: the text lives in the room, and `seed` puts `doc` there for the others first */
	together?: { room: Room; seed: boolean }
}) {
	const editor = new Editor({
		element,
		extensions: together
			? [
					...extensions(shows),
					Collaboration.configure({ document: together.room.doc, field: FIELD }),
					CollaborationCaret.configure({
						provider: { awareness: together.room.awareness },
						user: together.room.awareness.getLocalState()?.user ?? {},
					}),
				]
			: extensions(shows),
		content: together ? undefined : doc,
		editorProps: { attributes: { "aria-label": "Rich text", "data-placeholder": placeholder } },
	})
	if (together?.seed) quietly(together.room, () => editor.commands.setContent(doc))
	// an image picked or a link typed elsewhere is still this editor's business while it's open
	let elsewhere = 0
	const tools = toolbar(
		editor,
		fixed,
		field,
		inserts && {
			...inserts,
			image:
				inserts.image &&
				(async () => {
					elsewhere++
					try {
						return await inserts.image!()
					} finally {
						elsewhere--
					}
				}),
		}
	)
	if (fixed && !tools.empty) element.prepend(tools.bar)
	else if (!tools.empty) document.body.append(tools.bar)
	tools.bar.hidden = !fixed || tools.empty

	const refresh = () => {
		tools.update()
		if (!fixed && !tools.empty) {
			tools.bar.hidden = !editor.isFocused && !tools.bar.contains(document.activeElement)
			if (!tools.bar.hidden) tools.place()
		}
	}
	editor.on("selectionUpdate", refresh)
	editor.on("focus", refresh)
	editor.on("blur", () => setTimeout(refresh))
	editor.on("update", () => {
		refresh()
		change?.(editor.getJSON())
	})
	addEventListener("scroll", refresh, { passive: true })

	// an embedded blok's own fields, in the settings, for whoever's listening
	const embed = (event: MouseEvent) => {
		const uid = (event.target as Element | null)?.closest<HTMLElement>("[data-storyloco-embed]")
			?.dataset.storylocoEmbed
		if (!uid) return
		event.preventDefault()
		element.dispatchEvent(new CustomEvent("storyloco:embed", { bubbles: true, detail: { uid } }))
	}
	element.addEventListener("click", embed)

	return {
		editor,
		/** Whether focus is in the text or its bar */
		holds: (node: unknown) =>
			elsewhere > 0 ||
			element.contains(node as globalThis.Node) ||
			tools.bar.contains(node as globalThis.Node),
		destroy() {
			removeEventListener("scroll", refresh)
			element.removeEventListener("click", embed)
			tools.close()
			tools.bar.remove()
			editor.destroy()
		},
	}
}

/**
 * Edit the richtext an element on the page shows, in its place: the element steps aside for an
 * editor with the same classes, so the site's styles still apply, and comes back when focus
 * leaves, or Escape. `save` gets the document only if it changed.
 */
export function edit_in_place(
	element: HTMLElement,
	doc: RichDoc,
	{
		save,
		end,
		at,
		together,
		field,
		inserts,
	}: {
		save: (doc: RichDoc) => void
		end?: () => void
		at?: { x: number; y: number }
		field?: RichField
		inserts?: Inserts
		/** Typed in together, when the room saves it rather than `save` */
		together?: { room: Room; seed: boolean }
	}
) {
	// the wrappers the text sits in, copied without their content, so the site's styles hold at every level
	const TEXT = /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE|SPAN|A|STRONG|EM)$/
	const BLOCKS = "p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote"
	const shell = (from: Element) => {
		const copy = TEXT.test(from.tagName)
			? document.createElement("div")
			: (from.cloneNode(false) as HTMLElement)
		copy.className = from.className
		for (const name of ["id", "data-rich", "data-blok-c", "data-blok-uid"])
			copy.removeAttribute(name)
		return copy
	}
	const host = shell(element)
	host.dataset.storyloco = "rich"
	let mount = host
	/** What holds the text's own blocks, the paragraphs and headings */
	let source: Element = element
	for (let from: Element = element; from.children.length === 1;) {
		const only = from.firstElementChild!
		// a heading or paragraph that holds the text's own blocks is a wrapper, like `<h1 class="title">`
		// round the paragraphs, so it's copied for the styles it scopes; one that doesn't is the text
		const wrapper = !TEXT.test(only.tagName) || !!only.querySelector(BLOCKS)
		if (!wrapper || (only.textContent ?? "").trim() !== (from.textContent ?? "").trim()) break
		const inner = shell(only)
		mount.append(inner)
		mount = inner
		from = only
		source = only
	}
	// the text's first and last blocks sit in the editor's own element, out of reach of a site's
	// `:first-child` and `:last-child` margins, so they keep the margins they had
	const edge = (block: Element | null, side: "Top" | "Bottom") =>
		block ? getComputedStyle(block)[`margin${side}`] : ""
	const first = edge(source.firstElementChild, "Top")
	const last = edge(source.lastElementChild, "Bottom")
	const shows = {
		colour: !!source.querySelector("[style*='color']"),
		classes: classes_in(source),
		embeds: embeds_in(source, doc),
		looks: looks_in(source, doc),
	}
	const before = JSON.stringify(doc)
	// the page's images, measured while they show, so the editor's copies take the same room before
	// they've loaded, and the text, and where the click lands in it, don't move
	const asset = (src: string) => src.split("?")[0].split("/m/")[0]
	const sizes = new Map(
		[...source.querySelectorAll("img")].map((img) => [
			asset(img.currentSrc || img.src),
			img.getBoundingClientRect(),
		])
	)
	const display = element.style.display
	element.after(host)
	element.style.display = "none"

	const rich = rich_editor({ element: mount, doc, together, shows, field, inserts })
	const area = rich.editor.view.dom as HTMLElement
	// as a style beside the editor, never attributes on what's in it: the editor reads a change to its own
	// elements as an edit, and would rebuild the text from them
	const sized = document.createElement("style")
	sized.textContent = [
		...new Set([...area.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "")),
	]
		.map((src) => {
			const box = sizes.get(asset(src))
			if (!src || !box?.width) return ""
			const width = Math.round(box.width)
			const height = Math.round(box.height)
			return `[data-storyloco=rich] img[src="${src.replace(/["\\]/g, "\\$&")}"]{inline-size:${width}px;aspect-ratio:${width}/${height};block-size:auto}`
		})
		.join("\n")
	host.prepend(sized)
	area.style.setProperty("--editor-first", first)
	area.style.setProperty("--editor-last", last)

	function finish() {
		document.removeEventListener("focusin", away)
		document.removeEventListener("pointerdown", away_press, true)
		host.removeEventListener("keydown", key)
		const after = JSON.stringify(rich.editor.getJSON())
		const next = rich.editor.getJSON()
		rich.destroy()
		host.remove()
		element.style.display = display
		end?.()
		if (after !== before && !together) save(next)
	}

	const away = (event: FocusEvent) => !rich.holds(event.target) && finish()
	const away_press = (event: PointerEvent) => !rich.holds(event.target) && finish()
	// Escape finishes and keeps what was typed, like leaving the text; ⌘Z undoes while still in it
	function key(event: KeyboardEvent) {
		if (event.key !== "Escape") return
		event.preventDefault()
		event.stopPropagation()
		finish()
	}

	document.addEventListener("focusin", away)
	document.addEventListener("pointerdown", away_press, true)
	host.addEventListener("keydown", key)

	// put the caret where the click landed, as if the text had been editable all along
	const position = at && rich.editor.view.posAtCoords({ left: at.x, top: at.y })
	// where it can't tell, the end, without taking the page there
	rich.editor.commands.focus(position ? position.pos : "end", { scrollIntoView: !!position })
	return finish
}
