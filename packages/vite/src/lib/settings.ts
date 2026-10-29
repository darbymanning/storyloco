import { StoryblokClient } from "./storyblok.svelte.js"

export const env = (name: string) =>
	(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name]

/** A setting from SvelteKit's env, where the site's .env lives; process.env alone misses it in development */
export async function setting(name: string) {
	type Env = { env: Record<string, string | undefined> }
	const [secret, open] = await Promise.all([
		import("$env/dynamic/private").catch(() => null) as Promise<Env | null>,
		import("$env/dynamic/public").catch(() => null) as Promise<Env | null>,
	])
	return secret?.env[name] || open?.env[name] || env(name)
}

/** The token the site reads content with; the environment's first, since a client reading through a proxy carries a stand-in */
export async function site_token() {
	return (
		(await setting("PUBLIC_STORYBLOK_ACCESS_TOKEN")) ||
		(await setting("STORYBLOK_ACCESS_TOKEN")) ||
		(await setting("PUBLIC_STORYBLOK_TOKEN")) ||
		StoryblokClient.current?.token
	)
}
