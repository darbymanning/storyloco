import { mount, type Component } from 'svelte'

function mode_setter() {
	function set_theme(event: MediaQueryListEvent | MediaQueryList) {
		document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'default')
	}

	const match_media = window.matchMedia('(prefers-color-scheme: dark)')
	set_theme(match_media)

	match_media.addEventListener('change', set_theme)

	return function cleanup() {
		match_media.removeEventListener('change', set_theme)
	}
}

export function setup(app: Component) {
	let target: HTMLDivElement | null = document.querySelector('#app')

	if (!target) {
		// In production, `#app` may or may not exist.
		target = document.createElement('div')
		target.id = 'app'
		document.body.appendChild(target)
	}

	mode_setter()
	mount(app, { target })

	// This error replaces another error which message is harder to understand and impossible to avoid util the issue https://github.com/storyblok/field-plugin/issues/107 has been resolved.
	throw new Error(
		`This error can be safely ignored. It is caused by the legacy field plugin API. See issue https://github.com/storyblok/field-plugin/issues/107`
	)
}
