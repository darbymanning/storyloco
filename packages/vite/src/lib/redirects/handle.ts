import type { Handle } from "@sveltejs/kit"
import { match, compile } from "path-to-regexp"
import { Logger } from "../shared/logger.js"

const name = "vite-storyblok-redirects"
const logger = new Logger(name)

// Lazy load the redirects map to avoid import errors during dev
let redirects_map: Map<string, string> | null = null

async function load_redirects_map(): Promise<Map<string, string>> {
	if (redirects_map) return redirects_map

	try {
		// import from virtual module
		// @ts-expect-error - virtual module resolved at runtime by vite plugin
		const module = await import("virtual:storyblok-redirects")
		const redirects = (module as { redirects: Array<[string, string]> }).redirects
		redirects_map = new Map(redirects)
		return redirects_map
	} catch (err) {
		logger.warn(`Failed to load redirects from virtual module, using empty redirects map`)
		logger.warn(String(err))
		redirects_map = new Map()
		return redirects_map
	}
}

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

/** Precompiled wildcard rules generated from the redirects map. */
let wildcard_rules: Array<{
	matcher: ReturnType<typeof match>
	builder: ReturnType<typeof compile>
}> = []

/** Exact redirect lookups, with and without leading slash variants. */
let exact_map: Map<string, string> = new Map()

let rules_initialized = false

async function initialize_rules() {
	if (rules_initialized) return

	const map = await load_redirects_map()
	wildcard_rules = []
	exact_map = new Map()

	for (const [key, value] of map.entries()) {
		if (key.includes("*")) {
			const src_pattern = to_src_pattern(key)
			const dst_pattern = to_dst_pattern(value)
			wildcard_rules.push({
				matcher: match(src_pattern, { decode: decodeURIComponent, end: true }),
				builder: compile(dst_pattern, { encode: (x) => x }),
			})
		} else {
			exact_map.set(normalize_path(key), value)
			exact_map.set(key.startsWith("/") ? key.slice(1) : key, value)
		}
	}

	rules_initialized = true
}

/**
 * Resolve a redirect for the given pathname.
 *
 * Returns a normalised absolute path ('/…') if a redirect applies, else null.
 * Self-redirects are ignored.
 */
async function resolve_redirect(url: URL): Promise<string | null> {
	await initialize_rules()
	try {
		const source = normalize_path(url.pathname + (url.search || ""))
		const source_plain = source.includes("?") ? (source.split("?")[0] as Pathname) : source

		const lookup = (key: string): string | undefined =>
			exact_map.get(key) ?? exact_map.get(key.startsWith("/") ? key.slice(1) : key)

		// Prefer exact including query, then plain path
		let target = lookup(source) ?? lookup(source_plain) ?? null

		if (!target) {
			for (const { matcher, builder } of wildcard_rules) {
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
			if (result !== source && result !== source_plain) return result
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
