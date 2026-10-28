<!--
	@component
	The badge previews and signed-in editors see in a corner, with the publish status, signing in and
	out, and editing in place. Renders nothing for visitors, or inside Storyblok's own editor. On the
	live site ⌘⇧E (Ctrl+Shift+E) signs in, and turns edit mode on and off once signed in.

	The editor itself loads from moxy, so a change to it reaches every site without a release of
	theirs; this is the part of it that stays in the site, wiring it to SvelteKit.

	Mount it once in the root layout. Match it to a site with `--editor-bg`, `-ink`, `-muted`,
	`-line`, `-shadow`, `-font` and `-offset`, `--editor-badge`, and `--editor-accent`, `-good`
	and `-danger`; or pass `accent`, which can follow a site's theme as it changes.

	```svelte
	<EditBar />
	<EditBar accent="var(--brand)" />
	```
-->
<script lang="ts">
	import { afterNavigate } from "$app/navigation"
	import * as navigation from "$app/navigation"
	import { page } from "$app/state"
	import { app, being_edited, editor, navigated, set_kit } from "./client.js"

	let {
		accent,
		accent_ink,
	}: {
		/**
		 * The editor's accent, any CSS colour: outlines, toolbars and buttons, wherever they're
		 * drawn on the page. It can change, say with a site's location theme. Storyblok's teal
		 * otherwise, or `--editor-accent` set in CSS.
		 */
		accent?: string
		/** Text on the accent, where white won't read, like on a light yellow */
		accent_ink?: string
	} = $props()

	const kit = navigation as typeof navigation & { refreshAll?: () => Promise<void> }
	set_kit({
		goto: (url, options) => navigation.goto(url, options),
		refresh: () => (kit.refreshAll ?? navigation.invalidateAll)(),
		replace_state: (url, state) => navigation.replaceState(url, state as App.PageState),
		page: () => ({ url: new URL(page.url.href), state: page.state }),
	})

	afterNavigate(navigated)

	// for the site's CSS, as `unless_editing` is for its effects: what an animation would reveal rests
	// in view while the page is being edited
	$effect(() => {
		document.documentElement.toggleAttribute("data-storyloco-editing", being_edited())
	})

	let target = $state<HTMLElement>()
	let shown: ReturnType<Awaited<ReturnType<typeof app>>["mount"]> | undefined

	// the editor's own badge, for previews and whoever's signed in or was shared the draft
	$effect(() => {
		if (!target || window.self !== window.top) return
		if (!editor.draft && !editor.user && !editor.guest) return
		let gone = false
		app().then((loaded) => {
			if (!gone) shown = loaded.mount(target!, { accent, accent_ink })
		})
		return () => {
			gone = true
			shown?.destroy()
			shown = undefined
		}
	})

	$effect(() => {
		// read before the badge is there too, so a later change still reaches it
		const next = { accent, accent_ink }
		shown?.set(next)
	})
</script>

<!-- where the badge goes, so its accent reads `var(…)` as the site sets it here -->
<div bind:this={target} style:display="contents"></div>
