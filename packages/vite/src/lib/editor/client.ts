import type { Attachment } from "svelte/attachments"
import { tick } from "svelte"
import { createSubscriber } from "svelte/reactivity"
import type { ISbStoryData } from "@storyblok/svelte"
import type { EditorUser } from "./server.js"
import {
	copy_blok,
	draft_is_live,
	find_blok,
	like_page,
	locate,
	page_of,
	who_is_where,
} from "./content.js"

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
	/** A staging site, where anyone may switch between drafts and what's live */
	staging?: boolean
	guest?: SharedWith | null
	/** Edit mode on as the page lands, as the sign-in that brought them here asked */
	edit?: boolean
	/** Where to load the editor app from; this package's own copy when there's none */
	app?: string | null
}

/**
 * What the editor app may ask of the site, beyond the state below: SvelteKit's navigation and
 * page, which only the site's own bundle can reach. `EditBar` provides it
 */
export type Kit = {
	goto(url: string, options?: { replaceState?: boolean; noScroll?: boolean }): Promise<void>
	/** The page's data again: `refreshAll` on SvelteKit 3, `invalidateAll` on 2 */
	refresh(): Promise<void>
	replace_state(url: string | URL, state: unknown): void
	page(): { url: URL; state: unknown }
}

/** The editor app, loaded from moxy or from this package */
export type App = {
	/** The bridge it was built against, which must be this page's */
	bridge: number
	mount(
		target: HTMLElement,
		props: { accent?: string; accent_ink?: string }
	): { set(props: { accent?: string; accent_ink?: string }): void; destroy(): void }
	install(): void
	welcome(): void
}

/**
 * The shape of what's shared below. A change to a field the site's copy reads or writes, or to
 * `Kit` and `App`, is a new bridge; anything the app alone uses can change freely
 */
export const BRIDGE = 1

type View = { readonly story: ISbStoryData | null; show?(content: unknown): void }

