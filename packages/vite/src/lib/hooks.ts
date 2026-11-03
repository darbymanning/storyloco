import { useStoryblokApi } from "@storyblok/svelte"
import type { Handle } from "./kit.js"
import type { RequestEvent } from "@sveltejs/kit"
import { StoryblokClient } from "./storyblok.svelte.js"
import { editor_version } from "./editor/version.js"
import { site_token, staging } from "./settings.js"

export { handle_redirects as redirects } from "./redirects/handle.js"
export { editor_version }

/** Keeps a Storyblok preview going past its first page; kept in step with `middleware.ts` */
export const PREVIEW_COOKIE = "storyblok_preview"

/** How long the visual editor's signature is good for, as Storyblok checks it */
const LINK_TTL = 60 * 60

/** How long a preview it started lasts without a request: a working day, so an editor left open over lunch still shows drafts */
const SESSION_TTL = 12 * 60 * 60

const now = () => Math.floor(Date.now() / 1000)

/** What a session staging started is signed for, in place of the space the visual editor's is */
const STAGING = "staging"

/**
 * How a preview's drafts came, on `event.locals.preview`: the visual editor's signed link (or the
 * session it started), or staging's, which anyone may ask for. Unset for an editor, a guest,
 * development, or the published site
 */
export type Preview = "signed" | "staging"

/** Development asked for what's live rather than its drafts */
const DEV_PUBLISHED = "storyloco_published"

async function sha1(text: string) {
	const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/** `space:timestamp:signature`, signed as Storyblok signs a preview: SHA-1 of `space:token:timestamp` */
const sign = async (space: string, timestamp: number, token: string) =>
	`${space}:${timestamp}:${await sha1(`${space}:${token}:${timestamp}`)}`

/**
 * Whether a `sign`ed value is the token's, and under `ttl` old. No lower bound, as in Storyblok's own
 * check: a server clock a little behind Storyblok's sees a fresh link as from the future.
 */
async function signed(value: string | null | undefined, token: string, ttl: number) {
	const [space, timestamp] = value?.split(":") ?? []
	return (
		!!space &&
		now() - Number(timestamp) < ttl &&
		value === (await sign(space, Number(timestamp), token))
	)
}

/**
 * Put the Storyblok content version on `event.locals.version`: draft while developing, in a
 * Storyblok preview and whenever `editor_version` says so; published everywhere else. Goes after
 * `editor` in `sequence`.
 *
 * A preview is only one the visual editor signed: Storyblok adds `_storyblok_tk[space_id]`,
 * `[timestamp]` and `[token]` to the URL, the token a SHA-1 of `space:preview token:timestamp`
 * that's good for an hour. A bare `?_storyblok` shows the published site.
 *
 * On staging (see `staging`), anyone may look at the drafts: a bare `?_storyblok` starts the same
 * session, as it did before previews were signed, and the edit bar there switches between them.
 *
 * `?_storyblok` only reaches the document request: client-side navigations fetch
 * `__data.json`, and remote functions POST to `/_app/remote/…`, without it. So a preview is kept
 * on a cookie signed the same way, renewed on each request and ending 12 hours after the last;
 * it's also what keeps a preview opened from the editor in a tab of its own. `?_storyblok=off`
 * ends it.
 *
 * Declare it on `App.Locals` as `version: import("storyloco").Version`.
 *
 * As it is, `sequence(version, …)`, it checks a preview with the site's token. A site serving several
 * spaces sets up which: `sequence(version({ token: (event) => token_for(event) }), …)`.
 */
export function version(input: Parameters<Handle>[0]): ReturnType<Handle>
export function version(options?: VersionOptions): Handle
export function version(input?: Parameters<Handle>[0] | VersionOptions) {
	return input && "event" in input ? plain(input) : versioned(input)
}

interface VersionOptions {
	/** The preview token the space this request shows was signed with; the site's own by default */
	token?: (event: RequestEvent) => string | undefined | Promise<string | undefined>
}

const versioned =
	({ token: token_of = () => site_token() }: VersionOptions = {}): Handle =>
	async ({ event, resolve }) => {
		const { searchParams: query } = event.url
		const kept = event.cookies.get(PREVIEW_COOKIE)
		const tk = (key: string) => query.get(`_storyblok_tk[${key}]`)
		const given = query.has("_storyblok_tk[token]")
			? `${tk("space_id")}:${tk("timestamp")}:${tk("token")}`
			: undefined

		const off = query.get("_storyblok") === "off"
		// staging takes a bare `?_storyblok` as asking for drafts; only staging honours a session it started
		const staged =
			(query.has("_storyblok") || kept?.startsWith(`${STAGING}:`)) && (await staging(event.url))
		// the editor's signature first, then the session it started; nothing to check on most requests
		const token = (given || kept || staged) && !off ? await token_of(event) : undefined
		let valid: string | undefined
		if (token)
			for (const [value, ttl] of [
				[given, LINK_TTL],
				[kept, SESSION_TTL],
			] as const)
				if (
					(value !== kept || !value?.startsWith(`${STAGING}:`) || staged) &&
					(await signed(value, token, ttl))
				) {
					valid = value
					break
				}
		if (!valid && token && staged && query.has("_storyblok"))
			valid = await sign(STAGING, now(), token)

		if (valid && token)
			// renewed on each request; SameSite=None, so it lasts inside the visual editor's cross-site frame
			event.cookies.set(PREVIEW_COOKIE, await sign(valid.split(":")[0], now(), token), {
				path: "/",
				sameSite: "none",
				secure: true,
				httpOnly: true,
				maxAge: SESSION_TTL,
			})
		else if (kept) event.cookies.delete(PREVIEW_COOKIE, { path: "/" })
		// development shows drafts, until the edit bar's switch asks for what's live
		let dev_draft = false
		if (import.meta.env.DEV) {
			if (off) event.cookies.set(DEV_PUBLISHED, "1", { path: "/", httpOnly: true, sameSite: "lax" })
			else if (query.has("_storyblok")) event.cookies.delete(DEV_PUBLISHED, { path: "/" })
			dev_draft = !event.cookies.get(DEV_PUBLISHED)
		}
		event.locals.version = editor_version(event) ?? (dev_draft || valid ? "draft" : "published")
		// so the edit bar knows its switch is heard here: a site deciding the version itself won't follow it
		;(event.locals as { switchable?: boolean }).switchable = true
		// how a preview's drafts came: a site that keeps staging behind a password lets the visual
		// editor's signed preview through, but not anyone who asked with `?_storyblok`
		if (valid)
			(event.locals as { preview?: Preview }).preview = valid.startsWith(`${STAGING}:`)
				? "staging"
				: "signed"

		// the SDK pins every read to the first cache version it saw, so a warm server never saw a publish
		if (event.locals.version === "published" && StoryblokClient.current) {
			await StoryblokClient.current.init()
			useStoryblokApi()?.clearCacheVersion()
		}

		return await resolve(event)
	}

const plain = versioned()
