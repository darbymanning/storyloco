import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { SEO } from '../types.js'

type Plugin = FieldPluginResponse<SEO | null | ''>

export class SEOManager {
	plugin = $state<Plugin | null>(null)
	content = $state<SEO>({})
	loaded = $derived(this.plugin?.type === 'loaded')
	is_modal_open = $derived(this.loaded && this.plugin?.data?.isModalOpen)
	has_r2 = $derived(!!this.plugin?.data?.options.R2_BUCKET)
	/** The extra sections the field's schema asks for: `seo({ include: [...] })` */
	include = $derived((this.plugin?.data?.options.include ?? '').split(','))

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<SEO>({
			enablePortalModal: true,
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				// an emptied field arrives as '' or null, and is as much a new value as any other
				if (state.type === 'loaded') this.content = state.data.content || {}
			},
		})
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return

		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}
}
