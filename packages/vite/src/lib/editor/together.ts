import * as Y from "yjs"
import { apply_edit, enter, leave, quietly, rebase, type_into, type Room } from "./live.js"
import { caret } from "./presence.js"

/** Somewhere a field's text shows: text on the page, or an input in the settings */
export type Surface = {
	/** Whether this person is typing in it, rather than watching */
	typing(): boolean
	/** Show the text, the caret staying at `at` when typing */
	show(value: string, at: number | null): void
	/** Where the caret is, while typing */
	at(): number | null
	/** Where on screen a caret at `index` sits, for drawing the others'; null to draw none */
	spot(index: number): DOMRect | null
}

/**
 * A plain text field typed in together: what's typed here goes to everyone else in the field,
 * what they type shows here with this caret kept in place, and their carets show in their colours.
 * `save` runs only when this browser is the one saving the field; `stop` leaves it.
 */
export function share_text(
	key: string,
	surface: Surface,
	{
		initial,
		tidy = (value: string) => value,
		save,
		fresh,
	}: {
		initial: string
		tidy?: (value: string) => string
		save: (value: string, shared: boolean) => Promise<boolean>
		/** The value as saved now, when the page's copy may be out of date */
		fresh?: () => Promise<string | null | undefined>
	}
) {
	const room: Room = enter(key)
	const text = room.doc.getText("text")
	room.value = () => tidy(text.toString())
	room.save = (value, shared) => save(value as string, shared)

	// where this caret is, as a place in the text rather than a number, so others' typing moves it along
	let mine: Y.RelativePosition | null = null
	const index = (position: Y.RelativePosition | null) =>
		position
			? (Y.createAbsolutePositionFromRelativePosition(position, room.doc)?.index ?? null)
			: null

	const show = () => surface.show(text.toString(), surface.typing() ? index(mine) : null)
	// this surface's own typing is already showing; anyone else's, on this page or another, isn't
	const own = {}
	const heard = (event: Y.YTextEvent) => {
		if (event.transaction.origin !== own) show()
	}

	// what's saved is the text as it was shown; anything since, here or by the others, is unsaved
	room.saved ??= tidy(initial)
	let synced = false
	/** What was typed before the text so far arrived, made as an edit to it once it has */
	let early: string | null = null
	const ready = room.ready.then(async (first) => {
		if (first && !text.length) {
			// the first one in starts it from what's saved, not what the page last showed
			const saved = fresh ? await fresh().catch(() => null) : null
			const start = typeof saved === "string" ? saved : initial
			if (typeof saved === "string") room.saved = tidy(saved)
			// someone may have joined meanwhile and filled it already
			if (!text.length) quietly(room, () => text.insert(0, start))
		}
		if (early !== null) apply_edit(text, rebase(initial, early, text.toString()), own)
		if (text.toString() !== (early ?? initial)) show()
		text.observe(heard)
		synced = true
	})

	// the others' carets
	const drawn = new Map<number, { json: string; remove: () => void }>()
	function others() {
		const seen = new Set<number>()
		for (const [client, state] of room.awareness.getStates()) {
			if (client === room.doc.clientID || !state.caret || !state.user) continue
			seen.add(client)
			const json = JSON.stringify(state.caret)
			if (drawn.get(client)?.json === json) continue
			const position = Y.createRelativePositionFromJSON(state.caret)
			const remove = caret(`${key}:${client}`, state.user.color, state.user.name, () => {
				const at = index(position)
				return at === null ? null : surface.spot(at)
			})
			drawn.set(client, { json, remove })
		}
		for (const [client, { remove }] of drawn)
			if (!seen.has(client)) {
				remove()
				drawn.delete(client)
			}
	}
	room.awareness.on("change", others)
	others()

	return {
		room,
		ready,
		/** What's in the surface now, after typing */
		typed(value: string) {
			// before the text so far arrives there's nothing to type into yet: it waits, as an edit to what was shown
			if (!synced) return void (early = value)
			type_into(text, value, own)
			this.moved()
		},
		/** The caret moved, or typing moved it */
		moved() {
			const at = surface.at()
			mine = at === null ? null : Y.createRelativePositionFromTypeIndex(text, at)
			room.awareness.setLocalStateField("caret", mine && Y.relativePositionToJSON(mine))
		},
		/** The text as it is now, everyone's typing included */
		value: () => text.toString(),
		async stop() {
			// typed in before the text so far arrived: that lands once it has, then this can save it,
			// though not forever: a room that never answers is let go, unsaved being all it can be
			await Promise.race([ready, new Promise((done) => setTimeout(done, 10_000))])
			text.unobserve(heard)
			room.awareness.off("change", others)
			for (const { remove } of drawn.values()) remove()
			room.awareness.setLocalStateField("caret", null)
			return leave(room)
		},
	}
}
