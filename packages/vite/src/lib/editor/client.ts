import type { Attachment } from "svelte/attachments"
import { createSubscriber } from "svelte/reactivity"
import type { ISbStoryData } from "@storyblok/svelte"
import type { EditorUser } from "./server.js"
import { find_blok, like_page } from "./content.js"

export type { EditorUser }

/** Someone a site's draft is shared with, as their page knows them */
export type SharedWith = {
	name: string | null
	role: "view" | "comment"
	/** false until someone who came by the share's link says who they are */
	named: boolean
	by: string | null
}

/** What the `editor` hook writes into previews and signed-in pages */
type Injected = {
	user: EditorUser | null
	space: string | null
	draft: boolean
	guest?: SharedWith | null
}

let injected: Injected = { user: null, space: null, draft: false, guest: null }
let read = false
let changed = () => {}

// One subscriber for everything below. The server can't see the hook's script tag, so the first
// render is signed out everywhere and the rest arrives just after hydration; reading it before
// then would make the two disagree
const watch = createSubscriber((update) => {
	changed = update
	if (!read && typeof document !== "undefined") {
		read = true
		queueMicrotask(() => {
			const tag = document.getElementById("storyloco-editor")
			if (tag) injected = JSON.parse(tag.textContent || "{}")
			update()
		})
	}
	return () => (changed = () => {})
})

type View = { readonly story: ISbStoryData | null; show?(content: unknown): void }

/** The story the page connected with `client.connect()`, for its status and links */
let connected: View | null = null

/** The page's story when nothing connected one, worked out from the blocks on the page */
let detected: ISbStoryData | null = null

/** Someone editing the site, as the multiplayer room sees them */
export type Person = {
	id: string
	user: {
		id: number | string
		name: string | null
		/** their Storyblok photo, and the Gravatar hash to try after it */
		photo?: string | null
		gravatar?: string | null
	}
	color: string
	joined: number
	page: string | null
	story: number | null
	select: { uid: string; field?: string } | null
	rooms: Array<string>
}

let presence: { me: { id: string; color: string } | null; people: Array<Person> } = {
	me: null,
	people: [],
}

/** Set by the multiplayer connection, loaded only for editors */
export function set_presence(next: typeof presence) {
	presence = next
	if (following && !next.people.some((p) => p.id === following)) following = null
	changed()
}

/** A comment that concerns this person: they were mentioned in it, or it's a reply in their thread */
export type Notice = {
	id: string
	thread: string
	kind: "mention" | "reply" | "review"
	author: string | null
	body: string
	page: string
	origin: string
	place: string | null
	created_at: number
	read_at: number | null
}

let inbox: { notices: Array<Notice>; unread: number } = { notices: [], unread: 0 }

/** Fetch this person's notifications again, say after one arrives; an inbox that can't be read stays as it was */
export async function load_inbox() {
	if (!injected.user) return
	inbox = await call<typeof inbox>({ op: "comments", do: "inbox" }).catch(() => inbox)
	changed()
}

/** Mark notifications read: these, every one for a thread, or all of them */
export async function read_notices(which: { ids?: Array<string>; thread?: string; all?: boolean }) {
	const now = Date.now()
	// at once here, so the count drops as it's clicked rather than after the round trip
	const read = (n: Notice) =>
		which.all || n.thread === which.thread || which.ids?.includes(n.id)
			? { ...n, read_at: n.read_at ?? now }
			: n
	const notices = inbox.notices.map(read)
	inbox = {
		notices,
		unread: Math.max(
			0,
			inbox.unread -
				(inbox.notices.filter((n) => !n.read_at).length - notices.filter((n) => !n.read_at).length)
		),
	}
	changed()
	await call({ op: "comments", do: "read", ...which }).catch(() => {})
	await load_inbox()
}

/** Whose view this page follows: the page they're on, and where they've scrolled to */
let following: string | null = null

const follow_listeners = new Set<() => void>()

/** Follow someone's view, or stop with null */
export function follow(id: string | null) {
	if (following === id) return
	following = id
	changed()
	for (const listener of follow_listeners) listener()
}

/** Run `listener` whenever following starts or stops */
export function on_follow(listener: () => void) {
	follow_listeners.add(listener)
	return () => follow_listeners.delete(listener)
}

