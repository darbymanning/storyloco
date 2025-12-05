import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { SEO } from '../types.js'

type Plugin = FieldPluginResponse<SEO | null | ''>

export class SEOManager {
	plugin = $state<Plugin | null>(null)
	content = $state<SEO>({})
	loaded = $derived(this.plugin?.type === 'loaded')
	is_modal_open = $derived(this.loaded && this.plugin?.data?.isModalOpen)
	has_r2 = $derived(!!this.plugin?.data?.options.R2_BUCKET)

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<SEO>({
			enablePortalModal: true,
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
