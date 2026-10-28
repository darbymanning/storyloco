import { editor, follow, kit, on_follow } from "./client.js"
import {
	cursor,
	on_cursor,
	on_people,
	on_view,
	others,
	view,
	type Cursor,
	type Person,
	type View,
} from "./live.js"

/*
 * Everyone else on the page: a pointer each, in their colour and with their name, where they are
 * on the content rather than the screen, since screens differ; an outline on the block they've
 * selected; and a mark on the field they're typing in. Drawn in one layer above the page.
 *
 * Pressing / says something by the pointer, which the others see as it's typed. Following someone
 * (their avatar in the edit bar) takes this page wherever they go and scrolls along with them.
 */

const STYLE = `[data-storyloco=presence]{position:fixed;inset:0;pointer-events:none;z-index:2147482990;overflow:hidden}
[data-storyloco=presence] .cursor{position:absolute;left:0;top:0;transition:translate .12s linear,opacity .3s;will-change:translate}
[data-storyloco=presence] .cursor svg{display:block;width:18px;height:18px;filter:drop-shadow(0 1px 2px rgb(0 0 0/.25))}
[data-storyloco=presence] .name{position:absolute;left:14px;top:16px;padding:2px 7px;border-radius:999px;background:var(--c);color:#fff;font:600 11px/1.4 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgb(0 0 0/.2)}
[data-storyloco=presence] .box{position:absolute;left:0;top:0;border:2px solid var(--c);border-radius:3px;transition:opacity .2s}
[data-storyloco=presence] .box .name{left:-2px;top:auto;bottom:100%;border-radius:4px 4px 4px 0;margin-bottom:-1px}
[data-storyloco=presence] .box.field{border-width:1.5px;border-radius:4px;background:color-mix(in srgb,var(--c) 6%,transparent)}
[data-storyloco=presence] .caret{position:absolute;left:0;top:0;width:2px;background:var(--c)}
[data-storyloco=presence] .caret .name{left:-1px;top:auto;bottom:100%;border-radius:4px 4px 4px 0;font-size:10px;padding:1px 5px}
[data-storyloco=presence] .say,[data-storyloco=chat]{position:absolute;left:14px;top:38px;width:max-content;max-width:260px;padding:6px 11px;border-radius:4px 14px 14px 14px;background:var(--c);color:#fff;font:500 13px/1.35 system-ui,sans-serif;box-shadow:0 2px 8px rgb(0 0 0/.2);overflow-wrap:anywhere}
[data-storyloco=presence] .say:empty{display:none}
[data-storyloco=chat]{position:fixed;z-index:2147483004;left:0;top:0;padding:0;min-width:180px}
[data-storyloco=chat] input{all:unset;box-sizing:border-box;width:100%;padding:6px 11px;color:#fff;font:inherit}
[data-storyloco=chat] input::placeholder{color:rgb(255 255 255/.7)}
[data-storyloco=presence] .following{position:absolute;inset:0;border:3px solid var(--c);border-radius:2px}
[data-storyloco=presence] .following .name{left:50%;top:0;translate:-50% 0;border-radius:0 0 8px 8px;padding:3px 10px;pointer-events:auto;cursor:pointer;font-size:12px}`

const ARROW = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--c)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" d="M4 3l15 7.5-6.6 1.9L9.4 19z"/></svg>`

type Tools = {
	element_of(uid: string): HTMLElement | null | undefined
	block_of(el: Element | null): HTMLElement | null
	uid_of(node: Element): string | undefined
	/** The element showing one of a blok's fields as text, if the page has one */
	field_of(uid: string, field: string): HTMLElement | null | undefined
}

let layer: HTMLElement | undefined
let tools: Tools
/**
 * `drawn` is the position last drawn and `moved` when it last changed, so only their own moves
 * glide, for as long as the glide takes, and a scroll here carries them with the page
 */
const pointers = new Map<
	string,
	{ el: HTMLElement; at: Cursor; seen: number; drawn?: Cursor; moved?: number }