/** Whether a page connected its story, so the overlay knows to work it out itself */
export const connected_story = () => connected?.story ?? null

const navigations = new Set<() => void>()

/** Run `listener` after each client-side navigation, which the edit bar reports */
export function on_navigate(listener: () => void) {
	navigations.add(listener)
	return () => navigations.delete(listener)
}

/** Called by the edit bar, which as a component can hear SvelteKit's navigations */
export function navigated() {
	// an undo shouldn't change a page that isn't showing
	undos.length = redos.length = 0
	for (const listener of navigations) listener()
}

/** Set the story the overlay worked out, for the edit bar's status and Publish */
export function detected_story(story: ISbStoryData | null) {
	detected = story
	changed()
	if (story) check_live(story.id)
}

/**
 * Show an earlier version's content in place of the connected story's, or the story again with
 * `null`; false when the page didn't connect its story, so can't show one
 */
export function show_version(content: unknown) {
	if (!connected?.show) return false
	// the story itself, not a version already showing, says what the page has resolved
	connected.show(null)
	if (content !== null && connected.story)
		connected.show(like_page(content, connected.story.content))
	return true
}

/** Called by `connect`; the returned cleanup forgets the story once its page goes */
export function track(view: View) {
	connected = view
	changed()
	return () => {
		if (connected !== view) return
		connected = null
		changed()
	}
}

let pending = 0
let problem: string | null = null

const EDITING = "storyloco-editing"
/** Edit mode: on, the page's content can be selected and changed; off, it behaves as a visitor sees it */
let editing = true
try {
	editing = typeof localStorage === "undefined" || localStorage.getItem(EDITING) !== "off"
} catch {
	// storage blocked: start in edit mode
}

/** Unpublished changes once a save is more than a second after the last publish, which stamps both */
/** `checking`: saved since it was published, and whether that changed anything isn't known yet */
export type Status = "draft" | "changed" | "published" | "checking"

/**
 * Whether a story's draft has the same content as what's live, as last checked, for the save it
 * was checked at: a save after publishing that changed nothing, or was undone, isn't a change
 */
const matches_live = new Map<number, { updated_at: string | undefined; same: boolean }>()

function status_of({ id, published_at, updated_at }: ISbStoryData): Status {
	if (!published_at) return "draft"
	const saved_since = updated_at && Date.parse(updated_at) - Date.parse(published_at) > 1000
	if (!saved_since) return "published"
	const checked = matches_live.get(id)
	if (checked?.updated_at !== updated_at) return "checking"
	return checked.same ? "published" : "changed"
}

/** Compare a story's draft with what's live, so its status says whether there's anything to publish */
export async function check_live(id: number) {
	const updated_at = (connected?.story ?? detected)?.updated_at
	const reply = await call<{ stories: Array<Pending> }>({ op: "changes", stories: [id] }).catch(
		() => null
	)
	const story = reply?.stories.find((s) => s.id === id)
	// couldn't tell: the timestamps are all there is, so a real change is never hidden
	const same = !!story?.published_at && story.changes?.length === 0
	matches_live.set(id, { updated_at, same })
	if (same) touched.delete(id)
	changed()
}

export const editor = {
	/** Who's signed in to edit, from the `editor` hook; null for everyone else and on the server */
	get user(): EditorUser | null {
		watch()
		return injected.user
	},
	/** Someone the draft is shared with, who isn't signed in to edit */
	get guest(): SharedWith | null {
		watch()
		return injected.guest ?? null
	},
	/** Whether the page shows drafts: a preview, or someone signed in */
	get draft(): boolean {
		watch()
		return injected.draft
	},
	/** The site's Storyblok space, on previews */
	get space(): string | null {
		watch()
		return injected.space
	},
	/** The page's story, with its publish status */
	get story() {
		watch()
		const story = connected?.story ?? detected
		if (!story) return null
		const { id, uuid, name, published_at, updated_at } = story
		return {
			id,
			uuid,
			name,
			uid: story.content._uid,
			published_at,
			updated_at,
			status: status_of(story),
		}
	},
	/** Edits still on their way to Storyblok */
	get saving(): boolean {
		watch()
		return pending > 0
	},
	/** Why the last change didn't save, until the next one does */
	get problem(): string | null {
		watch()
		return problem
	},
	/** This person's notifications, newest first, and how many they haven't seen */
	get inbox() {
		watch()
		return inbox
	},
	/** Who this page is following, by their place in the room */
	get following() {
		watch()
		return following
	},
	/** Everyone else editing this page right now, and this person's colour among them */
	get here(): { color: string | null; people: Array<Person> } {
		watch()
		const page = typeof location === "undefined" ? null : location.pathname
		return {
			color: presence.me?.color ?? null,
			// whoever's followed stays listed as they move between pages, since this page goes after them
			people: presence.people.filter(
				(p) => p.id !== presence.me?.id && (p.page === page || p.id === following)
			),
		}
	},
	/** Whether edit mode is on; `set_editing` turns it off and on */
	get editing(): boolean {
		watch()
		return editing && !!injected.user
	},
}

