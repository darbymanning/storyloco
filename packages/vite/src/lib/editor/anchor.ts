/**
 * Where a comment's pin sits inside its block, finer than a fraction of the block: the element it's on, by
 * its place under the block, and the character when it's on text. A block reflows at another width, its
 * text rewrapping, and the pin follows the word it was put on.
 */
export type Anchor = {
	/** Child indexes from the block down to the element */
	path: Array<number>
	tag: string
	/** Where on the element, or on the character, as a fraction of its box */
	fx: number
	fy: number
	/** The character, as an offset into the element's text, and the text from there to find it again by */
	at?: number
	near?: string
}

const NEAR = 16

const within = (box: DOMRect, x: number, y: number) =>
	x >= box.left && x <= box.right && y >= box.top && y <= box.bottom

/** The character under a point among an element's text, as its text node and offset */
function character_at(el: Element, x: number, y: number) {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
	const range = document.createRange()
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		range.selectNodeContents(node)
		if (![...range.getClientRects()].some((box) => within(box, x, y))) continue
		for (let i = 0; i < node.length; i++) {
			range.setStart(node, i)
			range.setEnd(node, i + 1)
			const box = [...range.getClientRects()].find((b) => within(b, x, y))
			if (box) return { node, i, box }
		}
	}
	return null
}

/** The anchor for a point on an element inside a block; null when it isn't inside */
export function anchor_at(block: Element, under: Element, x: number, y: number): Anchor | null {
	if (!block.contains(under)) return null
	const hit = character_at(under, x, y)
	const el = hit?.node.parentElement ?? under
	const path: Array<number> = []
	for (let at: Element = el; at !== block; at = at.parentElement!)
		path.unshift([...at.parentElement!.children].indexOf(at))
	let on: { at: number; near: string } | null = null
	if (hit) {
		const before = document.createRange()
		before.setStart(el, 0)
		before.setEnd(hit.node, hit.i)
		const at = before.toString().length
		const near = (el.textContent ?? "").slice(at, at + NEAR)
		// all space is nothing to find it by
		if (near.trim()) on = { at, near }
	}
	const box = on ? hit!.box : el.getBoundingClientRect()
	return {
		path,
		tag: el.localName,
		fx: box.width ? (x - box.left) / box.width : 0,
		fy: box.height ? (y - box.top) / box.height : 0,
		...on,
	}
}

/** Where an anchor is on screen now; null when the block's changed so it isn't there any more */
export function anchored(block: Element, anchor: Anchor) {
	let el: Element | undefined = block
	for (const i of anchor.path) el = el?.children[i]
	if (!el || el.localName !== anchor.tag) return null
	if (anchor.at === undefined || !anchor.near) {
		const box = el.getBoundingClientRect()
		if (!box.width && !box.height) return null
		return { x: box.left + anchor.fx * box.width, y: box.top + anchor.fy * box.height }
	}
	// the same words, where they were or as near there as they've moved to with an edit
	const text = el.textContent ?? ""
	const after = text.indexOf(anchor.near, anchor.at)
	const before = text.lastIndexOf(anchor.near, anchor.at)
	const at =
		after < 0
			? before
			: before < 0
				? after
				: after - anchor.at < anchor.at - before
					? after
					: before
	if (at < 0) return null
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
	let left = at
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		if (left >= node.length) {
			left -= node.length
			continue
		}
		const range = document.createRange()
		range.setStart(node, left)
		range.setEnd(node, left + 1)
		const box = range.getClientRects()[0]
		if (!box) return null
		return { x: box.left + anchor.fx * box.width, y: box.top + anchor.fy * box.height }
	}
	return null
}
