import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Heading } from '../types.js'

// no need for lodash here, svelte reactivity is enough for this simple type

type Plugin = FieldPluginResponse<Heading | null>

export class HeadingManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Heading>({ text: '', level: 1 })

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<Heading>({
			validateContent: (content) => {
				if (typeof content !== 'object' || content === null) {
					return { content: { text: '', level: 1 } }
				}

				const validated = content as Heading

				// ensure level is one of the allowed values
				if (![1, 2, 3, 4, 5, 6].includes(validated.level)) {
					validated.level = 1
				}

				// ensure text is a string
				if (typeof validated.text !== 'string') validated.text = ''

				return { content: validated }
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
