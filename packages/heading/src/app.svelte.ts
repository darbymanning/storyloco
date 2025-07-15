import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Heading } from '../types.js'

// no need for lodash here, svelte reactivity is enough for this simple type

type Plugin = FieldPluginResponse<Heading | null>

export class HeadingManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Heading>({ text: '', level: null, tag: null })

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<Heading>({
			validateContent: (content) => {
				if (typeof content !== 'object' || content === null) {
					return { content: { text: '', level: null, tag: null } }
				}

				let validated = content

				// ensure level is one of the allowed values
				if ('level' in validated) {
					if (typeof validated.level !== 'number') {
						validated.level = null
					} else if (![1, 2, 3, 4, 5, 6].includes(validated.level)) {
						validated.level = 1
					}

					Object.assign(validated, { tag: validated.level ? `h${validated.level}` : null })
				}

				// ensure text is a string
				if ('text' in validated && typeof validated.text !== 'string') {
					validated.text = ''
				}

				return { content: validated as Heading }
			},
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.data?.content) this.content = state.data.content
			},
		})
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return
		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}
}
