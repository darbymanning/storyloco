import * as Y from "yjs"
import {
	Awareness,
	applyAwarenessUpdate,
	encodeAwarenessUpdate,
	removeAwarenessStates,
} from "y-protocols/awareness"
import {
	call,
	editor,
	load_inbox,
	on_navigate,
	on_sent,
	refresh,
	set_presence,
	type Person,
} from "./client.js"
import { same } from "./content.js"

/*
 * Multiplayer: everyone editing the site holds a socket to its space's room in moxy, which passes
 * on where each of them is and what they're doing. Fields typed in together share a Yjs document
 * per field (a "room" here), and of the people in one, the first to arrive saves it for everyone,
 * so it's saved once, from the merged text, rather than by each person over the others.
 */

export type { Person }

/** Where someone's pointer is: over a block, as a fraction of it, or else on the page; and what they're saying there */
export type Cursor = {
	id: string
	uid?: string
	rx?: number
	ry?: number
	/** The element under it, by child indices from the block; then a share of that element's box */
	path?: Array<number>
	ex?: number
	ey?: number
	/** Over text: the character under it, counted through the element's text, and how far off it */
	char?: number
	dx?: number
	dy?: number
	x?: number
	y?: number
	gone?: boolean
	chat?: string | null
}

/** Where someone has scrolled to: a point in a block, or down the page, held a share (`at`) of the way down the screen */
export type View = { id: string; uid?: string; ry?: number; y?: number; at: number }

let socket: WebSocket | null = null
let me: { id: string; color: string } | null = null
let people: Array<Person> = []

const people_listeners = new Set<() => void>()

/** Hear whenever someone arrives, moves page, selects something or leaves */
export function on_people(listener: () => void) {
	people_listeners.add(listener)
	return () => people_listeners.delete(listener)
}

/** Who's here, for the edit bar, which reads it from the client so visitors never load any of this */
function changed() {
	set_presence({ me, people })
	for (const listener of people_listeners) listener()
}

/** Everyone else on this page, earliest first */
export const others = () => people.filter((p) => p.id !== me?.id && p.page === location.pathname)

const cursor_listeners = new Set<(cursor: Cursor) => void>()

/** Hear where others' pointers move; returns the way to stop */
export function on_cursor(listener: (cursor: Cursor) => void) {
	cursor_listeners.add(listener)
	return () => cursor_listeners.delete(listener)
}