>()
const boxes = new Map<string, HTMLElement>()
/** Carets drawn by the editors in fields typed in together, by a key of their choosing */
const carets = new Map<string, { el: HTMLElement; rect: () => DOMRect | null }>()

const first_name = (p: Person) => p.user.name?.split(" ")[0] ?? "Someone"

function element(kind: string, color: string, name?: string) {
	const el = document.createElement("div")
	el.className = kind
	el.style.setProperty("--c", color)
	if (kind === "cursor") el.innerHTML = ARROW
	if (name) {
		const label = document.createElement("span")
		label.className = "name"
		label.textContent = name
		el.append(label)
	}
	layer!.append(el)
	return el
}

// --- pointers held to what's under them, so screens of another size still agree

/** An element's place under a block, as child indices */
function path_of(block: Element, el: Element) {
	const path: Array<number> = []
	for (let at = el; at !== block && at.parentElement; at = at.parentElement)
		path.unshift([...at.parentElement.children].indexOf(at))
	return path
}

function walk(block: Element, path: Array<number>) {
	let at: Element | undefined = block
	for (const i of path) at = at?.children[i]
	return at ?? null
}

/** The text in an element, a node at a time */
function texts(el: Element) {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
	const out: Array<Text> = []
	while (walker.nextNode()) out.push(walker.currentNode as Text)
	return out
}

/** One character's box, by its place through the element's text */
function char_box(el: Element, index: number) {
	let left = index
	for (const node of texts(el)) {
		if (left < node.length) {
			const range = document.createRange()
			range.setStart(node, left)
			range.setEnd(node, left + 1)
			return range.getClientRects()[0] ?? null
		}
		left -= node.length
	}
	return null
}

/** The character under a point, when there's text right there rather than merely nearest */
function char_at(x: number, y: number) {
	type Caret = { offsetNode: Node; offset: number }
	const doc = document as Document & { caretPositionFromPoint?(x: number, y: number): Caret | null }
	const caret = doc.caretPositionFromPoint?.(x, y)
	const range = caret ? null : document.caretRangeFromPoint?.(x, y)
	const node = caret?.offsetNode ?? range?.startContainer
	const offset = caret?.offset ?? range?.startOffset ?? 0
	if (!(node instanceof Text) || !node.parentElement) return null
	const el = node.parentElement
	let index = Math.min(offset, Math.max(node.length - 1, 0))
	for (const before of texts(el)) {
		if (before === node) break
		index += before.length
	}
	const box = char_box(el, index)
	if (!box || y < box.top || y > box.bottom || Math.abs(x - box.left) > box.width + 24) return null
	return { el, index, dx: x - box.left, dy: y - box.top }
}

/** Where a pointer is on this screen, from where it is on the content */
function point(at: Cursor) {
	if (at.uid) {
		const node = tools.element_of(at.uid)
		const el = node && at.path ? walk(node, at.path) : null
		if (el && at.char !== undefined) {
			const box = char_box(el, at.char)
			if (box) return { x: box.left + (at.dx ?? 0), y: box.top + (at.dy ?? 0) }
		}
		if (el && at.ex !== undefined && at.ey !== undefined) {
			const box = el.getBoundingClientRect()
			return { x: box.left + at.ex * box.width, y: box.top + at.ey * box.height }
		}
		if (node) {
			const box = node.getBoundingClientRect()
			return { x: box.left + (at.rx ?? 0) * box.width, y: box.top + (at.ry ?? 0) * box.height }
		}
	}
	if (at.x === undefined || at.y === undefined) return null
	return { x: at.x * document.documentElement.scrollWidth - scrollX, y: at.y - scrollY }
}

function place(el: HTMLElement, box: DOMRect | null, pad = 0) {
	el.style.opacity = box ? "1" : "0"
	if (!box) return
	el.style.translate = `${box.left - pad}px ${box.top - pad}px`
	el.style.width = `${box.width + pad * 2}px`
	el.style.height = `${box.height + pad * 2}px`
}

