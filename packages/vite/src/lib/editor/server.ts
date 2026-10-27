import { redirect, type RequestEvent } from "@sveltejs/kit"
import type { Handle } from "../kit.js"
import { StoryblokClient } from "../storyblok.svelte.js"
import { LIVE, editor_version } from "./version.js"
import {
	allowed,
	copy_blok,
	differences,
	fresh_blok,
	find_blok,
	is_heading,
	is_video,
	locate,
	set_asset,
	set_text,
	trail,
	type Node,
	type Place,
} from "./content.js"

export { allowed }
// the version, for a site that picks its own, without the redirects hook `storyloco/hooks` brings
export { editor_version }

/**
 * In-place editing on the site itself, for people signed in with their own Storyblok account.
 *
 * Sign-in runs through moxy, which holds each person's Storyblok tokens and hands the site an
 * opaque handle for a cookie, so a site needs no secrets and any origin a space allows (a
 * Vercel preview, localhost) can sign in. Saves go straight to Storyblok as that person, so
 * their role in the space applies.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * import { editor } from "storyloco/editor/server"
 *
 * export const handle = sequence(editor, version, ...)
 *
 * // app.d.ts
 * interface Locals { editor?: import("storyloco/editor/server").Editor }
 * ```
 */

const MOXY = "https://moxy.uilo.co"
const PREFIX = "/__storyloco"
const COOKIE = "sl_editor"

/**
 * One cookie per space: every port on localhost shares cookies, so two sites running locally
 * would otherwise each throw out the other's sign-in as one it doesn't recognise
 */
const cookie_for = (space: string | null) => (space ? `${COOKIE}_${space}` : COOKIE)
/** A guest's, one per space like an editor's */
const GUEST = "sl_guest"
const guest_cookie_for = (space: string | null) => (space ? `${GUEST}_${space}` : GUEST)
const VERIFIER = "sl_verifier"

/** Vite's development flag, absent outside a Vite build, like under tests */
const dev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)

const env = (name: string) =>
	(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name]

export interface EditorUser {
	id: number
	name: string | null
	email: string | null
	role: string | null
}

type Session = {
	space_id: string
	mapi: string
	origin: string
	user: EditorUser
	access_token: string
	expires_at: number
}

/** A Storyblok refusal, passed on to the page with its status */
export class EditorError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message)
	}
}