/** Turn edit mode on or off, remembering it in this browser unless it's only for a moment */
export function set_editing(on: boolean, remember = true) {
	editing = on
	try {
		if (remember) localStorage.setItem(EDITING, on ? "on" : "off")
	} catch {
		// storage blocked: it lasts until the page reloads
	}
	changed()
	for (const listener of toggled) listener(on)
}

const toggled = new Set<(on: boolean) => void>()

/** Run `listener` whenever edit mode turns on or off; returns the way to stop */
export function on_editing(listener: (on: boolean) => void) {
	toggled.add(listener)
	return () => toggled.delete(listener)
}

const here = () => location.pathname + location.search

/** Sign in to edit through Storyblok, coming back to `path`; `onclick={signin}` comes back here */
export function signin(path?: string | Event) {
	const to = typeof path === "string" ? path : here()
	location.assign(`/__storyloco/signin?return=${encodeURIComponent(to)}`)
}

/** A POST rather than a link, so another site can't sign anyone out */
export async function signout() {
	await fetch("/__storyloco/signout", { method: "POST" })
	location.reload()
}

/** A guest who's just said who they are, for the page to carry on as them */
export function set_guest(guest: SharedWith) {
	injected = { ...injected, guest }
	changed()
}

/** A guest done with the draft: signed out of it on this browser */
export async function leave_share() {
	await fetch("/__storyloco/api", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ op: "guest_leave" }),
	}).catch(() => {})
	location.reload()
}

/** Ask the `editor` hook for something; the reply, or why it couldn't */
export async function call<T>(change: Record<string, unknown>): Promise<T> {
	const res = await fetch("/__storyloco/api", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(change),
	}).catch(() => null)
	if (!res?.ok)
		throw new Error(
			(await res?.json().catch(() => null))?.message ?? "Couldn’t reach the site to save"
		)
	return res.json()
}

const saved_listeners = new Set<() => void>()

/** Run `listener` after each change lands and the page has its new data */
export function on_saved(listener: () => void) {
	saved_listeners.add(listener)
	return () => saved_listeners.delete(listener)
}

type Change = Record<string, unknown>
type Done = { change: Change; label: string }

/** What each change undoes, newest last; each undo's own reverse goes on `redos` */
const undos: Array<Done> = []
const redos: Array<Done> = []

const LABELS: Record<string, string> = {
	set: "edit",
	fields: "edit",
	image: "image",
	mux_set: "video",
	name: "rename",
	move: "move",
	remove: "delete",
	restore: "delete",
	revert: "restore",
	insert: "add",
	duplicate: "duplicate",
}

/** Stories changed from this page since they were last published, so Publish shows for a shared one too */
const touched = new Set<number>()

/** The page's data again, as after a save, for a change made somewhere else */
export async function refresh() {
	// only the browser ever saves, so the server and tests never load this
	const { invalidateAll } = await import("$app/navigation")
	await invalidateAll()
	for (const listener of saved_listeners) listener()
}

const sent_listeners = new Set<(change: Change) => void>()

/** Run `listener` with each change once it has saved, before the page reloads its data */
export function on_sent(listener: (change: Change) => void) {
	sent_listeners.add(listener)
	return () => sent_listeners.delete(listener)
}

