import { mount, unmount } from "svelte"
import { BRIDGE } from "./client.js"
import EditBar from "./edit_bar.svelte"

/*
 * The editor app: everything a signed-in editor, a guest or a preview loads, and nothing a visitor
 * does. Built on its own to `dist-editor/`, Svelte and all, and loaded from moxy, so it can change
 * without the sites; `EditBar`, in each site, mounts it and wires it to SvelteKit
 */

export const bridge = BRIDGE

type Props = { accent?: string; accent_ink?: string }

/** The badge, mounted where the site's `EditBar` is, so its accent reads the site's CSS there */
export function mount_bar(target: HTMLElement, initial: Props) {
	const props = $state({ ...initial })
	const bar = mount(EditBar, { target, props })
	return {
		set(next: Props) {
			Object.assign(props, next)
		},
		destroy() {
			unmount(bar)
		},
	}
}
export { mount_bar as mount }

/** Editing in place, loaded the first time a block marked with `attrs` asks */
export function install() {
	import("./overlay.js").then((overlay) => overlay.install())
}

/** A guest's welcome to a shared draft */
export function welcome() {
	import("./overlay.js").then((overlay) => overlay.welcome())
}