/** A POST to moxy with a handle; moxy's own reason when it refuses */
async function ask_moxy<T>(
	moxy: { url: string; handle?: string },
	path: string,
	body: unknown
): Promise<T> {
	const res = await fetch(`${moxy.url}${path}`, {
		method: "POST",
		headers: {
			...(moxy.handle ? { authorization: `Bearer ${moxy.handle}` } : {}),
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		// moxy's own reason, like "Nobody to ask", is worth showing as it is
		const reason = ((await res.json().catch(() => null)) as { message?: string } | null)?.message
		throw new EditorError(
			res.status < 500 ? res.status : 502,
			reason || `Moxy refused (${res.status})`
		)
	}
	return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

/** Someone a site's draft is shared with, on `event.locals.guest`: they see it, and may comment */
export type Guest = {
	user: { id: string; name: string | null; email: string | null }
	role: "view" | "comment"
	/** false until someone who came by the share's link says who they are */
	named: boolean
	/** who shared it with them */
	by: string | null
}

type GuestActor = {
	space_id: string
	origin: string
	user: Guest["user"]
	guest: { role: Guest["role"]; named: boolean; by: string | null }
}

const guests = new Map<string, { at: number; guest: Guest }>()

/** Who a guest's handle belongs to, kept a minute; signed out when their share or invitation no longer stands */
async function guest_of(moxy: string, handle: string, fresh = false): Promise<Guest> {
	const hit = guests.get(handle)
	if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.guest
	try {
		const who = await ask_moxy<GuestActor>({ url: moxy, handle }, "/apps/editor/guest", {
			op: "who",
		})
		const guest = { user: who.user, ...who.guest }
		guests.set(handle, { at: Date.now(), guest })
		return guest
	} catch (e) {
		guests.delete(handle)
		if (e instanceof EditorError && e.status === 401) throw SIGNED_OUT
		throw e
	}
}

/** The person signed in to edit, on `event.locals.editor` */
export class Editor {
	readonly user: EditorUser
	readonly space: string
	#session: Session
	#refresh: () => Promise<Session>
	#moxy: { url: string; handle: string } | null

	constructor(
		session: Session,
		refresh: () => Promise<Session>,
		moxy: { url: string; handle: string } | null = null
	) {
		this.user = session.user
		this.space = session.space_id
		this.#session = session
		this.#refresh = refresh
		this.#moxy = moxy
	}

	/** Moxy, as this person */
	broker<T>(path: string, body: unknown): Promise<T> {
		if (!this.#moxy) throw new EditorError(503, "Not connected to moxy")
		return ask_moxy<T>(this.#moxy, path, body)
	}

	/**
	 * Run a change to `story` in its turn: two people saving the same story at once would each read it
	 * before the other wrote, and the second save would drop the first. Without moxy it runs anyway.
	 */
	async locked<T>(story: number, change: () => Promise<T>): Promise<T> {
		const held = await this.broker<{ key: string }>("/apps/editor/lock", {
			op: "lock",
			story,
		}).catch((e) => {
			// the save still goes ahead: better saved without its turn than not saved
			console.warn("storyloco/editor: saving without the story's lock", e)
			return null
		})
		try {
			return await change()
		} finally {
			// awaited: a serverless function can stop once it has answered, and the next save would wait out the lease
			if (held)
				await this.broker("/apps/editor/lock", { op: "unlock", story, key: held.key }).catch(
					() => {}
				)
		}
	}

	/** The Content Delivery API in the space's region: the Management API's host, or `api.` for `mapi.` */
	get cdn() {
		return this.#session.mapi.replace("//mapi.", "//api.")
	}

	/** A Management API call as this person, under `/v1/spaces/{space}` */
	async mapi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
		if (this.#session.expires_at < Date.now() + 30_000) this.#session = await this.#refresh()
		const res = await fetch(`${this.#session.mapi}/v1/spaces/${this.space}${path}`, {
			method: init.method,
			headers: {
				authorization: `Bearer ${this.#session.access_token}`,
				"content-type": "application/json",
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		})
		if (res.status === 403)
			throw new EditorError(403, "Your role in Storyblok doesn’t allow this change")
		if (!res.ok)
			throw new EditorError(
				res.status === 404 || res.status === 422 ? res.status : 502,
				`Storyblok refused the change (${res.status})`
			)
		return res.json() as Promise<T>
	}

	/**
	 * Read the story fresh, change its content and save it as a draft. Only what `change`
	 * touches differs, so saves made in Storyblok since the page loaded survive.
	 */
	/** Change the story's draft; false, and nothing saved, when the change left it as it was */
	async patch(story: number, change: (content: Node) => void) {
		const { story: current } = await this.mapi<{ story: { content: Node } }>(`/stories/${story}`)
		const was = JSON.stringify(current.content)
		change(current.content)
		// a save of the same content would still make a version, and an Undo that does nothing
		if (JSON.stringify(current.content) === was) return false
		await this.mapi(`/stories/${story}`, { method: "PUT", body: { story: current } })
		return true
	}
}

// --- sessions

const SIGNED_OUT = Symbol("signed out")
const cache = new Map<string, { at: number; session: Session }>()

async function lookup(moxy: string, handle: string, fresh = false): Promise<Session> {
	const hit = cache.get(handle)
	if (!fresh && hit && Date.now() - hit.at < 60_000 && hit.session.expires_at > Date.now() + 30_000)
		return hit.session

	const res = await fetch(`${moxy}/apps/editor/session`, {
		headers: { authorization: `Bearer ${handle}` },
	})
	if (res.status === 401) {
		cache.delete(handle)
		throw SIGNED_OUT
	}
	if (!res.ok) throw new Error(`moxy session lookup failed (${res.status})`)
	const session = (await res.json()) as Session
	cache.set(handle, { at: Date.now(), session })
	return session
}

// --- the site's own space

let own: Promise<string> | undefined

/** A setting from SvelteKit's env, where the site's .env lives; process.env alone misses it in development */
async function setting(name: string) {
	type Env = { env: Record<string, string | undefined> }
	const [secret, open] = await Promise.all([
		import("$env/dynamic/private").catch(() => null) as Promise<Env | null>,
		import("$env/dynamic/public").catch(() => null) as Promise<Env | null>,
	])
	return secret?.env[name] || open?.env[name] || env(name)
}

/** The token the site reads content with; the environment's first, since a client reading through a proxy carries a stand-in */
async function site_token() {
	return (
		(await setting("PUBLIC_STORYBLOK_ACCESS_TOKEN")) ||
		(await setting("STORYBLOK_ACCESS_TOKEN")) ||
		(await setting("PUBLIC_STORYBLOK_TOKEN")) ||
		StoryblokClient.current?.token
	)
}

/** `STORYBLOK_SPACE_ID`, or else the space the site's public token reads from */
function own_space(configured?: string) {
	if (configured) return Promise.resolve(configured)
	return (own ??= (async () => {
		const id = await setting("STORYBLOK_SPACE_ID")
		if (id) return id
		const token = await site_token()
		if (!token)
			throw new Error(
				"storyloco/editor: set STORYBLOK_SPACE_ID, or PUBLIC_STORYBLOK_ACCESS_TOKEN, or create a StoryblokClient"
			)
		for (const host of ["api", "api-us", "api-ca", "api-ap"]) {
			const res = await fetch(`https://${host}.storyblok.com/v2/cdn/spaces/me?token=${token}`)
			if (res.ok) return String(((await res.json()) as { space: { id: number } }).space.id)
		}
		throw new Error("storyloco/editor: couldn't find the space for the site's Storyblok token")
	})().catch((e) => {
		own = undefined
		throw e
	}))
}

// --- routes under /__storyloco

/** Shows a comment's notification, and opens its page on a click, on a tab already open there if there is one */
const SERVICE_WORKER = `self.addEventListener("push", (event) => {
	const note = event.data ? event.data.json() : {}
	event.waitUntil(self.registration.showNotification(note.title || "New comment", {
		body: note.body, icon: note.icon, tag: note.data && note.data.comment, data: { url: note.url }
	}))
})
self.addEventListener("notificationclick", (event) => {
	event.notification.close()
	const url = event.notification.data && event.notification.data.url
	// the site's pages are outside this worker's scope, so it can't find or steer an open tab: a new one
	if (url) event.waitUntil(self.clients.openWindow(url))
})`

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

/** Paths on this site only, so neither sign-in nor sign-out can send anyone elsewhere */
const local = (path: string | null | undefined) =>
	path?.startsWith("/") && !path.startsWith("//") ? path : "/"

const cookie = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const

/** SvelteKit 3 only redirects to another origin when told it's meant to; SvelteKit 2 ignores the option */
const to_moxy = redirect as (status: 303, location: URL, options: { external: true }) => never

async function route(
	event: RequestEvent,
	moxy: string,
	space: string | undefined,
	name: string
): Promise<Response> {
	const { url, cookies, request } = event
	const path = url.pathname.slice(PREFIX.length)

	// a shared draft's link, and an invitation's: moxy swaps either for a guest's handle, kept in a cookie
	const shared = path.match(/^\/(share|guest)\/([\w-]{20,64})$/)
	if (shared && request.method === "GET") {
		const known = await own_space(space).catch(() => null)
		const reply = await ask_moxy<{ handle: string }>({ url: moxy }, "/apps/editor/guest", {
			op: shared[1] === "share" ? "open" : "redeem",
			token: shared[2],
			origin: url.origin,
		}).catch(() => null)
		if (!reply)
			return new Response(
				`<!doctype html><meta name="viewport" content="width=device-width"><title>Link expired</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#1b243f"><h1 style="font-size:1.375rem">This link doesn’t work any more</h1><p>It may have expired, been used already, or had sharing turned off. Ask whoever sent it for a new one.</p></body>`,
				{
					status: 404,
					headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
				}
			)
		cookies.set(guest_cookie_for(known), reply.handle, { ...cookie, maxAge: 60 * 60 * 24 * 30 })
		redirect(303, local(url.searchParams.get("to")))
	}

	if (path === "/signin") {
		const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
		const challenge = b64url(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
		)
		cookies.set(VERIFIER, verifier, { ...cookie, path: PREFIX, maxAge: 600 })
		const start = new URL(`${moxy}/apps/editor/start`)
		start.search = new URLSearchParams({
			space: await own_space(space),
			origin: url.origin,
			return: local(url.searchParams.get("return")),
			challenge,
		}).toString()
		to_moxy(303, start, { external: true })
	}

	if (path === "/callback") {
		const verifier = cookies.get(VERIFIER)
		cookies.delete(VERIFIER, { path: PREFIX })
		const res = await fetch(`${moxy}/apps/editor/exchange`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: url.searchParams.get("code"), verifier }),
		})
		if (!res.ok)
			return new Response("Sign-in expired. Go back and click Edit again.", { status: 400 })
		const { handle, return_to } = (await res.json()) as { handle: string; return_to: string }
		// named by the space signed in to, which `signin` has just found, whatever this request knew
		const signed_in = cookie_for(await own_space(space).catch(() => null))
		cookies.set(signed_in, handle, { ...cookie, maxAge: 60 * 60 * 24 * 30 })
		redirect(303, local(return_to))
	}

	// the service worker that shows comment notifications; push only reaches a worker on the site's own origin
	if (path === "/sw.js")
		return new Response(SERVICE_WORKER, {
			headers: { "content-type": "text/javascript", "cache-control": "no-cache" },
		})

	// `signout()` posts here, so another site can't sign anyone out with a link
	if (path === "/signout" && request.method === "POST") {
		const handle = cookies.get(name)
		if (handle) {
			cache.delete(handle)
			await fetch(`${moxy}/apps/editor/session`, {
				method: "DELETE",
				headers: { authorization: `Bearer ${handle}` },
			}).catch(() => {})
		}
		// a response returned from a hook doesn't carry `cookies` changes, so the expiry goes on by hand
		const expired = cookies.serialize(name, "", { ...cookie, maxAge: 0 })
		return new Response(null, { status: 204, headers: { "set-cookie": expired } })
	}

	if (path === "/api" && request.method === "POST") {
		const editor = (event.locals as { editor?: Editor }).editor
		const guest_name = guest_cookie_for(await own_space(space).catch(() => null))
		const guest_handle =
			!editor && (event.locals as { guest?: Guest }).guest && cookies.get(guest_name)
		if (guest_handle) {
			try {
				const body = await request.json()
				if (body?.op === "guest_leave") {
					await ask_moxy({ url: moxy, handle: guest_handle }, "/apps/editor/guest", { op: "leave" })
					guests.delete(guest_handle)
					const expired = cookies.serialize(guest_name, "", { ...cookie, maxAge: 0 })
					return new Response(null, { status: 204, headers: { "set-cookie": expired } })
				}
				return Response.json(
					await as_guest(body, { moxy, handle: guest_handle, origin: url.origin })
				)
			} catch (e) {
				if (e instanceof EditorError)
					return Response.json({ message: e.message }, { status: e.status })
				throw e
			}
		}
		if (!editor) return Response.json({ message: "Sign in to edit" }, { status: 401 })
		try {
			const body = await request.json()
			const run = () => operate(editor, body, { moxy, origin: url.origin })
			return Response.json(
				CHANGES.has(body?.op) && id(body.story) ? await editor.locked(body.story, run) : await run()
			)
		} catch (e) {
			if (e instanceof EditorError)
				return Response.json({ message: e.message }, { status: e.status })
			throw e
		}
	}

	return new Response("Not found", { status: 404 })
}

/** The operations that read a story, change it and save it back, which take turns per story */
const CHANGES = new Set([
	"set",
	"image",
	"move",
	"remove",
	"duplicate",
	"insert",
	"fields",
	"name",
	"restore",
	"mux_set",
	"revert",
])

type Operation =
	| { op: "set"; story: number; uid: string; field: string; value: string }
	| {
			op: "image"
			story: number
			uid: string
			field: string
			index?: number
			asset: number
			alt: string
			focus: string
	  }
	| { op: "publish"; story: number }
	| { op: "assets"; search?: string; page?: number }
	| { op: "upload"; filename: string; size?: string }
	| { op: "uploaded"; asset: number }
	| { op: "blocks"; story: number; uid: string; field?: string }
	| { op: "move"; story: number; uid: string; by?: number; to?: number }
	| { op: "remove"; story: number; uid: string }
	| { op: "duplicate"; story: number; uid: string }
	| { op: "insert"; story: number; uid: string; component: string; field?: string }
	| { op: "schema" }
	| { op: "blok"; story: number; uid: string }
	| { op: "fields"; story: number; uid: string; values: Record<string, unknown> }
	| { op: "name"; story: number; value: string }
	| { op: "restore"; story: number; parent: string; field: string; index: number; blok: Node }
	| { op: "choices"; component: string; field: string }
	| {
			op: "stories"
			search?: string
			/** an option field's own folder and content types, and the page of them */
			component?: string
			field?: string
			page?: number
			/** these stories, in this order, for the ones a field already holds */
			uuids?: Array<string>
	  }
	| { op: "linked"; path: string }
	| { op: "story"; story: number }
	| { op: "changes"; stories: Array<number> }
	| { op: "live" }
	| { op: "versions"; story: number }
	| { op: "revert"; story: number; version: number }
	| ({ op: "comments"; do: string } & Record<string, unknown>)
	| ({ op: "ai"; do: string } & Record<string, unknown>)
	| ({ op: "share"; do: string } & Record<string, unknown>)
	| { op: "new_page" }
	| { op: "create_page"; name: string; slug: string; parent: number; component: string }
	| { op: "content"; story: number }
	| { op: "mux_upload"; component: string; field: string; title?: string }
	| { op: "mux_status"; component: string; field: string; upload: string }
	| { op: "mux_assets"; component: string; field: string }
	| { op: "mux_set"; story: number; uid: string; field: string; asset: string }

/** An asset as the page sees it, from the Management API's own shape */
export interface Asset {
	id: number
	filename: string
	alt: string
	title: string
	copyright: string
	focus: string
	content_type: string | null
}

type ManagedAsset = {
	id: number
	filename: string
	alt?: string | null
	title?: string | null
	copyright?: string | null
	focus?: string | null
	content_type?: string | null
	meta_data?: { alt?: string; title?: string; copyright?: string } | null
}

const asset_of = (a: ManagedAsset): Asset => ({
	id: a.id,
	// the Management API names the bucket; the content delivery URL is what fields hold
	filename: a.filename.replace(/^https:\/\/s3\.amazonaws\.com\//, "https://"),
	alt: a.meta_data?.alt ?? a.alt ?? "",
	title: a.meta_data?.title ?? a.title ?? "",
	copyright: a.meta_data?.copyright ?? a.copyright ?? "",
	focus: a.focus ?? "",
	content_type: a.content_type ?? null,
})

const text = (value: unknown, max: number): value is string =>
	typeof value === "string" && value.length <= max
const field_name = (value: unknown): value is string =>
	typeof value === "string" && /^[a-z0-9_]+$/.test(value)
const id = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0

// --- block schemas, for what a list may hold

type Field = {
	type: string
	display_name?: string | null
	description?: string | null
	pos?: number
	field_type?: string
	options?: Array<{ name: string; value: string }> | null
	source?: string | null
	datasource_slug?: string | null
	folder_slug?: string | null
	filter_content_type?: Array<string> | null
	filetypes?: Array<string> | null
	max_length?: number | string | null
	required?: boolean
	keys?: Array<string> | null
	restrict_components?: boolean
	restrict_type?: string | null
	component_whitelist?: Array<string> | null
	component_group_whitelist?: Array<string> | null
	component_tag_whitelist?: Array<string | number> | null
	maximum?: number | string | null
	default_value?: unknown
}

type Component = {
	name: string
	display_name: string | null
	is_nestable: boolean
	is_root?: boolean
	component_group_uuid: string | null
	internal_tag_ids?: Array<string | number> | null
	schema: Record<string, Field>
}

const schemas = new Map<string, { at: number; components: Promise<Array<Component>> }>()

/** The space's components, kept for a few minutes since they change far less often than content */
function components_of(editor: Editor) {
	const hit = schemas.get(editor.space)
	if (hit && Date.now() - hit.at < 300_000) return hit.components
	const components = editor
		.mapi<{ components: Array<Component> }>("/components/")
		.then(({ components }) => components)
	components.catch(() => schemas.delete(editor.space))
	schemas.set(editor.space, { at: Date.now(), components })
	return components
}

/** The list's field schema, and how many bloks it may hold */
async function rules(editor: Editor, place: Place) {
	const components = await components_of(editor)
	const parent = components.find((c) => c.name === place.parent.component)
	const field = parent?.schema[place.field]
	const maximum = Number(field?.maximum) || Infinity
	return { components, choices: allowed(components, field), full: place.list.length >= maximum }
}

/** Where the blok is in the story, or why it can't be changed there */
function place_of(content: Node, uid: string) {
	const place = locate(content, uid)
	if (!place) throw new EditorError(404, "That block isn’t in the story any more")
	return place
}

/**
 * With a `field`, the end of that bloks field on the blok with `uid`, so an empty list can be
 * added to; otherwise where the blok with `uid` itself sits
 */
function place_for(content: Node, uid: string, field?: unknown): Place {
	if (field === undefined) return place_of(content, uid)
	const parent = find_blok(content, uid)
	if (!parent || !field_name(field))
		throw new EditorError(404, "That block isn’t in the story any more")
	if (parent[field] === undefined || parent[field] === "") parent[field] = []
	const list = parent[field]
	if (!Array.isArray(list)) throw new EditorError(400, `${field} isn’t a list of blocks`)
	return { parent, field, list: list as Array<Node>, index: list.length - 1 }
}

type StoryVersion = {
	id: number
	created_at: string
	status: string
	/** who saved it, by name */
	user?: string | null
	content?: Node
}

/** One saved version's content, from the story's versions a page at a time */
async function version_content(editor: Editor, story: number, version: number) {
	for (let page = 1; page <= 20; page++) {
		const { story_versions } = await editor.mapi<{ story_versions: Array<StoryVersion> }>(
			`/story_versions?${new URLSearchParams({
				by_story_id: String(story),
				show_content: "true",
				per_page: "25",
				page: String(page),
			})}`
		)
		const found = story_versions.find((v) => v.id === version)
		if (found?.content) return found.content
		if (story_versions.length < 25) break
	}
	throw new EditorError(404, "That version isn’t there any more")
}

/** The page's own story content, read fresh, for questions rather than changes */
async function content_of(editor: Editor, story: number) {
	const { story: current } = await editor.mapi<{ story: { content: Node } }>(`/stories/${story}`)
	return current.content
}

// --- fields, as the inspector edits them

/** What the page may see of the schema: plugin options hold moxy secrets, so they stay here */
function public_schema(components: Array<Component>) {
	return components.map(
		({ name, display_name, is_nestable, component_group_uuid, internal_tag_ids, schema }) => ({
			name,
			display_name: display_name || null,
			is_nestable,
			// what a field's restrictions go by, so the page can offer only the bloks it allows
			component_group_uuid,
			internal_tag_ids,
			schema: Object.fromEntries(
				Object.entries(schema).map(([key, field]) => [
					key,
					field.type === "custom" ? { ...field, options: undefined } : field,
				])
			),
		})
	)
}

/** Plugin fields the inspector understands; others stay as Storyblok's own editor left them */
const PLUGINS = (field: { field_type?: string | null }) =>
	is_heading(field) || field.field_type === "uiloco-seo"

const LINKS = new Set(["url", "story", "email", "asset"])

type Resolve = (id: number) => Promise<Asset>

/**
 * A value as the field's type stores it, checked and tidied, or an `EditorError` saying why
 * not. Assets come from Storyblok by id, never from the page, like `image`.
 */
export async function normalise(
	field: Field,
	value: unknown,
	existing: unknown,
	resolve: Resolve
): Promise<unknown> {
	const bad = (why = "isn’t a value this field can hold") => {
		throw new EditorError(400, `${field.display_name || "That field"} ${why}`)
	}
	const longest = Number(field.max_length) || 20_000
	const object = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v)

	switch (field.type) {
		case "text":
		case "textarea":
		case "markdown":
			if (typeof value !== "string") bad()
			if ((value as string).length > longest) bad(`is limited to ${longest} characters`)
			return value
		case "number":
			if (value === "" || value === null) return ""
			if (
				(typeof value !== "string" && typeof value !== "number") ||
				!Number.isFinite(Number(value))
			)
				bad("needs a number")
			return typeof existing === "number" ? Number(value) : String(value)
		case "boolean":
			if (typeof value !== "boolean") bad()
			return value
		case "datetime":
			if (value === "" || value === null) return ""
			if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(value))
				bad("needs a date")
			return value
		case "option":
			if (value !== "" && (typeof value !== "string" || value.length > 500)) bad()
			return value
		case "options":
			if (!Array.isArray(value) || value.length > 200 || value.some((v) => typeof v !== "string"))
				bad()
			return value
		case "asset": {
			if (value === null)
				return {
					...(object(existing) ? existing : {}),
					id: null,
					filename: "",
					alt: "",
					focus: "",
					fieldtype: "asset",
				}
			if (!object(value) || !Number.isInteger(value.id)) bad()
			const { id, alt, focus } = value as { id: number; alt?: unknown; focus?: unknown }
			const chosen = await resolve(id)
			return {
				...(object(existing) ? existing : {}),
				fieldtype: "asset",
				id: chosen.id,
				filename: chosen.filename,
				alt: typeof alt === "string" ? alt.slice(0, 1000) : chosen.alt,
				focus: typeof focus === "string" && /^(\d+x\d+:\d+x\d+)?$/.test(focus) ? focus : "",
				title: chosen.title,
				copyright: chosen.copyright,
				name: "",
			}
		}
		case "multiasset": {
			if (!Array.isArray(value) || value.length > 100) bad()
			const before = Array.isArray(existing) ? (existing as Array<Node>) : []
			return Promise.all(
				(value as Array<unknown>).map((item) =>
					normalise(
						{ ...field, type: "asset" },
						item,
						before.find((b) => object(item) && b.id === item.id),
						resolve
					)
				)
			)
		}
		case "multilink": {
			if (!object(value) || !LINKS.has(String(value.linktype))) bad()
			const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 2000) : "")
			const link = value as Node
			return {
				...(object(existing) ? existing : {}),
				fieldtype: "multilink",
				linktype: link.linktype,
				id: text(link.id),
				url: text(link.url),
				cached_url: text(link.cached_url) || text(link.url),
				email: link.linktype === "email" ? text(link.email) : undefined,
				anchor: text(link.anchor) || undefined,
				target: link.target === "_blank" ? "_blank" : undefined,
			}
		}
		case "richtext":
			if (!object(value) || value.type !== "doc" || JSON.stringify(value).length > 500_000) bad()
			return value
		case "table": {
			const { thead, tbody } = (object(value) ? value : {}) as { thead?: unknown; tbody?: unknown }
			if (
				!Array.isArray(thead) ||
				!Array.isArray(tbody) ||
				thead.length > 50 ||
				tbody.length > 1000
			)
				bad()
			const uid = (v: unknown) =>
				object(v) && typeof v._uid === "string" && v._uid.length <= 64
					? v._uid
					: crypto.randomUUID()
			const cell = (v: unknown, component: string) => {
				const text = object(v) ? v.value : undefined
				if (text !== undefined && (typeof text !== "string" || text.length > longest)) bad()
				return { _uid: uid(v), value: text ?? "", component }
			}
			const columns = (thead as Array<unknown>).length
			return {
				fieldtype: "table",
				thead: (thead as Array<unknown>).map((c) => cell(c, "_table_head")),
				tbody: (tbody as Array<unknown>).map((row) => {
					const body = object(row) && Array.isArray(row.body) ? (row.body as Array<unknown>) : []
					if (body.length !== columns) bad("needs every row to have a cell for each column")
					return {
						_uid: uid(row),
						component: "_table_row",
						body: body.map((c) => cell(c, "_table_col")),
					}
				}),
			}
		}
		case "custom":
			if (is_video(field)) {
				if (value === null) return null
				if (!object(value) || !object(existing)) bad()
				// a video's own settings; which video it is changes through `mux_set`
				const settings = Object.fromEntries(
					Object.entries(value as Node).filter(
						([key, v]) =>
							["autoplay", "muted", "loop", "controls", "playsinline"].includes(key) &&
							typeof v === "boolean"
					)
				)
				return { ...(existing as Node), ...settings }
			}
			if (!PLUGINS(field) || !object(value)) bad("is edited in Storyblok")
			for (const v of Object.values(value as Node))
				if (v !== null && typeof v !== "string" && typeof v !== "number") bad()
			return { ...(object(existing) ? existing : {}), ...(value as Node) }
	}
	bad("is edited in Storyblok")
}

