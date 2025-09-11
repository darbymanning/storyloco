import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Time } from '../types.js'

type Plugin = FieldPluginResponse<Time | null | ''>

export class TimeManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Time>('')

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<Time>({
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