/** Someone editing the site, as the multiplayer room sees them */
export type Person = {
	id: string
	user: {
		id: number | string
		name: string | null
		/** their Storyblok photo, and the Gravatar hash to try after it */
		photo?: string | null
		gravatar?: string | null
		/** a guest who hasn't given a name has a made-up one, and a small picture for a face: the inside of an svg */
		art?: string
	}
	/** someone a draft is shared with, rather than an editor of the space */
	guest?: boolean
	/** their page is hidden, or they haven't touched it for a while */
	idle?: boolean
	color: string
	joined: number
	page: string | null
	story: number | null
	select: { uid: string; field?: string } | null
	rooms: Array<string>
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

type Change = Record<string, unknown>
/** `before`: the page's content as it showed before the change, when it's the page's own story, to show again at once */
type Done = { change: Change; label: string; at?: number; before?: unknown }
type Blok = { _uid?: string }

/**
 * Everything the editor keeps for the page, on the page rather than in this module: the site's
 * bundle and the editor app, loaded from elsewhere, each have a copy of this module, and both see
 * and change the one state. Each copy fills in what an older one didn't know about
 */
type State = {
	bridge: number
	injected: Injected
	read: boolean
	/** each Svelte runtime's way to say what it shows has changed */
	subscribers: Set<() => void>
	/** the story the page connected with `client.connect()`, for its status and links */
	connected: View | null
	/** the page's story when nothing connected one, worked out from the blocks on the page */
	detected: ISbStoryData | null
	presence: { me: { id: string; color: string } | null; people: Array<Person> }
	inbox: { notices: Array<Notice>; unread: number }
	/** whose view this page follows, by their user: the page they're on, and where they've scrolled to */
	following: string | null
	/** When someone followed went missing, to stop following them if they don't come back */
	follow_wait: ReturnType<typeof setTimeout> | null
	/** When each connection last changed page, to tell which of someone's tabs they're using */
	moved: Map<string, number>
	follow_listeners: Set<() => void>
	navigations: Set<() => void>
	pending: number
	problem: string | null
	editing: boolean
	/** the block settings open in the edit bar, rather than folded to the block's name */
	settings_open: boolean
	toggled: Set<(on: boolean) => void>
	matches_live: Map<number, { updated_at: string | undefined; same: boolean }>
	saved_listeners: Set<() => void>
	sent_listeners: Set<(change: Change) => void>
	undos: Array<Done>
	redos: Array<Done>
	touched: Set<number>
	bloks: WeakMap<Element, Blok>
	kit: Kit | null
	app: Promise<App> | null
	history_heard: boolean
}

const EDITING = "storyloco-editing"
/** Each browser remembers whether the block settings were left open */
const SETTINGS = "storyloco-settings"

const S = ((globalThis as { __storyloco?: Partial<State> }).__storyloco ??= {}) as State
S.bridge ??= BRIDGE
S.injected ??= { user: null, space: null, draft: false, guest: null }
S.read ??= false
S.subscribers ??= new Set()
S.connected ??= null
S.detected ??= null
S.presence ??= { me: null, people: [] }
S.inbox ??= { notices: [], unread: 0 }
S.following ??= null
S.follow_wait ??= null
S.moved ??= new Map()
S.follow_listeners ??= new Set()
S.navigations ??= new Set()
S.pending ??= 0
S.problem ??= null
if (S.editing === undefined) {
	/** Edit mode: on, the page's content can be selected and changed; off, it behaves as a visitor sees it */
	S.editing = true
	try {
		S.editing = typeof localStorage === "undefined" || localStorage.getItem(EDITING) !== "off"
	} catch {
		// storage blocked: start in edit mode
	}
}
if (S.settings_open === undefined) {
	S.settings_open = false
	try {
		S.settings_open = localStorage.getItem(SETTINGS) === "open"
	} catch {
		// storage blocked: folded until it's opened
	}
}
S.toggled ??= new Set()
S.matches_live ??= new Map()
S.saved_listeners ??= new Set()
S.sent_listeners ??= new Set()
S.undos ??= []
S.redos ??= []
S.touched ??= new Set()
S.bloks ??= new WeakMap()
S.kit ??= null
S.app ??= null
S.history_heard ??= false

const changed = () => {
	for (const update of S.subscribers) update()
}

// One subscriber per Svelte runtime for everything below. The server can't see the hook's script
// tag, so the first render is signed out everywhere and the rest arrives just after hydration;
// reading it before then would make the two disagree
const watch = createSubscriber((update) => {
	S.subscribers.add(update)
	read_injected()
	return () => S.subscribers.delete(update)
})

function read_injected() {
	if (S.read || typeof document === "undefined") return
	S.read = true
	queueMicrotask(() => {
		const tag = document.getElementById("storyloco-editor")
		if (tag) S.injected = JSON.parse(tag.textContent || "{}")
		if (S.injected.edit) set_editing(true)
		changed()
	})
}

/** Set by the multiplayer connection, loaded only for editors */
export function set_presence(next: State["presence"]) {
	const was = new Map(S.presence.people.map((person) => [person.id, person.page]))
	for (const person of next.people)
		if (was.has(person.id) && was.get(person.id) !== person.page) S.moved.set(person.id, Date.now())
	for (const id of S.moved.keys())
		if (!next.people.some((person) => person.id === id)) S.moved.delete(id)
	S.presence = next
	keep_following()
	changed()
}

/** Fetch this person's notifications again, say after one arrives; an inbox that can't be read stays as it was */
export async function load_inbox() {
	if (!S.injected.user) return
	S.inbox = await call<State["inbox"]>({ op: "comments", do: "inbox" }).catch(() => S.inbox)
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
	const notices = S.inbox.notices.map(read)
	S.inbox = {
		notices,
		unread: Math.max(
			0,
			S.inbox.unread -
				(S.inbox.notices.filter((n) => !n.read_at).length -
					notices.filter((n) => !n.read_at).length)
		),
	}
	changed()
	await call({ op: "comments", do: "read", ...which }).catch(() => {})
	await load_inbox()
}

/** Open the block settings in the edit bar, or fold them to the block's name */
export function set_settings_open(on: boolean) {
	S.settings_open = on
	try {
		localStorage.setItem(SETTINGS, on ? "open" : "folded")
	} catch {
		// storage blocked: it lasts until the page reloads
	}
	changed()
}

/** Where a tab keeps who it's following, for as long as the tab's open */
const FOLLOWING = "sl_following"
/** How long someone followed can be gone before following them stops: long enough to reload a page */
const FOLLOW_WAIT = 15_000

/** Follow someone's view, or stop with null */
export function follow(id: string | null) {
	if (S.following === id) return
	S.following = id
	if (S.follow_wait) clearTimeout(S.follow_wait)
	S.follow_wait = null
	try {
		if (id) sessionStorage.setItem(FOLLOWING, id)
		else sessionStorage.removeItem(FOLLOWING)
	} catch {
		// not remembered, which only matters if this page reloads
	}
	keep_following()
	changed()
	for (const listener of S.follow_listeners) listener()
}

/** Whoever this tab was following before it reloaded */
export function resume_following() {
	try {
		const kept = sessionStorage.getItem(FOLLOWING)
		if (kept) follow(kept)
	} catch {
		// nothing to pick up again
	}
}

/**
 * Someone reloading looks like them leaving and someone new arriving, and so does this page's own
 * connection dropping, so following only stops if they're still gone after a moment
 */
function keep_following() {
	const there =
		!S.following || S.presence.people.some((person) => String(person.user.id) === S.following)
	if (there) {
		if (S.follow_wait) clearTimeout(S.follow_wait)
		S.follow_wait = null
	} else
		S.follow_wait ??= setTimeout(() => {
			S.follow_wait = null
			follow(null)
		}, FOLLOW_WAIT)
}

/** Run `listener` whenever following starts or stops */
export function on_follow(listener: () => void) {
	S.follow_listeners.add(listener)
	return () => S.follow_listeners.delete(listener)
}

/** Whether a page connected its story, so the overlay knows to work it out itself */
export const connected_story = () => S.connected?.story ?? null

/** Run `listener` after each client-side navigation, which the edit bar reports */
export function on_navigate(listener: () => void) {
	S.navigations.add(listener)
	return () => S.navigations.delete(listener)
}

/** Called by `EditBar`, which as a component of the site's can hear SvelteKit's navigations */
export function navigated() {
	// an undo shouldn't change a page that isn't showing
	S.undos.length = S.redos.length = 0
	for (const listener of S.navigations) listener()
}

/** Set by `EditBar`: SvelteKit, for the editor app, which can't import the site's */
export function set_kit(kit: Kit) {
	S.kit = kit
}

/** SvelteKit's navigation and page, through the site's `EditBar` */
export function kit(): Kit {
	if (!S.kit) throw new Error("storyloco/editor: put <EditBar /> in the root layout")
	return S.kit
}

/** Set the story the overlay worked out, for the edit bar's status and Publish */
export function detected_story(story: ISbStoryData | null) {
	S.detected = story
	changed()
	if (story) check_live(story.id)
}

/**
 * Show an earlier version's content in place of the connected story's, or the story again with
 * `null`; false when the page didn't connect its story, so can't show one
 */
export function show_version(content: unknown) {
	const connected = S.connected
	if (!connected?.show) return false
	// the story itself, not a version already showing, says what the page has resolved
	connected.show(null)
	if (content !== null && connected.story)
		connected.show(like_page(content, connected.story.content))
	return true
}

/**
 * A page framed by Page history, on this site, is its window into the past: it shows the version
 * it's sent, and says so once it's redrawn, whether it could show it in place or not. Heard once,
 * by whichever copy of this module loads first
 */
if (typeof window !== "undefined" && window.self !== window.top && !S.history_heard) {
	S.history_heard = true
	addEventListener("message", async (event: MessageEvent) => {
		const data = event.data as { storyloco?: string; id?: number; content?: unknown } | null
		if (event.origin !== location.origin || data?.storyloco !== "show") return
		const ok = show_version(data.content ?? null)
		await tick()
		await new Promise((done) => requestAnimationFrame(() => done(undefined)))
		;(event.source as Window | null)?.postMessage(
			{ storyloco: "shown", id: data.id, ok },
			{ targetOrigin: location.origin }
		)
	})
}

/** Called by `connect`; the returned cleanup forgets the story once its page goes */
export function track(view: View) {
	S.connected = view
	changed()
	return () => {
		if (S.connected !== view) return
		S.connected = null
		changed()
	}
}

/** Unpublished changes once a save is more than a second after the last publish, which stamps both */
/** `checking`: saved since it was published, and whether that changed anything isn't known yet */
export type Status = "draft" | "changed" | "published" | "checking"

/**
 * Whether a story's draft has the same content as what's live, as last checked, for the save it
 * was checked at: a save after publishing that changed nothing, or was undone, isn't a change
 */
function status_of({ id, published_at, updated_at }: ISbStoryData): Status {
	if (!published_at) return "draft"
	const saved_since = updated_at && Date.parse(updated_at) - Date.parse(published_at) > 1000
	if (!saved_since) return "published"
	const checked = S.matches_live.get(id)
	if (checked?.updated_at !== updated_at) return "checking"
	return checked.same ? "published" : "changed"
}

/** Compare a story's draft with what's live, so its status says whether there's anything to publish */
export async function check_live(id: number): Promise<void> {
	const turn = (checks.get(id) ?? 0) + 1
	checks.set(id, turn)
	const stamp = () => (S.connected?.story ?? S.detected)?.updated_at
	const updated_at = stamp()
	const reply = await call<{ stories: Array<Pending> }>({ op: "changes", stories: [id] }).catch(
		() => null
	)
	// asked again since: that answer is the one to go by, whichever comes back first
	if (checks.get(id) !== turn) return
	note_live(id, updated_at, reply?.stories)
	changed()
	// saved again while this was asked, with nothing since to check it: or it would say "checking" for good
	if (stamp() !== updated_at && (S.connected?.story ?? S.detected)?.id === id) return check_live(id)
}

/** How many times each story's been checked, so an earlier check answering late isn't taken for the latest */
const checks = new Map<number, number>()

function note_live(id: number, updated_at: string | undefined, stories?: Array<Pending>) {
	const same = draft_is_live(stories, id)
	S.matches_live.set(id, { updated_at, same })
	if (same) S.touched.delete(id)
}

export const editor = {
	/** Who's signed in to edit, from the `editor` hook; null for everyone else and on the server */
	get user(): EditorUser | null {
		watch()
		return S.injected.user
	},
	/** Someone the draft is shared with, who isn't signed in to edit */
	get guest(): SharedWith | null {
		watch()
		return S.injected.guest ?? null
	},
	/** A staging site, where a visitor may switch between drafts and what's live */
	get staging(): boolean {
		watch()
		return !!S.injected.staging
	},
	/** Whether the page shows drafts: a preview, or someone signed in */
	get draft(): boolean {
		watch()
		return S.injected.draft
	},
	/** The site's Storyblok space, on previews */
	get space(): string | null {
		watch()
		return S.injected.space
	},
	/** The page's story, with its publish status */
	get story() {
		watch()
		const story = S.connected?.story ?? S.detected
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
		return S.pending > 0
	},
	/** Why the last change didn't save, until the next one does */
	get problem(): string | null {
		watch()
		return S.problem
	},
	/** This person's notifications, newest first, and how many they haven't seen */
	get inbox() {
		watch()
		return S.inbox
	},
	/** Whether the block settings are open in the edit bar, rather than folded to the block's name */
	get settings_open() {
		watch()
		return S.settings_open
	},
	/** Who this page is following, by their user */
	get following() {
		watch()
		return S.following
	},
	/** Everyone else on the site, on this page and elsewhere, and this person as the others see them */
	get here(): {
		color: string | null
		me: Person | null
		people: Array<Person>
		elsewhere: Array<Person>
		followed: Person | null
	} {
		watch()
		const { presence, following, moved, injected } = S
		const { here, elsewhere, followed } = who_is_where({
			people: presence.people,
			me: presence.me?.id,
			page: typeof location === "undefined" ? null : page_of(location.href),
			moved,
			following,
			guest: !!injected.guest,
		})
		return {
			color: presence.me?.color ?? null,
			me: presence.people.find((p) => p.id === presence.me?.id) ?? null,
			people: here,
			elsewhere,
			followed,
		}
	},
	/** Whether edit mode is on; `set_editing` turns it off and on */
	get editing(): boolean {
		watch()
		return S.editing && !!S.injected.user
	},
}

/** Page history's window: this site, framed by itself to show a version as it was */
const in_history = (() => {
	if (typeof window === "undefined" || window.self === window.top) return false
	try {
		return window.parent.location.origin === location.origin
	} catch {
		// framed by another site, like Storyblok's own editor
		return false
	}
})()

const edited_now = () => (S.editing && !!S.injected.user) || in_history

/**
 * Run `listener` only when whether the page is being edited changes, not on every change to the
 * editor's state, like presence or notifications arriving; returns the way to stop
 */
export function on_edited(listener: () => void) {
	let was = edited_now()
	const check = () => {
		if (edited_now() === was) return
		was = !was
		listener()
	}
	S.subscribers.add(check)
	read_injected()
	return () => S.subscribers.delete(check)
}

// its own subscriber, so what rests while editing, like a site's animations, isn't torn down and
// run again each time anything else about the editor changes
const watch_edited = createSubscriber(on_edited)

/** Whether the page is being edited, or shown as it was in Page history's window */
export const being_edited = () => {
	watch_edited()
	return edited_now()
}

/**
 * An attachment that only runs while the page isn't being edited: one whose effect takes over the
 * element's content, like splitting its text into words to animate them, rests in edit mode and in
 * Page history's window, its cleanup undoing it, so the content is the site's own again, to edit in
 * place and to show each version in. It runs again once editing's done.
 *
 * @example
 * ```svelte
 * <h1 {@attach unless_editing((node) => {
 * 	const split = new SplitText(node, { type: "words" })
 * 	return () => split.revert()
 * })}>{title}</h1>
 * ```
 */
export function unless_editing<T extends Element>(attachment: Attachment<T>): Attachment<T> {
	return (node) => (being_edited() ? undefined : attachment(node))
}

/** Turn edit mode on or off, remembering it in this browser unless it's only for a moment */
export function set_editing(on: boolean, remember = true) {
	S.editing = on
	try {
		if (remember) localStorage.setItem(EDITING, on ? "on" : "off")
	} catch {
		// storage blocked: it lasts until the page reloads
	}
	changed()
	for (const listener of S.toggled) listener(on)
}

/** Run `listener` whenever edit mode turns on or off; returns the way to stop */
export function on_editing(listener: (on: boolean) => void) {
	S.toggled.add(listener)
	return () => S.toggled.delete(listener)
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
	S.injected = { ...S.injected, guest }
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

/** Run `listener` after each change lands and the page has its new data */
export function on_saved(listener: () => void) {
	S.saved_listeners.add(listener)
	return () => S.saved_listeners.delete(listener)
}

/**
 * Typing saves at each pause, so one edit is several saves. Another to the same fields of the same
 * blok, soon after, is the same edit: its undo keeps what was there before the first
 */
const TYPING = 30_000
function same_edit(last: Done | undefined, back: Change) {
	if (!last?.at || Date.now() - last.at > TYPING) return false
	const was = last.change
	// a string in a plugin's value, by where it is in it
	if (was.op === "set" && back.op === "set")
		return (
			was.story === back.story &&
			was.uid === back.uid &&
			was.field === back.field &&
			JSON.stringify(was.path) === JSON.stringify(back.path)
		)
	if (was.op !== "fields" || back.op !== "fields") return false
	if (was.story !== back.story || was.uid !== back.uid) return false
	const keys = (change: Change) =>
		Object.keys((change.values as object) ?? {})
			.sort()
			.join()
	return keys(was) === keys(back)
}

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

/** A story of the page's saved since its data was last read, which Storyblok may not be serving yet */
let unread: number | null = null

/** What the page is showing in place of its story's content, ahead of a save */
let ahead: unknown

/** The story that's for */
let ahead_of: number | undefined

/** Show the page's story with this content, or as it's saved again with `null` */
function show(content: unknown) {
	ahead = content ?? undefined
	ahead_of = S.connected?.story?.id
	S.connected?.show?.(content)
}

/*
 * The page connects its story afresh each time its data is read, and what it reads straight after
 * a save can be the draft from before it: what it was shown ahead of the save goes onto the new
 * connection as it's made, before it's drawn, so the page never steps back to how it was
 */
let connection: View | null = null
S.subscribers.add(() => {
	const view = S.connected
	if (view === connection) return
	connection = view
	if (!view || ahead === undefined) return
	// once the page's own effect that made the connection has finished, and still before it's drawn:
	// read and set from inside that effect, the connection's state would become something the
	// effect depends on, and setting it would run the effect again, without end
	queueMicrotask(() => {
		if (S.connected === view && ahead !== undefined && view.story?.id === ahead_of)
			view.show?.(ahead)
	})
})

const frame = () => new Promise((done) => requestAnimationFrame(done))

/**
 * Storyblok serves a draft a moment after it's saved, so a page read straight after a save can
 * get the one before, and be a save behind from then on: read again until the page's story is as
 * new as what's saved
 */
async function catch_up(story: number) {
	const saved = await call<{ story: { updated_at: string } }>({ op: "story", story })
		.then((found) => Date.parse(found.story.updated_at))
		.catch(() => 0)
	for (let wait = 300; saved && wait <= 2400; wait *= 2) {
		// the page connects its story again as it redraws
		await frame()
		const view = S.connected
		if (view?.story?.id !== story || !(Date.parse(view.story.updated_at ?? "") < saved)) break
		await new Promise((done) => setTimeout(done, wait))
		await kit().refresh()
	}
}

/** The page's data again, as after a save, for a change made somewhere else */
export async function refresh() {
	const story = unread
	unread = null
	await kit().refresh()
	if (story !== null && typeof requestAnimationFrame !== "undefined") await catch_up(story)
	for (const listener of S.saved_listeners) listener()
}

/** Run `listener` with each change once it has saved, before the page reloads its data */
export function on_sent(listener: (change: Change) => void) {
	S.sent_listeners.add(listener)
	return () => S.sent_listeners.delete(listener)
}

/**
 * Send a change to the `editor` hook, then reload the page's data so it shows; null if it didn't
 * save. A `shared` change, typed by several people at once, isn't any one of theirs to undo.
 */
export async function send(
	change: Change,
	as: "change" | "undo" | "redo" | "shared" = "change",
	/** `false` while the change is being typed where it shows: the page already shows it, and reloading everything for each pause is what drags */
	{ again = true }: { again?: boolean } = {}
) {
	// the page's content before the change, to show again at once if it's undone: from before it
	// was shown ahead of this save, if it was, or Undo would show the change itself
	const before =
		previewed && previewed.story === change.story ? previewed.content : shown_content(change.story)
	const { undos, redos } = S
	S.pending++
	changed()
	try {
		const reply = await call<Record<string, unknown>>(change)
		S.problem = null
		const back = reply.undo as Change | undefined
		const label = LABELS[String(change.op)]
		// a step back or forward has its way back in place already: `retrace` fills it in
		if (back && label && as === "change") {
			if (same_edit(undos.at(-1), back)) undos.at(-1)!.at = Date.now()
			else {
				undos.push({ change: back, label, before, at: Date.now() })
				if (undos.length > 100) undos.shift()
			}
			redos.length = 0
		}
		if (label && typeof change.story === "number") S.touched.add(change.story)
		if (back && S.connected?.story?.id === change.story) unread = change.story as number
		for (const listener of S.sent_listeners) listener(change)
		if (again) await refresh()
		return reply
	} catch (e) {
		S.problem = (e as Error).message
		return null
	} finally {
		S.pending--
		changed()
	}
}

/** Why the last change didn't save, for the overlay's own messages */
export const last_problem = () => S.problem

/** The page's content as it shows now, if `story` is the one the page connected and can show another's in place */
function shown_content(story: unknown) {
	const view = S.connected
	return view?.show && view.story && view.story.id === story ? view.story.content : undefined
}

/**
 * Show the page's own story with a change made to its content, before the change has saved; the
 * way to show what's saved again, or nothing when the page can't show it or the change does nothing
 */
export function preview(story: unknown, change: (content: Record<string, unknown>) => boolean) {
	const content = shown_content(story)
	if (!content) return
	// a copy: what's there is the page's own, and what Undo shows again
	const next = JSON.parse(JSON.stringify(content))
	if (!change(next)) return
	// the first of several, as a drag shows one for each place it passes
	previewed ??= { story, content }
	show(next)
	return () => {
		previewed = undefined
		// unless something else has been shown since, which is that's to clear
		if (ahead === next) show(null)
	}
}

/** The page's content as it was before a change was shown ahead of its save, for that change's Undo */
let previewed: { story: unknown; content: unknown } | undefined

/** What a step back or forward last showed, so finishing only clears that */
let stepped: unknown

/**
 * Show a block in its new place among its siblings before the move has saved: a step up or down
 * with `by`, or to a place with `to`. The way to show what's saved again, or nothing when the
 * page can't show it or the block wouldn't move
 */
export function preview_move(story: unknown, uid: string, by?: number, to?: number) {
	return preview(story, (content) => {
		const place = locate(content, uid)
		if (!place) return false
		const { list, index } = place
		const next = by !== undefined ? index + by : Number(to)
		if (!(next >= 0 && next < list.length) || next === index) return false
		list.splice(next, 0, ...list.splice(index, 1))
		return true
	})
}

/**
 * Show what a change will do to the page before it's saved, where the page can show it: fields
 * given new values, a block added, copied or taken away. The way to show what's saved again, for
 * once the save has landed or failed; nothing when there's nothing here to show
 */
export function preview_change(change: Record<string, unknown>) {
	const { op, story } = change
	const uid = String(change.uid)
	if (op === "move")
		return preview_move(
			story,
			uid,
			change.by as number | undefined,
			change.to as number | undefined
		)
	return preview(story, (content) => {
		if (op === "fields") {
			const blok = content._uid === uid ? content : find_blok(content, uid)
			if (!blok) return false
			Object.assign(blok, change.values)
			return true
		}
		const place = locate(content, uid)
		if (op === "remove") return !!place && place.list.splice(place.index, 1).length > 0
		if (op === "duplicate") {
			if (!place) return false
			// as the page marks its blocks from this, a copy with it would be taken for the original
			const { _editable, ...copy } = copy_blok(place.list[place.index])
			void _editable
			place.list.splice(place.index + 1, 0, copy)
			return true
		}
		if (op === "insert") {
			// with nothing in it yet, as it is once it's saved
			const blok = { _uid: crypto.randomUUID(), component: String(change.component) }
			if (typeof change.field !== "string")
				return !!place && !!place.list.splice(place.index + 1, 0, blok)
			const parent = (content._uid === uid ? content : find_blok(content, uid)) as
				| Record<string, unknown>
				| undefined
			if (!parent) return false
			const list = Array.isArray(parent[change.field])
				? (parent[change.field] as Array<unknown>)
				: []
			parent[change.field] = [...list, blok]
			return true
		}
		return false
	})
}

/** Where a block is among its siblings, and what each of them is, on a page that can show a move at once */
export function block_place(story: unknown, uid: string) {
	const place = locate(shown_content(story), uid)
	return (
		place && {
			index: place.index,
			list: place.list.map((blok) => ({ uid: String(blok._uid), name: String(blok.component) })),
		}
	)
}

/** Steps back and forward save one after another, in the order they were made */
let saving_steps: Promise<unknown> = Promise.resolve()
let steps_waiting = 0

/** Every step back or forward so far has saved, or failed to */
export const steps_saved = () => saving_steps

/**
 * Take the last change off `from` and make its opposite. The page shows it at once when it's the
 * page's own story, from the content kept with the change, and the save follows; several in a row
 * each show straight away, and the page's data is read again once, after the last has saved
 */
async function retrace(from: Array<Done>, as: "undo" | "redo") {
	const done = from.pop()
	if (!done) return null
	const here = shown_content(done.change.story)
	const instant = here !== undefined && done.before !== undefined
	if (instant) show((stepped = done.before))
	// its way back, in its place at once so the next step can be it: what that is comes with the save
	const to = as === "undo" ? S.redos : S.undos
	const other: Done = { change: { story: done.change.story }, label: done.label, before: here }
	to.push(other)
	changed()
	steps_waiting++
	const saved = saving_steps.then(async () => {
		steps_waiting--
		// the way back of a step that didn't save: there's nothing to send
		const reply = done.change.op ? await send(done.change, as, { again: !steps_waiting }) : null
		const back = reply?.undo as Change | undefined
		if (back) other.change = back
		else if (to.includes(other)) to.splice(to.indexOf(other), 1)
		// one that didn't save: the page goes back to showing what's really there
		if (!reply && instant) await refresh().catch(() => {})
		// unless something else has been shown since, like a block moved meanwhile: that's its to clear
		if (instant && !steps_waiting && ahead === stepped) show(null)
		changed()
		return reply
	})
	saving_steps = saved.catch(() => {})
	return instant || (await saved) ? done.label : null
}

/** Undo the last change made from this page; what it undid, or null with nothing to undo or if it failed */
export const undo = () => retrace(S.undos, "undo")

/** Make the last undone change again */
export const redo = () => retrace(S.redos, "redo")

export const history = {
	get undo() {
		watch()
		return S.undos.at(-1)?.label ?? null
	},
	get redo() {
		watch()
		return S.redos.at(-1)?.label ?? null
	},
	/** What each change was, oldest first: those made, then those undone, the next to redo first */
	get steps() {
		watch()
		return {
			done: S.undos.map((step) => step.label),
			undone: S.redos.map((step) => step.label).reverse(),
		}
	},
}

/**
 * The page's story back as it is live, as a draft: one more change, so Undo brings the draft back.
 * `far` when its live version is further back than the history goes; restore it from Page history
 */
export async function discard(): Promise<"done" | "far" | "failed"> {
	const story = editor.story
	if (!story) return "failed"
	const { versions } = await call<{ versions: Array<{ id: number; status: string }> }>({
		op: "versions",
		story: story.id,
	}).catch(() => ({ versions: [] }))
	const live = versions.find((version) => version.status === "published")
	if (!live) return "far"
	return (await send({ op: "revert", story: story.id, version: live.id })) ? "done" : "failed"
}

/** Whether there's anything Publish would send live: the page's own story, or one edited from it */
export const unpublished = () =>
	(editor.story && (editor.story.status === "draft" || editor.story.status === "changed")) ||
	S.touched.size > 0

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
	const own = editor.story
	if (own) ids.add(own.id)
	for (const id of S.touched) ids.add(id)
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
	for (const id of S.touched) if (!stories.some((s) => s.id === id)) S.touched.delete(id)
	// what's just been found out is what the badge and Publish go by, not what was last worked out
	if (own) note_live(own.id, own.updated_at, stories)
	changed()
	return stories
}

/** Publish these stories, the page's own by default, if the signed-in person's role allows it */
export async function publish(ids?: Array<number>) {
	const stories = ids ?? (editor.story ? [editor.story.id] : [])
	let ok = stories.length > 0
	for (const story of stories) {
		if (await send({ op: "publish", story })) S.touched.delete(story)
		else ok = false
	}
	changed()
	return ok
}

/** Each blok's content by the element `attrs` spread onto, for the overlay to read */
export const bloks = S.bloks

/** A blok in the page's connected story, resolved relations included, by its `_uid` */
export function page_blok(uid: string): Blok | undefined {
	const story = S.connected?.story
	return story ? (find_blok(story.content, uid) as Blok | undefined) : undefined
}

/**
 * The editor app: from where the `editor` hook says, normally moxy, so a change to the editor
 * reaches every site without a release of theirs; this package's own copy when there's nowhere
 * else, when that can't load, or when it was built for another bridge. Loaded once for the page
 */
export function app(): Promise<App> {
	return (S.app ??= (async () => {
		const url = S.injected.app
		if (url)
			try {
				const remote = (await import(/* @vite-ignore */ url)) as App
				if (remote.bridge === BRIDGE) return remote
				console.warn(`storyloco/editor: ${url} was built for another bridge; using this site's own`)
			} catch (e) {
				console.warn(`storyloco/editor: couldn't load ${url}; using this site's own`, e)
			}
		return (await import("./app.svelte.js")) as App
	})())
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
		S.bloks.set(node, blok)
		app().then((editor) => editor.install())
		return () => {
			if (S.bloks.get(node) === blok) S.bloks.delete(node)
		}
	}
}
