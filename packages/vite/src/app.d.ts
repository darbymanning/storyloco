// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// Consumers declare this themselves; it's here so storyloco's own `version` hook
		// and `server` helpers typecheck against the shape they expect.
		interface Locals {
			version: import("$lib/storyblok.svelte.js").Version
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {}