function post(message: Record<string, unknown>) {
	if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

/** Say which page this is, and its story once known */
export function here() {
	post({ t: "here", page: location.pathname, story: editor.story?.id ?? null })
}

/** Where this pointer is, for the others to draw */
export const cursor = (at: Omit<Cursor, "id">) => post({ t: "cursor", ...at })

/** Where this person has scrolled to, for anyone following them */
export const view = (at: Omit<View, "id">) => post({ t: "view", ...at })

const view_listeners = new Set<(view: View) => void>()

/** Hear where others scroll to; returns the way to stop */
export function on_view(listener: (view: View) => void) {
	view_listeners.add(listener)
	return () => view_listeners.delete(listener)
}

const comment_listeners = new Set<(page: string) => void>()

/** Hear when anyone in the space adds, resolves or removes a comment, and on which page */
export function on_comments(listener: (page: string) => void) {
	comment_listeners.add(listener)
	return () => comment_listeners.delete(listener)
}

/** What this person has selected, for the others to outline */
export const select = (selected: Person["select"]) => post({ t: "select", select: selected })

// --- the connection

let wanted = false
let attempts = 0
/** Whether this page has been connected before, so an open after it is a reconnect */
let was_open = false
/** "Still here", so the room can tell an open page from one asleep with its socket half open */
let heartbeat: ReturnType<typeof setInterval> | undefined
let retry: ReturnType<typeof setTimeout> | undefined

/** Join the room, staying connected until `stop` */
export function start() {
	if (wanted) return
	wanted = true
	open()
}

export function stop() {
	wanted = false
	clearTimeout(retry)
	clearInterval(heartbeat)
	socket?.close()
	socket = null
	me = null
	people = []
	changed()
}

async function open() {
	if (!wanted || socket) return
	try {
		const { ticket, url } = await call<{ ticket: string; url: string }>({ op: "live" })
		if (!wanted || socket) return
		const ws = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`)
		socket = ws
		ws.onmessage = (event) => receive(JSON.parse(event.data))
		ws.onopen = () => {
			attempts = 0
			here()
			for (const room of rooms.values()) join(room)
			// saves made while this page was cut off weren't heard: catch up with them
			if (was_open) refresh()
			was_open = true
			clearInterval(heartbeat)
			heartbeat = setInterval(() => post({ t: "ping" }), 25_000)
		}
		ws.onclose = () => {
			if (socket !== ws) return
			clearInterval(heartbeat)
			socket = null
			me = null
			people = []
			changed()
			if (wanted) again()
		}
	} catch (e) {
		// signed out, here or elsewhere: nothing to reconnect to until this page signs in again
		if ((e as Error).message === "Sign in to edit") return stop()
		again()
	}
}

/** Try again, a little later each time, up to half a minute */
function again() {
	clearTimeout(retry)
	retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** attempts++))
}

// someone else's save to a story this page shows: show it too
let pending_refresh: ReturnType<typeof setTimeout> | undefined
function shows(story: number) {
	if (editor.story?.id === story) return true
	for (const node of document.querySelectorAll<HTMLElement>("[data-blok-c]"))
		if (
			node.dataset.blokC?.includes(`"id":"${story}"`) ||
			node.dataset.blokC?.includes(`"id":${story}`)
		)
			return true
	return false
}

type Message = Record<string, unknown> & { t: string; room?: string; from?: string }

function receive(message: Message) {
	const room = typeof message.room === "string" ? rooms.get(message.room) : undefined
	switch (message.t) {
		case "welcome":
			me = { id: message.id as string, color: message.color as string }
			for (const r of rooms.values()) r.awareness.setLocalStateField("user", whoami())
			changed()
			return
		case "people":
			people = message.people as Array<Person>
			changed()
			// someone leaving can make this browser the one to save a field
			for (const r of rooms.values()) if (leads(r)) later(r)
			return
		case "cursor":
			for (const listener of cursor_listeners) listener(message as unknown as Cursor)
			return
		case "view":
			for (const listener of view_listeners) listener(message as unknown as View)
			return
		case "comments":
			for (const listener of comment_listeners) listener(message.page as string)
			return
		case "inbox":
			// a comment that concerns this person: the bell catches up
			load_inbox()
			return
		case "saved":
			if (!shows(message.story as number)) return
			clearTimeout(pending_refresh)
			pending_refresh = setTimeout(refresh, 250)
			return
		case "joined":
			if (!room) return
			clearTimeout(room.asking)
			return room.settle(true)
		case "state?":
			// someone joining a field this browser is in wants what's typed so far; one it has left
			// already, the room still counts it in, so it says so and the room asks someone else
			if (!room) return post({ t: "leave", room: message.room })
			room.ready.then(() =>
				post({
					t: "state",
					room: room.key,
					to: message.to,
					update: b64(Y.encodeStateAsUpdate(room.doc)),
					vector: b64(Y.encodeStateVector(room.doc)),
					awareness: b64(
						encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()])
					),
				})
			)
			return
		case "state": {
			if (!room) return
			clearTimeout(room.asking)
			Y.applyUpdate(room.doc, bytes(message.update as string), REMOTE)
			applyAwarenessUpdate(room.awareness, bytes(message.awareness as string), REMOTE)
			// back the other way: whatever this browser has that they don't, like typing while cut off
			const missing = Y.encodeStateAsUpdate(room.doc, bytes(message.vector as string))
			if (missing.length > 2) post({ t: "update", room: room.key, update: b64(missing) })
			return room.settle(false)
		}
		case "update":
			if (room) Y.applyUpdate(room.doc, bytes(message.update as string), REMOTE)
			return
		case "awareness":
			if (room) applyAwarenessUpdate(room.awareness, bytes(message.update as string), REMOTE)
			return
	}
}

on_navigate(() => {
	// a new page leaves the fields of the last one in the room; any still showing here join again,
	// once the overlay has let go of those that aren't
	here()
	setTimeout(() => {
		for (const room of rooms.values()) join(room)
	})
	for (const listener of cursor_listeners) listener({ id: "*", gone: true })
})

// a save from this page tells the others, so their pages show it straight away
on_sent((change) => {
	if (typeof change.story === "number" && change.op !== "publish")
		post({ t: "saved", story: change.story })
})

// --- fields typed in together

const REMOTE = Symbol("remote")

// in pieces: a long document has more bytes than a function call takes arguments
function b64(data: Uint8Array) {
	let text = ""
	for (let i = 0; i < data.length; i += 0x8000)
		text += String.fromCharCode(...data.subarray(i, i + 0x8000))
	return btoa(text)
}
const bytes = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

function whoami() {
	return { name: editor.user?.name?.split(" ")[0] ?? "Someone", color: me?.color ?? "#05807f" }
}

export type Room = {
	key: string
	doc: Y.Doc
	awareness: Awareness
	/** Resolves once the document has what's been typed so far: true when this browser started it */
	ready: Promise<boolean>
	settle(first: boolean): void
	/** Whether it has the text so far; until then its document is empty, and must never be saved */
	synced: boolean
	/** The field's value now, and how to save it, true once it has; given by whatever's editing it */
	value?: () => unknown
	save?: (value: unknown, shared: boolean) => Promise<boolean>
	/** The value last saved, so an unchanged field isn't saved again */
	saved?: unknown
	/** Whether this person has typed in it, so leaving saves what they typed whoever else saves it */
	typed: boolean
	users: number
	timer?: ReturnType<typeof setTimeout>
	asking?: ReturnType<typeof setTimeout>
	/** The save in flight, so the next waits for it rather than racing it */
	saving?: Promise<void>
}

const rooms = new Map<string, Room>()

/** The others in a room */
const with_me = (room: Room) => people.filter((p) => p.id !== me?.id && p.rooms.includes(room.key))

/** Who saves a room's field: the first of those in it to arrive */
export function leader_of(everyone: Array<Person>, key: string) {
	const members = everyone.filter((p) => p.rooms.includes(key))
	members.sort((a, b) => a.joined - b.joined)
	return members[0]?.id ?? null
}

/**
 * Whether this browser saves the room's field as it changes: the one to, or alone. Cut off from
 * the others it can't tell, so it leaves that to whoever is, and saves its own typing as it leaves.
 */
export function leads(room: Room) {
	if (!me) return !wanted
	const leader = leader_of(people, room.key)
	return leader === null || leader === me.id
}

/** A change to a room that isn't anyone typing, like putting the saved text in to start it */
export function quietly(room: Room, change: () => void) {
	const was = room.typed
	change()
	room.typed = was
}

/** Whether anyone else is in the room */
export const shared = (room: Room) => with_me(room).length > 0

function join(room: Room) {
	// only the room can say who starts a field, so two people never each start their own copy;
	// with no room to ask, this page is on its own and starts it
	if (!wanted) return room.settle(true)
	if (socket?.readyState !== WebSocket.OPEN) return
	post({ t: "join", room: room.key })
	// whoever was asked for the text didn't answer: ask again, and the room asks someone else
	clearTimeout(room.asking)
	room.asking = setTimeout(() => join(room), 4000)
}

/** Save soon, if this browser saves the room's field and it changed */
function later(room: Room) {
	clearTimeout(room.timer)
	room.timer = setTimeout(() => flush(room), 800)
}

/** Save the field if it changed, one save at a time; `leaving` saves this person's own typing regardless */
async function flush(room: Room, leaving = false) {
	clearTimeout(room.timer)
	// each waits its turn, then looks again: the save before may have saved this already
	while (room.saving) await room.saving
	// an empty document isn't the field's text, just none of it arrived yet
	if (!room.synced || !room.value || !room.save) return
	if (!leads(room) && !(leaving && room.typed)) return
	const value = room.value()
	if (room.saved !== undefined && same(value, room.saved)) return
	room.saving = room
		.save(value, shared(room))
		// a save that failed leaves the last good one, so the next tries again
		.then((ok) => void (ok && (room.saved = value)))
		.catch(() => {})
		.finally(() => (room.saving = undefined))
	await room.saving
}

/**
 * The shared document for one field, `story:uid:field`, joined until every `leave`. Several
 * editors of the same field on this page (the text in place and its settings) share it too.
 */
export function enter(key: string): Room {
	const found = rooms.get(key)
	if (found) {
		found.users++
		return found
	}
	const doc = new Y.Doc()
	const awareness = new Awareness(doc)
	awareness.setLocalStateField("user", whoami())
	let resolve: (first: boolean) => void = () => {}
	const room: Room = {
		key,
		doc,
		awareness,
		ready: new Promise((go) => (resolve = go)),
		settle(first) {
			if (room.synced) return
			room.synced = true
			resolve(first)
		},
		synced: false,
		typed: false,
		users: 1,
	}
	doc.on("update", (update: Uint8Array, origin: unknown) => {
		if (origin !== REMOTE) {
			room.typed = true
			post({ t: "update", room: key, update: b64(update) })
		}
		later(room)
	})
	awareness.on(
		"update",
		(
			{
				added,
				updated,
				removed,
			}: { added: Array<number>; updated: Array<number>; removed: Array<number> },
			origin: unknown
		) => {
			if (origin === REMOTE) return
			const changes = [...added, ...updated, ...removed]
			post({ t: "awareness", room: key, update: b64(encodeAwarenessUpdate(awareness, changes)) })
		}
	)
	rooms.set(key, room)
	join(room)
	// no connection to the others, still: carry on alone rather than stop someone typing
	setTimeout(() => !me && room.settle(true), 6000)
	return room
}

/** Done with a room; the last to leave on this page saves what's unsaved, if it's theirs to */
export async function leave(room: Room) {
	if (--room.users > 0) return
	rooms.delete(room.key)
	clearTimeout(room.asking)
	// out of the room before the save, so coming straight back in joins afresh rather than being
	// undone by this leaving afterwards
	removeAwarenessStates(room.awareness, [room.doc.clientID], "leave")
	post({ t: "leave", room: room.key })
	await flush(room, true)
	room.awareness.destroy()
	room.doc.destroy()
}

/** The one edit that turns `now` into `next`: where, how much goes, and what comes in */
export function edit_of(now: string, next: string) {
	let start = 0
	while (start < now.length && start < next.length && now[start] === next[start]) start++
	let end = 0
	while (
		end < now.length - start &&
		end < next.length - start &&
		now[now.length - 1 - end] === next[next.length - 1 - end]
	)
		end++
	return {
		start,
		removed: now.length - start - end,
		inserted: next.slice(start, next.length - end),
	}
}

/**
 * The edit that turned `shown` into `typed`, moved to the same place in `now`, which others may
 * have changed meanwhile: after the same text before it, or else before the same text after it
 */
export function rebase(shown: string, typed: string, now: string) {
	const edit = edit_of(shown, typed)
	const before = shown.slice(0, edit.start)
	const after = shown.slice(edit.start + edit.removed)
	if (!now.startsWith(before) && now.endsWith(after))
		edit.start = now.length - after.length - edit.removed
	return edit
}

/** Make an edit to a Y.Text, kept within what it holds */
export function apply_edit(text: Y.Text, edit: ReturnType<typeof edit_of>, origin?: unknown) {
	const at = Math.min(edit.start, text.length)
	text.doc!.transact(() => {
		text.delete(at, Math.min(edit.removed, text.length - at))
		text.insert(at, edit.inserted)
	}, origin)
}

/** Put plain text into a Y.Text as the smallest edit, so others' typing nearby survives it */
export function type_into(text: Y.Text, next: string, origin?: unknown) {
	const now = text.toString()
	if (now !== next) apply_edit(text, edit_of(now, next), origin)
}

/** Where a caret at `index` ends up after the text changes, others' edits included */
export function anchor(text: Y.Text, index: number) {
	const position = Y.createRelativePositionFromTypeIndex(text, index)
	return () => Y.createAbsolutePositionFromRelativePosition(position, text.doc!)?.index ?? index
}