/**
 * A field's stored value in the shape `fields` takes, so undoing puts it back through the same
 * checks as any other change rather than writing whatever the page sends
 */
export function input_of(field: Field | undefined, stored: unknown): unknown {
	const object = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v)
	const asset = (v: unknown) =>
		object(v) && Number.isInteger(v.id)
			? { id: v.id, alt: v.alt ?? "", focus: v.focus ?? "" }
			: null
	switch (field?.type) {
		case "asset":
			return asset(stored)
		case "multiasset":
			return Array.isArray(stored) ? stored.map(asset).filter(Boolean) : []
		case "boolean":
			return stored === true
		case "options":
			return Array.isArray(stored) ? stored : []
		case "multilink":
			return object(stored) ? stored : { linktype: "url", url: "" }
		case "richtext":
			return object(stored) ? stored : { type: "doc", content: [] }
		case "table":
			return object(stored) ? stored : { fieldtype: "table", thead: [], tbody: [] }
		case "custom":
			return object(stored) ? stored : is_video(field) ? null : {}
		default:
			return stored ?? ""
	}
}

/** The stories a field picks from: its folder, and its content types */
function story_filter(field: Field) {
	const query = new URLSearchParams({ story_only: "1" })
	if (field.folder_slug) query.set("starts_with", field.folder_slug)
	if (field.filter_content_type?.length)
		query.set("filter_query[component][in]", field.filter_content_type.join(","))
	return query
}