/** Everything again, each frame while anyone else is here: the page scrolls and reflows under them */
function draw() {
	const people = others()
	const ids = new Set(people.map((p) => p.id))
	for (const [id, pointer] of pointers) {
		if (!ids.has(id)) {
			pointer.el.remove()
			pointers.delete(id)
			continue
		}
		// someone saying something stays a while longer before their pointer fades
		const quiet = pointer.at.chat ? 120_000 : 60_000
		const at = !pointer.at.gone && Date.now() - pointer.seen < quiet && point(pointer.at)
		pointer.el.style.opacity = at ? "1" : "0"
		if (!at) continue
		if (pointer.drawn !== pointer.at) pointer.moved = Date.now()
		pointer.drawn = pointer.at
		// the .12s glide in STYLE, then none
		const gliding = Date.now() - (pointer.moved ?? 0) < 150
		pointer.el.style.transitionProperty = gliding ? "" : "opacity"
		pointer.el.style.translate = `${at.x}px ${at.y}px`
	}
	const wanted = new Set<string>()
	for (const person of people) {
		const uid = person.select?.uid
		const node = uid ? tools.element_of(uid) : null
		if (!node) continue
		const field = person.select?.field
		const inner = field ? tools.field_of(uid!, field) : null
		const key = `${person.id}:${field ?? ""}`
		wanted.add(key)
		let box = boxes.get(key)
		if (!box) {
			box = element(inner ? "box field" : "box", person.color, first_name(person))
			boxes.set(key, box)
		}
		place(box, (inner ?? node).getBoundingClientRect(), inner ? 3 : 0)
	}
	for (const [key, box] of boxes)
		if (!wanted.has(key)) {
			box.remove()
			boxes.delete(key)
		}
	for (const { el, rect } of carets.values()) {
		const box = rect()
		el.style.opacity = box ? "1" : "0"
		if (box) {
			el.style.translate = `${box.left}px ${box.top}px`
			el.style.height = `${box.height}px`
		}
	}
	frame_following()
	if (people.length || carets.size) frame = requestAnimationFrame(draw)
	else frame = 0
}

let frame = 0
/** Start drawing, if it isn't already */
export function redraw() {
	if (layer && !frame) frame = requestAnimationFrame(draw)
}

/** Someone's caret in a field typed in together, wherever `rect` says it is; returns the way to remove it */
export function caret(key: string, color: string, name: string, rect: () => DOMRect | null) {
	carets.get(key)?.el.remove()
	const el = element("caret", color, name)
	carets.set(key, { el, rect })
	redraw()
	return () => {
		if (carets.get(key)?.el !== el) return
		el.remove()
		carets.delete(key)
	}
}

// --- this pointer, for the others

let last = 0
let queued: PointerEvent | null = null
/** Where this pointer was last said to be, so what's said by it goes to the same place */
let here: Omit<Cursor, "id"> = {}
let pointer_at = { x: innerWidth / 2, y: innerHeight / 2 }

function moved(event: PointerEvent) {
	if (event.pointerType !== "mouse") return
	pointer_at = { x: event.clientX, y: event.clientY }
	place_chat()
	queued = event
	if (Date.now() - last < 50) return
	send()
}

function send() {
	const event = queued
	if (!event) return
	queued = null
	last = Date.now()
	const block = tools.block_of(event.target as Element)
	const uid = block && tools.uid_of(block)
	if (block && uid) {
		const { clientX: x, clientY: y } = event
		const box = block.getBoundingClientRect()
		here = { uid, rx: (x - box.left) / box.width, ry: (y - box.top) / box.height }
		// what's right under it, which a narrower or wider screen still shows, if somewhere else
		const text = char_at(x, y)
		const el = text?.el ?? (event.target as Element)
		if (el !== block && block.contains(el)) {
			here.path = path_of(block, el)
			if (text) Object.assign(here, { char: text.index, dx: text.dx, dy: text.dy })
			else {
				const inner = el.getBoundingClientRect()
				if (inner.width && inner.height)
					Object.assign(here, {
						ex: (x - inner.left) / inner.width,
						ey: (y - inner.top) / inner.height,
					})
			}
		}
	} else here = { x: event.pageX / document.documentElement.scrollWidth, y: event.pageY }
	cursor({ ...here, chat: saying })
	// the last move of a burst still goes, a moment later
	setTimeout(() => queued && send(), 60)
}

