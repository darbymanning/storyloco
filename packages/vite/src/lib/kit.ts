import type { RequestEvent } from "@sveltejs/kit"

/** What `resolve` takes, of SvelteKit's options, as far as storyloco's hooks use them */
type ResolveOptions = {
	transformPageChunk?: (input: {
		html: string
		done: boolean
	}) => string | undefined | Promise<string | undefined>
	filterSerializedResponseHeaders?: (name: string, value: string) => boolean
	preload?: (input: { type: string; path: string }) => boolean
}

/**
 * A `handle` hook, as SvelteKit 2 and 3 both call one: 3 moved its own type to
 * `@sveltejs/kit/hooks`, and its `resolve` always returns a promise where 2's may not
 */
export type Handle = (input: {
	event: RequestEvent
	resolve: (event: RequestEvent, opts?: ResolveOptions) => Response | Promise<Response>
}) => Promise<Response>
