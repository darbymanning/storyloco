// SvelteKit 3 still serves these, but types only the $app/env modules it renames them to; 2 has no
// $app/env at all, so storyloco keeps to these, which both serve
declare module "$env/dynamic/private" {
	export const env: Record<string, string | undefined>
}
declare module "$env/dynamic/public" {
	export const env: Record<string, string | undefined>
}
