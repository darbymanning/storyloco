import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { HubspotForm } from '../types.js'
import { HubspotForms } from './forms.svelte.js'

type Plugin = FieldPluginResponse<HubspotForm | null>

export class HubspotFormManager {
	plugin = $state<Plugin | null>(null)
	content = $state<HubspotForm | null>(null)
	#secret = $derived.by(() =>
		this.plugin?.type === 'loaded' ? this.plugin.data.options.MOXY_HUBSPOT_SECRET_ID : undefined
	)
	// the HubSpot space plugin fills this in; without it there's no portal to list
	missing_options = $derived.by(() => this.plugin?.type === 'loaded' && !this.#secret)
	hubspot = new HubspotForms(() => this.#secret)

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<HubspotForm>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.data?.content) this.content = state.data.content
			},
		})
	}

	select = (form: HubspotForm | null) => {
		this.content = form
		if (this.plugin?.type !== 'loaded') return
		this.plugin.actions.setContent(form ? $state.snapshot(form) : null)
	}
}