// --- saying something by the pointer

let saying: string | null = null
let chat: HTMLElement | null = null
let quiet: ReturnType<typeof setTimeout> | undefined

function say(text: string | null) {
	saying = text || null
	cursor({ ...here, chat: saying })
}

function place_chat() {
	if (chat) chat.style.translate = `${pointer_at.x + 14}px ${pointer_at.y + 38}px`
}

function open_chat() {
	clearTimeout(quiet)
	chat?.remove()
	chat = document.createElement("div")
	chat.dataset.storyloco = "chat"
	chat.style.setProperty("--c", editor.here.color ?? "#05807f")
	const input = document.createElement("input")
	input.placeholder = "Say something"
	input.maxLength = 200
	input.setAttribute("aria-label", "Say something by your pointer")
	chat.append(input)
	document.body.append(chat)
	place_chat()
	input.focus()
	input.addEventListener("input", () => say(input.value))
	input.addEventListener("keydown", (event) => {
		event.stopPropagation()
		if (event.key === "Enter") {
			// what was said stays a few seconds after the box closes, for the others to read
			close_chat()
			quiet = setTimeout(() => say(null), 5000)
		}
		if (event.key === "Escape") {
			close_chat()
			say(null)
		}
	})
	input.addEventListener("blur", () => {
		if (!chat) return
		close_chat()
		quiet = setTimeout(() => say(null), 5000)
	})
}

function close_chat() {
	const was = chat
	chat = null
	was?.remove()
}

function key(event: KeyboardEvent) {
	const el = event.target as HTMLElement | null
	if (el?.closest("input, textarea, select, [contenteditable]")) return
	if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && editor.editing) {
		event.preventDefault()
		open_chat()
		return
	}
	// moving around the page yourself stops following someone else
	if (editor.following && /^(Arrow|Page|Home|End|Escape| )/.test(event.key)) follow(null)
}

// --- following someone

let sent_view = 0
let view_timer: ReturnType<typeof setTimeout> | undefined

/** Where this page is scrolled to, as the content a third of the way down the screen */
function scrolled() {
	clearTimeout(view_timer)
	const wait = 120 - (Date.now() - sent_view)
	if (wait > 0) return void (view_timer = setTimeout(scrolled, wait))
	sent_view = Date.now()
	const at = 0.3
	const block = tools.block_of(document.elementFromPoint(innerWidth / 2, innerHeight * at))
	const uid = block && tools.uid_of(block)
	if (block && uid) {
		const box = block.getBoundingClientRect()
		view({ uid, ry: (innerHeight * at - box.top) / box.height, at })
	} else
		view({
			y: scrollY / Math.max(document.documentElement.scrollHeight - innerHeight, 1),
			at,
		})
}

/** Where each of the others last scrolled to, so following someone starts where they are */
const views = new Map<string, View>()

function went(to: View) {
	views.set(to.id, to)
	if (to.id !== editor.following) return
	const node = to.uid ? tools.element_of(to.uid) : null
	const top = node
		? scrollY +
			node.getBoundingClientRect().top +
			(to.ry ?? 0) * node.offsetHeight -
			innerHeight * to.at
		: (to.y ?? 0) * (document.documentElement.scrollHeight - innerHeight)
	glide(top)
}

/*
 * Where they are arrives a few times a second, so jumping straight there stutters: the page
 * eases toward the latest each frame instead, the same share of the way whatever the frame rate
 */