/** An option field, by its block and name; only these, since a plugin's options are its secrets */
async function option_field(editor: Editor, component: unknown, field: unknown) {
	const schema = (await components_of(editor)).find((c) => c.name === component)?.schema
	const found = typeof field === "string" ? schema?.[field] : undefined
	if (!found || (found.type !== "option" && found.type !== "options"))
		throw new EditorError(404, "That field isn’t an option field")
	return found
}

/** A datasource's or folder's entries, for option fields that take theirs */
async function choices_for(editor: Editor, field: Field) {
	if (field.source === "internal" && field.datasource_slug) {
		const { datasource_entries } = await editor.mapi<{
			datasource_entries: Array<{ name: string; value: string }>
		}>(
			`/datasource_entries/?datasource_slug=${encodeURIComponent(field.datasource_slug)}&per_page=1000`
		)
		return datasource_entries.map(({ name, value }) => ({ name, value }))
	}
	if (field.source === "internal_stories") {
		const query = story_filter(field)
		query.set("per_page", "100")
		query.set("sort_by", "name:asc")
		const { stories } = await editor.mapi<{ stories: Array<{ uuid: string; name: string }> }>(
			`/stories/?${query}`
		)
		return stories.map(({ uuid, name }) => ({ name, value: uuid }))
	}
	return (field.options ?? []).map(({ name, value }) => ({ name, value }))
}