/**
 * Send a change to the `editor` hook, then reload the page's data so it shows; null if it didn't
 * save. A `shared` change, typed by several people at once, isn't any one of theirs to undo.
 */
export async function send(change: Change, as: "change" | "undo" | "redo" | "shared" = "change") {
	pending++
	changed()
	try {
		const reply = await call<Record<string, unknown>>(change)
		problem = null
		const back = reply.undo as Change | undefined
		const label = LABELS[String(change.op)]
		if (back && label && as !== "shared") {
			if (as === "undo") redos.push({ change: back, label })
			else {
				undos.push({ change: back, label })
				if (undos.length > 100) undos.shift()
				if (as === "change") redos.length = 0
			}
		}
		if (label && typeof change.story === "number") touched.add(change.story)
		for (const listener of sent_listeners) listener(change)
		await refresh()
		return reply
	} catch (e) {
		problem = (e as Error).message
		return null
	} finally {
		pending--
		changed()
	}
}

/** Why the last change didn't save, for the overlay's own messages */
export const last_problem = () => problem

/** Undo the last change made from this page; what it undid, or null with nothing to undo or if it failed */
export async function undo() {
	const done = undos.pop()
	if (!done) return null
	changed()
	return (await send(done.change, "undo")) ? done.label : null
}

/** Make the last undone change again */
export async function redo() {
	const done = redos.pop()
	if (!done) return null
	changed()
	return (await send(done.change, "redo")) ? done.label : null
}

export const history = {
	get undo() {
		watch()
		return undos.at(-1)?.label ?? null
	},
	get redo() {
		watch()
		return redos.at(-1)?.label ?? null
	},
}

/** Whether there's anything Publish would send live: the page's own story, or one edited from it */
export const unpublished = () =>
	(editor.story && (editor.story.status === "draft" || editor.story.status === "changed")) ||
	touched.size > 0

/** A story's unpublished changes, block by block; null when there's no live copy to compare */
export type Pending = {
	id: number
	name: string
	full_slug: string
	published_at: string | null
	changes: Array<{ uid: string; component: string; kind: string; hint?: string }> | null
}

/** Stories on this page, its own first, with changes that aren't live yet */
export async function review() {
	const ids = new Set<number>()
	if (editor.story) ids.add(editor.story.id)
	for (const id of touched) ids.add(id)
	for (const node of document.querySelectorAll<HTMLElement>("[data-blok-c]")) {
		try {
			const id = Number(JSON.parse(node.dataset.blokC ?? "{}").id)
			if (id) ids.add(id)
		} catch {
			// not one of Storyblok's
		}
	}
	const { stories } = await call<{ stories: Array<Pending> }>({
		op: "changes",
		stories: [...ids].slice(0, 20),
	})
	for (const id of touched) if (!stories.some((s) => s.id === id)) touched.delete(id)
	changed()
	return stories
}

/** Publish these stories, the page's own by default, if the signed-in person's role allows it */
export async function publish(ids?: Array<number>) {
	const stories = ids ?? (editor.story ? [editor.story.id] : [])
	let ok = stories.length > 0
	for (const story of stories) {
		if (await send({ op: "publish", story })) touched.delete(story)
		else ok = false
	}
	changed()
	return ok
}

type Blok = { _uid?: string }

/** Each blok's content by the element `attrs` spread onto, for the overlay to read */
export const bloks = new WeakMap<Element, Blok>()

/** A blok in the page's connected story, resolved relations included, by its `_uid` */
export function page_blok(uid: string): Blok | undefined {
	return connected?.story
		? (find_blok(connected.story.content, uid) as Blok | undefined)
		: undefined
}

/**
 * In-place editing for someone signed in, outside Storyblok's own editor. `attrs` spreads this
 * onto every blok's root, so a site marks nothing up: the blok's content is noted against its
 * element, and one overlay for the whole page does the rest, loaded the first time it's needed.
 */
export function in_place(blok: Blok): Attachment<HTMLElement> | undefined {
	if (!blok._uid || !editor.user) return

	return (node) => {
		if (window.self !== window.top || !node.dataset.blokC) return
		bloks.set(node, blok)
		import("./overlay.js").then(({ install }) => install())
		return () => {
			if (bloks.get(node) === blok) bloks.delete(node)
		}
	}
}