let gliding_to = 0
let glide_frame = 0
let glide_last = 0
function glide(top: number) {
	gliding_to = top
	if (glide_frame) return
	glide_last = performance.now()
	const step = (now: number) => {
		const dt = Math.min(now - glide_last, 64)
		glide_last = now
		const left = gliding_to - scrollY
		if (Math.abs(left) < 0.5 || !editor.following) {
			glide_frame = 0
			return
		}
		scrollTo({ top: scrollY + left * (1 - Math.pow(0.002, dt / 1000)), behavior: "instant" })
		glide_frame = requestAnimationFrame(step)
	}
	glide_frame = requestAnimationFrame(step)
}

let going: string | null = null

/** The followed person moved to another page: go there too */
async function along() {
	const them = others_anywhere().find((p) => p.id === editor.following)
	if (!them?.page || them.page === location.pathname || them.page === going) return
	going = them.page
	await kit()
		.goto(them.page)
		.catch(() => {})
	going = null
}

const others_anywhere = () => editor.here.people

let frame_el: HTMLElement | null = null

/** A frame round the page in the followed person's colour, its label the way to stop */
function frame_following() {
	const them = others_anywhere().find((p) => p.id === editor.following)
	if (!them) {
		frame_el?.remove()
		frame_el = null
		return
	}
	if (!frame_el || frame_el.dataset.id !== them.id) {
		frame_el?.remove()
		frame_el = element("following", them.color, `Following ${first_name(them)} · Stop`)
		frame_el.dataset.id = them.id
		frame_el.querySelector(".name")!.addEventListener("click", () => follow(null))
	}
}

const stop_following = (event: Event) => {
	if (editor.following && !(event.target as Element)?.closest?.("[data-storyloco]")) follow(null)
}

function left(event: MouseEvent) {
	if (!event.relatedTarget) cursor({ gone: true })
}

/** Show the others, and send this pointer to them, until the returned function */
export function show(given: Tools) {
	tools = given
	const style = document.createElement("style")
	style.textContent = STYLE
	document.head.append(style)
	layer = document.createElement("div")
	layer.dataset.storyloco = "presence"
	layer.setAttribute("aria-hidden", "true")
	document.body.append(layer)

	const stop = on_cursor((at) => {
		if (at.id === "*") {
			for (const pointer of pointers.values()) pointer.at = { ...pointer.at, gone: true }
			return
		}
		let pointer = pointers.get(at.id)
		if (!pointer) {
			const person = others().find((p) => p.id === at.id)
			if (!person) return
			const el = element("cursor", person.color, first_name(person))
			const said = document.createElement("span")
			said.className = "say"
			el.append(said)
			pointer = { el, at, seen: Date.now() }
			pointers.set(at.id, pointer)
		}
		pointer.at = at
		pointer.seen = Date.now()
		const said = pointer.el.querySelector(".say")!
		if (said.textContent !== (at.chat ?? "")) said.textContent = at.chat ?? ""
		redraw()
	})
	const stop_views = on_view(went)
	const stop_follow = on_follow(() => {
		frame_following()
		along()
		const where = editor.following && views.get(editor.following)
		if (where) went(where)
		redraw()
	})
	const stop_people = on_people(() => {
		redraw()
		along()
	})
	document.addEventListener("pointermove", moved, { passive: true })
	document.addEventListener("mouseout", left)
	document.addEventListener("keydown", key)
	addEventListener("scroll", scrolled, { passive: true })
	addEventListener("wheel", stop_following, { passive: true })
	addEventListener("touchstart", stop_following, { passive: true })
	redraw()
	scrolled()

	return () => {
		stop()
		stop_views()
		stop_follow()
		stop_people()
		follow(null)
		close_chat()
		document.removeEventListener("pointermove", moved)
		document.removeEventListener("mouseout", left)
		document.removeEventListener("keydown", key)
		removeEventListener("scroll", scrolled)
		removeEventListener("wheel", stop_following)
		removeEventListener("touchstart", stop_following)
		frame_el?.remove()
		frame_el = null
		cancelAnimationFrame(frame)
		frame = 0
		layer?.remove()
		style.remove()
		layer = undefined
		pointers.clear()
		boxes.clear()
		carets.clear()
	}
}