const STORY_PAGE = 25

type Summary = {
	id: number
	uuid: string
	name: string
	full_slug: string
	published_at: string | null
}
const summary = ({ id, uuid, name, full_slug, published_at }: Summary): Summary => ({
	id,
	uuid,
	name,
	full_slug,
	published_at,
})

// --- Mux video, through moxy

/**
 * The moxy secret a Mux field was set up with. Moxy writes it into the field's options when a
 * space connects Mux, so its presence is what says video can be uploaded here; it never leaves
 * the server.
 */
async function mux_secret(editor: Editor, component: unknown, field: unknown) {
	if (typeof component !== "string" || typeof field !== "string")
		throw new EditorError(400, "Unknown change")
	const schema = (await components_of(editor)).find((c) => c.name === component)?.schema[field]
	if (schema?.type !== "custom" || !is_video(schema))
		throw new EditorError(400, "That isn’t a video field")
	const secret = schema.options?.find((option) => option.name === "MOXY_MUX_SECRET_ID")?.value
	if (!secret)
		throw new EditorError(
			409,
			"Mux isn’t connected for this space yet. Connect it from the Mux app in Storyblok."
		)
	return secret
}

type MuxAsset = {
	id: string
	status?: string
	duration?: number
	aspect_ratio?: string
	created_at?: string
	playback_ids?: Array<{ id: string; policy: string }>
	meta?: { title?: string }
}

async function mux(
	moxy: string,
	secret: string,
	path: string,
	init: { method?: string; body?: unknown } = {}
) {
	const res = await fetch(`${moxy}/api/mux/${path}`, {
		method: init.method,
		headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	})
	if (!res.ok) {
		const reason = (
			(await res.json().catch(() => null)) as { error?: { messages?: Array<string> } } | null
		)?.error?.messages?.[0]
		throw new EditorError(502, reason ? `Mux: ${reason}` : `Mux didn’t take that (${res.status})`)
	}
	return ((await res.json()) as { data: unknown }).data
}

const mux_id = (value: unknown): value is string =>
	typeof value === "string" && /^\w{1,100}$/.test(value)

const playback_of = (asset: MuxAsset) =>
	(asset.playback_ids?.find((p) => p.policy === "public") ?? asset.playback_ids?.[0])?.id

/** The field's value for a Mux asset, as the Mux field plugin writes it, keeping its own settings */
export function video_of(asset: MuxAsset, existing: unknown) {
	const before =
		existing && typeof existing === "object" ? (existing as Record<string, unknown>) : {}
	const playback = playback_of(asset)
	const poster =
		typeof before.poster === "string" && !before.poster.includes("image.mux.com")
			? before.poster
			: undefined
	return {
		...before,
		playback_id: playback,
		title: asset.meta?.title ?? before.title ?? "",
		m3u8_url: playback ? `https://stream.mux.com/${playback}.m3u8` : undefined,
		poster: poster ?? (playback ? `https://image.mux.com/${playback}/thumbnail.jpg` : undefined),
		mux_video: asset,
	}
}

const summary_of = (asset: MuxAsset) => ({
	id: asset.id,
	status: asset.status,
	duration: asset.duration,
	title: asset.meta?.title ?? "",
	playback_id: playback_of(asset),
	created_at: asset.created_at,
})

/** The changes the page can make; story changes read the story fresh and save a draft */
/** What a guest's page may ask for: the comments, the multiplayer room, and saying who they are */
async function as_guest(
	body: Record<string, unknown>,
	{ moxy, handle, origin }: { moxy: string; handle: string; origin: string }
) {
	const ask = <T>(path: string, payload: unknown) =>
		ask_moxy<T>({ url: moxy, handle }, path, payload)
	switch (body?.op) {
		case "comments": {
			const { op: _, do: action, ...rest } = body
			if (
				!["list", "add", "remove", "move", "people"].includes(String(action)) ||
				JSON.stringify(rest).length > 20_000
			)
				throw new EditorError(403, "That’s for the editors")
			return ask("/apps/editor/comments", { ...rest, op: action, site: origin })
		}
		case "live":
			return ask("/apps/editor/live", { origin })
		case "guest_code":
			return ask("/apps/editor/guest", { op: "code", email: body.email, name: body.name })
		case "guest_verify": {
			const who = await ask<GuestActor>("/apps/editor/guest", { op: "verify", code: body.code })
			const guest = { user: who.user, ...who.guest }
			guests.set(handle, { at: Date.now(), guest })
			return {
				guest: { name: guest.user.name, role: guest.role, named: guest.named, by: guest.by },
			}
		}
		default:
			throw new EditorError(403, "That’s for the editors")
	}
}

