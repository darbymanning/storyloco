import type { Handle } from "@sveltejs/kit"
import { match, compile } from "path-to-regexp"
import { Logger } from "../shared/logger.js"
import { fetch_redirects, type Redirect } from "./fetch.js"

const name = "vite-storyblok-redirects"
const logger = new Logger(name)

/**
 * Resolve a pathname to a redirect target using a generated redirects map.
 *
 * The redirects map supports two forms:
 * - Exact keys: 'foo' or '/foo' -> direct lookup
 * - Glob keys with '*' like '/foo/* /bar' -> single-segment wildcards
 *
 * How wildcards are handled (via path-to-regexp translation):
 * - Source: '*' becomes ':wN([^/]+)' (captures one path segment per '*')
 * - Target: '*' becomes ':wN' (substitutes the corresponding capture)
 */

/** A pathname with a leading slash. */
type Pathname = `/${string}`

/** Normalise to a leading-slash path. Empty → '/' */
function normalize_path(pathname: string): Pathname {
	if (!pathname) return "/"
	return pathname.startsWith("/") ? (pathname as Pathname) : `/${pathname}`
}

/**
 * How paths are compared: leading slash, no trailing slash, query kept. SvelteKit strips a trailing
 * slash before hooks run, so `/old/` has to match a request for `/old`.
 */
function match_key(path: string): string {
	const i = path.indexOf("?")
	const [pathname, query] = i < 0 ? [path, ""] : [path.slice(0, i), path.slice(i)]
	return normalize_path(pathname).replace(/(.)\/+$/, "$1") + query
}

/** Absolute URL check (e.g. https://..., http://..., //cdn...) */
function is_absolute_url(value: string): boolean {
	return /^https?:\/\//i.test(value) || value.startsWith("//")
}

/** Translate a glob source pattern to a path-to-regexp pattern. */
function to_src_pattern(glob: string): string {
	let i = 1
	// path-to-regexp v8 defaults tokens to a single segment ([^/]+), so no custom regex needed
	return normalize_path(glob).replaceAll("*", () => `:w${i++}`)
}

/** Translate a glob target pattern to a path-to-regexp compile template. */
function to_dst_pattern(glob: string): string {
	let i = 1
	return normalize_path(glob).replaceAll("*", () => `:w${i++}`)
}

type Rules = {
	/** Exact redirect lookups, keyed by match_key. */
	exact: Map<string, string>
	/** Precompiled wildcard rules. */
	wildcards: Array<{ matcher: ReturnType<typeof match>; builder: ReturnType<typeof compile> }>
}

function build_rules(redirects: Array<Redirect>): Rules {
	const rules: Rules = { exact: new Map(), wildcards: [] }
	for (const [key, value] of redirects) {
		if (key.includes("*")) {
			try {
				rules.wildcards.push({
					matcher: match(to_src_pattern(match_key(key)), { decode: decodeURIComponent, end: true }),
					builder: compile(to_dst_pattern(value), { encode: (x) => x }),
				})
			} catch (err) {
				logger.warn(`Skipping redirect ${key} -> ${value}: ${err}`)
			}
		} else {
			const existing = rules.exact.get(match_key(key))
			if (existing !== undefined && existing !== value)
				logger.warn(
					`${key} -> ${value} replaces ${existing}: keys match with or without a trailing slash`
				)
			rules.exact.set(match_key(key), value)
		}
	}
	return rules
}

/** How long a fetched list is used before it's refreshed in the background. */
const MAX_AGE = 60_000

let rules: Promise<Rules> | undefined
let refresh: (() => Promise<Array<Redirect>>) | undefined
let fetched_at = 0

/**
 * The current rules. The first request waits for the live datasource, falling back to the list baked
 * in at build; after that, a list older than MAX_AGE keeps serving while a fresh one loads, and a
 * failed refresh keeps the last good list.
 */
async function current_rules(): Promise<Rules> {
	rules ??= (async () => {
		let config: { redirects: Array<Redirect>; datasource: string; token: string }
		try {
			// @ts-expect-error - virtual module resolved at runtime by vite plugin
			config = await import("virtual:storyblok-redirects")
		} catch (err) {
			logger.warn(`Failed to load redirects from virtual module, using no redirects: ${err}`)
			return build_rules([])
		}
		refresh = config.token ? () => fetch_redirects(config.datasource, config.token) : undefined
		fetched_at = Date.now()
		return build_rules((await refresh?.().catch(warn)) ?? config.redirects)
	})()

	if (refresh && Date.now() - fetched_at > MAX_AGE) {
		fetched_at = Date.now()
		refresh()
			.then((redirects) => (rules = Promise.resolve(build_rules(redirects))))
			.catch(warn)
	}
	return rules
}

function warn(err: unknown): undefined {
	logger.warn(`Couldn't refresh redirects, keeping the current ones: ${err}`)
}

/**
 * Resolve a redirect for the given pathname.
 *
 * Returns a normalised absolute path ('/…') if a redirect applies, else null.
 * Self-redirects are ignored.
 */
async function resolve_redirect(url: URL): Promise<string | null> {
	const { exact, wildcards } = await current_rules()
	try {
		const source = match_key(url.pathname + url.search)
		const source_plain = match_key(url.pathname)

		// Prefer exact including query, then plain path
		let target = exact.get(source) ?? exact.get(source_plain) ?? null

		if (!target) {
			for (const { matcher, builder } of wildcards) {
				const m = matcher(source_plain)
				if (!m) continue
				// names are w1, w2, ... so we can pass matcher params directly to builder
				target = builder(m.params as Record<string, string>)
				break
			}
		}

		if (target) {
			const result = is_absolute_url(target) ? target : normalize_path(target)
			// If source included a query and the target is a relative path without its own query,
			// we do NOT automatically forward the original query. The map should specify it.
			const result_key = match_key(result)
			if (result_key !== source && result_key !== source_plain) return result
		}

		return null
	} catch (err) {
		console.error(err)
		return null
	}
}

export const handle_redirects: Handle = async ({ event, resolve }) => {
	const target = await resolve_redirect(event.url)
	if (!target) return await resolve(event)

	logger.info(`Redirecting ${event.url.pathname}${event.url.search || ""} -> ${target}`)

	return new Response(null, { status: 308, headers: { Location: target } })
}
