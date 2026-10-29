import { redirect, type RequestEvent } from "@sveltejs/kit"
import type { Handle } from "../kit.js"
import { env, setting, site_token } from "../settings.js"
import { LIVE, editor_version } from "./version.js"
import { allowed } from "./content.js"
import {
	ask_moxy,
	CHANGES,
	Editor,
	EditorError,
	id,
	operate,
	type EditorUser,
	type Session,
} from "./ops.js"

export { allowed }
export { Editor, EditorError, input_of, normalise, video_of } from "./ops.js"
export type { Asset, EditorUser } from "./ops.js"
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
/** A sign-in that lands in edit mode, as ⌘⇧E does, from one of `editor`'s `entry` ways in */
const EDIT_ON = "sl_edit_on"
/** `admin`, `/admin/` and `/admin` alike */
const trim = (path: string) => "/" + path.replace(/^\/+|\/+$/g, "")

/** SvelteKit 3 only redirects to another origin when told it's meant to; SvelteKit 2 ignores the option */
const to_moxy = redirect as (status: 303, location: URL, options: { external: true }) => never

async function route(
	event: RequestEvent,
	moxy: string,
	space: string | undefined,
	name: string,
	files: string | null
): Promise<Response> {
	const { url, cookies, request } = event
	const path = url.pathname.slice(PREFIX.length)

	// the editor app, from this site's own origin, so its Content-Security-Policy needn't name anywhere else
	const file = path.match(/^\/editor\/([\w.-]+\.js)$/)?.[1]
	if (file && files && request.method === "GET") return editor_file(moxy, files, file)

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
			const token = await site_token()
			// done by moxy where it can, so a change to it doesn't wait on this site's next release
			const moved = await editor.in_moxy(body, token)
			if (moved) return moved
			const run = () => operate(editor, body, { moxy, origin: url.origin, token })
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

// --- the hook

/** storyloco's published releases, by version */
const RELEASES = "https://cdn.jsdelivr.net/npm/storyloco"

let release: { at: number; version: string } | null = null

/** The storyloco release whose editor app moxy names, asked once a minute */
async function current_release(moxy: string) {
	if (release && Date.now() - release.at < 60_000) return release.version
	const res = await fetch(`${moxy}/editor/version`).catch(() => null)
	const version = res?.ok ? ((await res.json()) as { version?: string }).version : undefined
	if (version && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) release = { at: Date.now(), version }
	return release?.version ?? null
}

/**
 * One of the editor app's files, passed on from where they're published: the release moxy names, or
 * another base, like a local build's. The entry is asked again each minute; the rest are named by
 * their content, so they keep
 */
async function editor_file(moxy: string, files: string, file: string) {
	let base = files
	if (files === RELEASES) {
		const version = await current_release(moxy)
		if (!version) return new Response("No editor release to load", { status: 503 })
		base = `${RELEASES}@${version}/packages/vite/dist-editor`
	}
	const res = await fetch(`${base}/${file}`).catch(() => null)
	if (!res?.ok) return new Response("Couldn’t load the editor", { status: 502 })
	return new Response(res.body, {
		headers: {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control":
				file === "app.js" ? "private, max-age=60" : "public, max-age=31536000, immutable",
		},
	})
}

/** What the page's edit bar needs; `<` escaped so a name can't close the script tag */
const script = (value: {
	user: EditorUser | null
	space: string | null
	draft: boolean
	guest: { name: string | null; role: Guest["role"]; named: boolean; by: string | null } | null
	/** Turn edit mode on, as the sign-in that brought them here asked */
	edit?: boolean
	/** Where the editor app loads from; this package's own copy when null */
	app: string | null
}) =>
	`<script type="application/json" id="storyloco-editor">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`

interface EditorOptions {
	/** Another moxy; `STORYLOCO_MOXY` does the same without code */
	moxy?: string
	space?: string
	/** Ways in to edit mode: a path, taken only where the site has no page of its own, or a `?param` on any page */
	entry?: string | Array<string>
	/**
	 * Where the editor app's files come from: storyloco's releases, at the one moxy names, so a change
	 * to the editor reaches the site without a release of its own; another base URL, like a local
	 * build's; or `false` for this package's own copy. `STORYLOCO_EDITOR` does the same, with `local`
	 * for this package's
	 */
	app?: string | false
}

function create({
	moxy,
	space: configured,
	entry = "/admin",
	app: chosen,
}: EditorOptions = {}): Handle {
	const ways = [entry].flat()
	const params = ways.filter((way) => way.startsWith("?")).map((way) => way.slice(1).split("=")[0])
	const paths = ways.filter((way) => !way.startsWith("?")).map(trim)
	return async ({ event, resolve }) => {
		const broker = moxy ?? env("STORYLOCO_MOXY") ?? MOXY
		const wanted = chosen ?? env("STORYLOCO_EDITOR") ?? RELEASES
		const files = wanted === false || wanted === "local" ? null : wanted
		const app = files && `${PREFIX}/editor/app.js`

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

		if (event.url.pathname.startsWith(`${PREFIX}/`))
			return route(event, broker, configured, name, files)

		const editor = (event.locals as { editor?: Editor }).editor
		const guest = (event.locals as { guest?: Guest }).guest

		// a `?param` way in, on any page, signs in to edit that page
		const param = params.find((name) => event.url.searchParams.has(name))
		if (param && event.request.method === "GET") {
			const back = new URL(event.url)
			back.searchParams.delete(param)
			const path = back.pathname + back.search
			event.cookies.set(EDIT_ON, "1", { ...cookie, maxAge: 600 })
			if (editor) redirect(303, path)
			redirect(303, `${PREFIX}/signin?return=${encodeURIComponent(path)}`)
		}
		// edit mode on as the page lands, once, after a sign-in that asked for it
		const edit =
			!!editor &&
			event.request.method === "GET" &&
			!!event.request.headers.get("accept")?.includes("text/html") &&
			!!event.cookies.get(EDIT_ON)
		if (edit) event.cookies.delete(EDIT_ON, { path: "/" })
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
					`${script({ user: editor?.user ?? null, space: known, draft, guest: shared || null, edit, app })}</head>`
				)
			},
		})
		// a path way in, where the site has no page of its own, is the home page in edit mode, signed in first
		if (
			response.status === 404 &&
			event.request.method === "GET" &&
			paths.includes(trim(event.url.pathname))
		)
			return new Response(null, {
				status: 303,
				headers: {
					location: editor ? "/" : `${PREFIX}/signin?return=%2F`,
					"set-cookie": event.cookies.serialize(EDIT_ON, "1", { ...cookie, maxAge: 600 }),
					"cache-control": "no-store",
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

const plain = create()

/** The hook as it is, `sequence(editor, …)`, or set up, `sequence(editor({ entry: "/cms" }), …)` */
export function editor(input: Parameters<Handle>[0]): ReturnType<Handle>
export function editor(options?: EditorOptions): Handle
export function editor(input?: Parameters<Handle>[0] | EditorOptions) {
	return input && "event" in input ? plain(input) : create(input)
}