async function operate(
	editor: Editor,
	body: Partial<Operation> & { story?: unknown },
	site: { moxy: string; origin: string }
) {
	if (body.op === "assets") {
		const query = new URLSearchParams({
			per_page: "48",
			page: String(id(body.page) ? body.page : 1),
			sort_by: "created_at:desc",
		})
		if (text(body.search, 200) && body.search) query.set("search", body.search)
		const { assets } = await editor.mapi<{ assets: Array<ManagedAsset> }>(`/assets/?${query}`)
		return { assets: assets.map(asset_of) }
	}

	if (body.op === "upload") {
		if (!text(body.filename, 200) || !body.filename || (body.size && !/^\d+x\d+$/.test(body.size)))
			throw new EditorError(400, "Unknown change")
		const signed = await editor.mapi<{
			id: number
			post_url: string
			fields: Record<string, string>
		}>("/assets/", {
			method: "POST",
			body: { filename: body.filename, size: body.size, validate_upload: 1 },
		})
		return { asset: signed.id, post_url: signed.post_url, fields: signed.fields }
	}

	if (body.op === "uploaded") {
		if (!id(body.asset)) throw new EditorError(400, "Unknown change")
		await editor.mapi(`/assets/${body.asset}/finish_upload`)
		const asset = await editor.mapi<ManagedAsset>(`/assets/${body.asset}`)
		return { asset: asset_of(asset) }
	}

	if (body.op === "schema") return { components: public_schema(await components_of(editor)) }

	if (body.op === "choices")
		return {
			choices: await choices_for(editor, await option_field(editor, body.component, body.field)),
		}

	if (body.op === "stories") {
		if (Array.isArray(body.uuids)) {
			const uuids = body.uuids.filter((u) => typeof u === "string" && /^[\w-]{1,64}$/.test(u))
			if (!uuids.length) return { stories: [] }
			const query = new URLSearchParams({
				by_uuids_ordered: uuids.slice(0, 100).join(","),
				per_page: "100",
			})
			const { stories } = await editor.mapi<{ stories: Array<Summary> }>(`/stories/?${query}`)
			return { stories: stories.map(summary) }
		}
		const field =
			body.component || body.field ? await option_field(editor, body.component, body.field) : null
		const query = field ? story_filter(field) : new URLSearchParams({ story_only: "1" })
		query.set("per_page", String(STORY_PAGE))
		query.set("sort_by", field ? "name:asc" : "updated_at:desc")
		const page = Number(body.page)
		if (Number.isInteger(page) && page > 1 && page < 1000) query.set("page", String(page))
		if (text(body.search, 200) && body.search.trim())
			query.set(field ? "search" : "text_search", body.search.trim())
		const { stories } = await editor.mapi<{ stories: Array<Summary> }>(`/stories/?${query}`)
		// a full page says there may be more, without asking Storyblok to count them
		return { stories: stories.map(summary), more: stories.length === STORY_PAGE }
	}

	if (body.op === "linked") {
		// a page links to other stories, like cards listing the latest articles; these are theirs
		const path = typeof body.path === "string" ? body.path.replace(/^\/+|\/+$/g, "") : ""
		if (!path || path.length > 500) throw new EditorError(400, "Unknown change")
		const { stories } = await editor.mapi<{ stories: Array<Summary> }>(
			`/stories/?${new URLSearchParams({ with_slug: path, story_only: "1" })}`
		)
		if (!stories[0]) return { story: null }
		const { story } = await editor.mapi<{ story: Summary & { content: Node } }>(
			`/stories/${stories[0].id}`
		)
		return { story: { ...summary(story), content: story.content } }
	}

	if (body.op === "mux_upload") {
		const secret = await mux_secret(editor, body.component, body.field)
		const title = text(body.title, 200) ? body.title : ""
		const upload = (await mux(site.moxy, secret, "video/v1/uploads", {
			method: "POST",
			body: {
				cors_origin: site.origin,
				new_asset_settings: {
					playback_policy: ["public"],
					encoding_tier: "baseline",
					meta: { title },
				},
			},
		})) as { id: string; url: string }
		return { upload: upload.id, url: upload.url }
	}

	if (body.op === "mux_status") {
		const secret = await mux_secret(editor, body.component, body.field)
		if (!mux_id(body.upload)) throw new EditorError(400, "Unknown change")
		const upload = (await mux(site.moxy, secret, `video/v1/uploads/${body.upload}`)) as {
			status: string
			asset_id?: string
		}
		if (!upload.asset_id) return { status: upload.status }
		const asset = (await mux(site.moxy, secret, `video/v1/assets/${upload.asset_id}`)) as MuxAsset
		return { status: upload.status, asset: summary_of(asset) }
	}

	if (body.op === "mux_assets") {
		const secret = await mux_secret(editor, body.component, body.field)
		const assets = (await mux(site.moxy, secret, "video/v1/assets?limit=50")) as Array<MuxAsset>
		return { assets: assets.map(summary_of) }
	}

	if (body.op === "comments") {
		// comments live in moxy, for the whole space; this passes them on as this person
		const { op: _, do: action, ...rest } = body as Record<string, unknown>
		if (typeof action !== "string" || JSON.stringify(rest).length > 20_000)
			throw new EditorError(400, "Unknown change")
		return editor.broker("/apps/editor/comments", { ...rest, op: action, site: site.origin })
	}

	if (body.op === "ai") {
		// alt text and rewrites, on moxy's Workers AI
		const { op: _, do: action, ...rest } = body as Record<string, unknown>
		if ((action !== "alt" && action !== "rewrite") || JSON.stringify(rest).length > 10_000)
			throw new EditorError(400, "Unknown change")
		return editor.broker("/apps/editor/ai", { ...rest, op: action, site: site.origin })
	}

	if (body.op === "new_page") {
		// where a new page can go, and what it can be
		type Folder = { id: number; name: string; full_slug: string }
		const all_folders = async () => {
			const folders: Array<Folder> = []
			for (let page = 1; page <= 10; page++) {
				const { stories } = await editor.mapi<{ stories: Array<Folder> }>(
					`/stories/?folder_only=1&per_page=100&page=${page}`
				)
				folders.push(...stories)
				if (stories.length < 100) break
			}
			return folders
		}
		const [folders, components] = await Promise.all([all_folders(), components_of(editor)])
		return {
			// Storyblok won't sort folders by slug itself
			folders: folders
				.map(({ id, name, full_slug }) => ({ id, name, full_slug }))
				.sort((a, b) => a.full_slug.localeCompare(b.full_slug)),
			components: components
				.filter((c) => c.is_root)
				.map(({ name, display_name }) => ({ name, display_name: display_name || name })),
		}
	}

	if (body.op === "create_page") {
		const { name, slug, parent, component } = body
		if (!text(name, 200) || !name.trim() || !text(slug, 200) || !/^[a-z0-9][a-z0-9-]*$/.test(slug))
			throw new EditorError(
				400,
				"A page needs a name, and a slug of lowercase letters, numbers and dashes"
			)
		if (parent !== 0 && !id(parent)) throw new EditorError(400, "Unknown change")
		const chosen = (await components_of(editor)).find((c) => c.is_root && c.name === component)
		if (!chosen) throw new EditorError(400, "That isn’t a kind of page")
		const { story } = await editor
			.mapi<{ story: Summary }>("/stories/", {
				method: "POST",
				body: {
					story: { name: name.trim(), slug, parent_id: parent, content: fresh_blok(chosen) },
				},
			})
			.catch((e) => {
				// Storyblok's answer when the folder already has a page at that slug
				if (e instanceof EditorError && e.status === 422)
					throw new EditorError(409, "There’s already a page at that address: try another slug")
				throw e
			})
		return { story: summary(story) }
	}

	if (body.op === "share") {
		// who the site's draft is shared with, through moxy; the site is this one, whatever the page says
		const { op: _, do: action, ...rest } = body as Record<string, unknown>
		if (typeof action !== "string" || JSON.stringify(rest).length > 20_000)
			throw new EditorError(400, "Unknown change")
		return editor.broker("/apps/editor/share", { ...rest, op: action, site: site.origin })
	}

	if (body.op === "live") {
		// a minute's ticket for the page's multiplayer socket, so the handle itself never reaches the page
		// tied to where this page is served, which one sign-in may not be: localhost's ports share cookies
		return editor.broker<{ ticket: string; url: string }>("/apps/editor/live", {
			origin: site.origin,
		})
	}

	if (body.op === "changes") {
		// what Publish would send live, for each story the page shows
		const ids = body.stories
		if (!Array.isArray(ids) || ids.length > 20 || !ids.every(id))
			throw new EditorError(400, "Unknown change")
		const token = await site_token()
		const stories = await Promise.all(
			ids.map(async (story) => {
				const { story: draft } = await editor.mapi<{
					story: Summary & { content: Node; unpublished_changes?: boolean; updated_at?: string }
				}>(`/stories/${story}`)
				if (draft.published_at && !draft.unpublished_changes) return null
				let live: Node | undefined
				if (draft.published_at && token) {
					const query = new URLSearchParams({ version: "published", token, cv: String(Date.now()) })
					const res = await fetch(`${editor.cdn}/v2/cdn/stories/${story}?${query}`).catch(
						() => null
					)
					if (res?.ok) live = ((await res.json()) as { story: { content: Node } }).story.content
				}
				return {
					...summary(draft),
					// without the live copy there's nothing to compare, so it says its changes in general
					changes: live ? differences(live, draft.content) : null,
				}
			})
		)
		return { stories: stories.filter(Boolean) }
	}

	if (!id(body.story)) throw new EditorError(400, "Unknown change")

	if (body.op === "mux_set") {
		const { uid, field, asset } = body
		if (typeof uid !== "string" || !field_name(field) || !mux_id(asset))
			throw new EditorError(400, "Unknown change")
		const { story: current } = await editor.mapi<{ story: { content: Node } }>(
			`/stories/${body.story}`
		)
		const blok = find_blok(current.content, uid)
		if (!blok) throw new EditorError(404, "That block isn’t in the story any more")
		const secret = await mux_secret(editor, blok.component, field)
		// the asset comes from Mux, never the page
		const found = (await mux(site.moxy, secret, `video/v1/assets/${asset}`)) as MuxAsset
		const before = (blok[field] as { mux_video?: { id?: unknown } } | undefined)?.mux_video?.id
		blok[field] = video_of(found, blok[field])
		await editor.mapi(`/stories/${body.story}`, { method: "PUT", body: { story: current } })
		const undo = mux_id(before)
			? { op: "mux_set", story: body.story, uid, field, asset: before }
			: { op: "fields", story: body.story, uid, values: { [field]: null } }
		return { ok: true, undo }
	}

	if (body.op === "restore") {
		// puts a deleted blok back where it was, leaving everything changed since alone
		const { parent, field, index, blok } = body
		if (
			typeof parent !== "string" ||
			!field_name(field) ||
			!Number.isInteger(index) ||
			!blok ||
			typeof blok !== "object" ||
			typeof blok.component !== "string" ||
			typeof blok._uid !== "string"
		)
			throw new EditorError(400, "Unknown change")
		const kept = blok as Node & { _uid: string }
		const changed = await editor.patch(body.story, (content) => {
			if (find_blok(content, kept._uid)) return
			const place = place_for(content, parent, field)
			place.list.splice(Math.min(index as number, place.list.length), 0, kept)
		})
		return {
			ok: true,
			uid: kept._uid,
			// already there, so nothing for Undo to take away
			undo: changed ? { op: "remove", story: body.story, uid: kept._uid } : undefined,
		}
	}

	if (body.op === "content") {
		// a story's draft content in one go, for pages whose blocks the overlay can't read itself
		return { content: await content_of(editor, body.story) }
	}

	if (body.op === "story") {
		// for pages that don't `connect()`: the story's name and publish state, for the edit bar
		const { story } = await editor.mapi<{
			story: Summary & {
				updated_at: string
				content: Node
				last_author?: { id: number; friendly_name?: string } | null
			}
		}>(`/stories/${body.story}`)
		return {
			story: {
				...summary(story),
				updated_at: story.updated_at,
				content: { _uid: story.content._uid },
			},
			// whoever saved it last, so the page can tell someone else's change from its own
			by: story.last_author
				? { id: story.last_author.id, name: story.last_author.friendly_name ?? null }
				: null,
		}
	}

	if (body.op === "name") {
		if (!text(body.value, 255) || !body.value.trim())
			throw new EditorError(400, "A story needs a name")
		const { story } = await editor.mapi<{ story: Node }>(`/stories/${body.story}`)
		const before = story.name
		story.name = body.value.trim()
		await editor.mapi(`/stories/${body.story}`, { method: "PUT", body: { story } })
		return { ok: true, undo: { op: "name", story: body.story, value: before } }
	}

	if (body.op === "blok") {
		const uid = body.uid
		if (typeof uid !== "string") throw new EditorError(400, "Unknown change")
		const { story } = await editor.mapi<{ story: Summary & { content: Node } }>(
			`/stories/${body.story}`
		)
		const path = trail(story.content, uid)
		if (!path) throw new EditorError(404, "That block isn’t in the story any more")
		return {
			story: summary(story),
			blok: path[path.length - 1],
			trail: path.map(({ _uid, component }) => ({ uid: _uid, component })),
		}
	}

	if (body.op === "fields") {
		const { uid, values } = body
		if (typeof uid !== "string" || !values || typeof values !== "object" || Array.isArray(values))
			throw new EditorError(400, "Unknown change")
		const components = await components_of(editor)
		const resolve = async (asset: number) =>
			asset_of(await editor.mapi<ManagedAsset>(`/assets/${asset}`))
		const { story: current } = await editor.mapi<{ story: { content: Node } }>(
			`/stories/${body.story}`
		)
		const was = JSON.stringify(current.content)
		const blok = find_blok(current.content, uid)
		if (!blok) throw new EditorError(404, "That block isn’t in the story any more")
		const schema = components.find((c) => c.name === blok.component)?.schema ?? {}
		const before = Object.fromEntries(
			Object.keys(values).map((key) => [key, input_of(schema[key], blok[key])])
		)
		for (const [key, value] of Object.entries(values)) {
			const field = schema[key]
			if (!field || !field_name(key) || ["bloks", "tab", "section"].includes(field.type))
				throw new EditorError(400, `${key} can’t be changed here`)
			blok[key] = await normalise(field, value, blok[key], resolve)
		}
		if (JSON.stringify(current.content) === was) return { ok: true, blok }
		await editor.mapi(`/stories/${body.story}`, { method: "PUT", body: { story: current } })
		return { ok: true, blok, undo: { op: "fields", story: body.story, uid, values: before } }
	}

	if (body.op === "publish") {
		await editor.mapi(`/stories/${body.story}/publish`)
		return { ok: true }
	}

	if (body.op === "versions") {
		// the story's latest saves and publishes, newest first, with their content to look back through
		const { story_versions } = await editor.mapi<{ story_versions: Array<StoryVersion> }>(
			`/story_versions?${new URLSearchParams({ by_story_id: String(body.story), per_page: "25", show_content: "true" })}`
		)
		return {
			versions: story_versions.map(({ id, created_at, status, user, content }) => ({
				id,
				created_at,
				status,
				by: typeof user === "string" ? user : null,
				content: content ?? null,
			})),
		}
	}

	if (body.op === "revert") {
		// back to an earlier version, as a draft; undone by going back to the version it replaced
		if (!id(body.version)) throw new EditorError(400, "Unknown change")
		const [content, latest] = await Promise.all([
			version_content(editor, body.story, body.version),
			editor
				.mapi<{ story_versions: Array<StoryVersion> }>(
					`/story_versions?${new URLSearchParams({ by_story_id: String(body.story), per_page: "1" })}`
				)
				.then(({ story_versions }) => story_versions[0]?.id),
		])
		const { story: current } = await editor.mapi<{ story: { content: Node } }>(
			`/stories/${body.story}`
		)
		current.content = content
		await editor.mapi(`/stories/${body.story}`, { method: "PUT", body: { story: current } })
		return {
			ok: true,
			undo:
				latest && latest !== body.version
					? { op: "revert", story: body.story, version: latest }
					: undefined,
		}
	}

	if (
		body.op === "blocks" ||
		body.op === "move" ||
		body.op === "remove" ||
		body.op === "duplicate" ||
		body.op === "insert"
	) {
		const { uid } = body
		if (typeof uid !== "string" || !uid) throw new EditorError(400, "Unknown change")
		const story = body.story

		if (body.op === "blocks") {
			const place = place_for(await content_of(editor, story), uid, body.field)
			const { choices, full } = await rules(editor, place)
			return {
				full,
				components: choices.map(({ name, display_name }) => ({
					name,
					display_name: display_name || name,
				})),
			}
		}

		if (body.op === "move") {
			// a step up or down, or, dragged, to a place among its siblings
			const { by, to: place } = body
			if (by !== undefined ? by !== 1 && by !== -1 : !Number.isInteger(place))
				throw new EditorError(400, "Unknown change")
			let from: number | undefined
			await editor.patch(story, (content) => {
				const { list, index } = place_of(content, uid)
				const to = by !== undefined ? index + by : place!
				if (to < 0 || to >= list.length || to === index) return
				list.splice(to, 0, ...list.splice(index, 1))
				from = index
			})
			return {
				ok: true,
				uid,
				undo: from !== undefined ? { op: "move", story, uid, to: from } : undefined,
			}
		}

		if (body.op === "remove") {
			let undo: Record<string, unknown> | undefined
			await editor.patch(story, (content) => {
				const { parent, field, list, index } = place_of(content, uid)
				const [blok] = list.splice(index, 1)
				// where it was, for the page's Undo; a richtext embed has no blok to find it by
				if (typeof parent._uid === "string")
					undo = { op: "restore", story, parent: parent._uid, field, index, blok }
			})
			return { ok: true, undo }
		}

		const component = body.op === "insert" ? body.component : undefined
		if (body.op === "insert" && !field_name(component)) throw new EditorError(400, "Unknown change")
		// the schema check needs the story as it is now, so it runs inside the save
		const { story: current } = await editor.mapi<{ story: { content: Node } }>(`/stories/${story}`)
		const place =
			body.op === "insert"
				? place_for(current.content, uid, body.field)
				: place_of(current.content, uid)
		const { choices, full } = await rules(editor, place)
		if (full) throw new EditorError(400, "This list already has as many blocks as it can hold")

		let added: Node
		if (body.op === "duplicate") added = copy_blok(place.list[place.index])
		else {
			const chosen = choices.find((c) => c.name === component)
			if (!chosen) throw new EditorError(400, "That block can’t go here")
			added = fresh_blok(chosen)
		}
		place.list.splice(place.index + 1, 0, added)
		await editor.mapi(`/stories/${story}`, { method: "PUT", body: { story: current } })
		return { ok: true, uid: added._uid, undo: { op: "remove", story, uid: added._uid } }
	}

	if (body.op === "image") {
		const { uid, field, index, asset, alt, focus } = body
		if (
			typeof uid !== "string" ||
			!field_name(field) ||
			(index !== undefined && !Number.isInteger(index)) ||
			!id(asset) ||
			!text(alt, 1000) ||
			!text(focus, 40) ||
			(focus && !/^\d+x\d+:\d+x\d+$/.test(focus))
		)
			throw new EditorError(400, "Unknown change")

		// the asset's address comes from Storyblok, not the page, so a field can only point into the space
		const chosen = asset_of(await editor.mapi<ManagedAsset>(`/assets/${asset}`))
		let before: unknown
		const changed = await editor.patch(body.story, (content) => {
			const blok = find_blok(content, uid)
			if (!blok) throw new EditorError(404, "That block isn’t in the story any more")
			const type = Array.isArray(blok[field]) ? "multiasset" : "asset"
			before = input_of({ type }, structuredClone(blok[field]))
			const value = {
				id: chosen.id,
				filename: chosen.filename,
				alt,
				title: chosen.title,
				copyright: chosen.copyright,
				focus,
				name: "",
			}
			if (!set_asset(blok, field, index, value))
				throw new EditorError(400, `${field} isn’t an image field`)
		})
		return {
			ok: true,
			undo: changed
				? { op: "fields", story: body.story, uid, values: { [field]: before } }
				: undefined,
		}
	}

	if (
		body.op !== "set" ||
		typeof body.uid !== "string" ||
		!field_name(body.field) ||
		!text(body.value, 20_000)
	)
		throw new EditorError(400, "Unknown change")

	const { uid, field, value } = body
	const components = await components_of(editor)
	let before: unknown
	const changed = await editor.patch(body.story, (content) => {
		const blok = find_blok(content, uid)
		if (!blok) throw new EditorError(404, "That block isn’t in the story any more")
		// only what the schema says is text, so a typo'd or crafted field can't clobber anything else
		const schema = components.find((c) => c.name === blok.component)?.schema[field]
		before = input_of(schema, structuredClone(blok[field]))
		const texty =
			schema && (["text", "textarea", "markdown"].includes(schema.type) || is_heading(schema))
		if (!texty || !set_text(blok, field, value))
			throw new EditorError(400, `${field} isn’t a text field`)
		const longest = Number(schema.max_length)
		if (longest && value.length > longest)
			throw new EditorError(
				400,
				`${schema.display_name || field} takes up to ${longest} characters`
			)
	})
	return {
		ok: true,
		undo: changed
			? { op: "fields", story: body.story, uid, values: { [field]: before } }
			: undefined,
	}
}

// --- the hook

/** What the page's edit bar needs; `<` escaped so a name can't close the script tag */
const script = (value: {
	user: EditorUser | null
	space: string | null
	draft: boolean
	guest: { name: string | null; role: Guest["role"]; named: boolean; by: string | null } | null
}) =>
	`<script type="application/json" id="storyloco-editor">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`

/** `editor`, pointed at another moxy or space; `STORYLOCO_MOXY` does the same without code */
export function create_editor({
	moxy,
	space: configured,
}: { moxy?: string; space?: string } = {}): Handle {
	return async ({ event, resolve }) => {
		const broker = moxy ?? env("STORYLOCO_MOXY") ?? MOXY

		const space = await own_space(configured).catch(() => null)
		const name = cookie_for(space)
		// before the space is known, a sign-in under its name can't be read; nothing else can be either
		// the live page beside the draft is a visitor's, whoever's asking
		const live = event.url.searchParams.has(LIVE)
		const handle = space && !live ? event.cookies.get(name) : undefined
		if (handle) {
			try {
				const session = await lookup(broker, handle)
				;(event.locals as { editor?: Editor }).editor = new Editor(
					session,
					() => lookup(broker, handle, true),
					{ url: broker, handle }
				)
			} catch (e) {
				if (e === SIGNED_OUT) event.cookies.delete(name, { path: "/" })
				// moxy unreachable: render as signed out without dropping the cookie
				else console.error(e)
			}
		}

		// nobody signed in to edit, but the draft's shared with them
		const guest_name = guest_cookie_for(space)
		const guest_handle =
			space && !live && !(event.locals as { editor?: Editor }).editor
				? event.cookies.get(guest_name)
				: undefined
		if (guest_handle) {
			try {
				;(event.locals as { guest?: Guest }).guest = await guest_of(broker, guest_handle)
			} catch (e) {
				if (e === SIGNED_OUT) event.cookies.delete(guest_name, { path: "/" })
				else console.error(e)
			}
		}

		if (event.url.pathname.startsWith(`${PREFIX}/`)) return route(event, broker, configured, name)

		const editor = (event.locals as { editor?: Editor }).editor
		const guest = (event.locals as { guest?: Guest }).guest

		// `?edit` on any page signs in to edit it, so editors can bookmark it on any deploy
		if (event.url.searchParams.has("edit") && event.request.method === "GET") {
			const back = new URL(event.url)
			back.searchParams.delete("edit")
			const path = back.pathname + back.search
			if (editor) redirect(303, path)
			redirect(303, `${PREFIX}/signin?return=${encodeURIComponent(path)}`)
		}
		const response = await resolve(event, {
			// after `resolve`, so a later hook has set the version: previews get the bar too, signed in or not
			transformPageChunk: async ({ html }) => {
				// previews show drafts; so does development, where the badge is always there to sign in from
				const draft = dev || (event.locals as { version?: string }).version === "draft"
				if (!editor && !draft) return html
				// the site's client may only have been made while this request rendered
				const known = space ?? (await own_space(configured).catch(() => null))
				const shared = guest && {
					name: guest.user.name,
					role: guest.role,
					named: guest.named,
					by: guest.by,
				}
				return html.replace(
					"</head>",
					`${script({ user: editor?.user ?? null, space: known, draft, guest: shared || null })}</head>`
				)
			},
		})
		// an editor's or guest's page is theirs, drafts and all: kept out of caches, whatever key
		// the site's middleware moved them onto, and out of search engines
		if (guest || editor)
			try {
				response.headers.set("cache-control", "private, no-store")
				response.headers.set("x-robots-tag", "noindex, nofollow")
			} catch {
				// a response passed through from elsewhere has headers of its own
			}
		return response
	}
}

export const editor = create_editor()
