import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { HubspotForm } from '../types.js'
import ky from 'ky'

type Plugin = FieldPluginResponse<HubspotForm | null>

export class HubspotFormManager {
	plugin = $state<Plugin | null>(null)
	content = $state<HubspotForm | null>(null)
	forms = $state<Array<HubspotForm> | null>(null)
	#fetch_error = $state<string | null>(null)
	#loading_forms = $state(false)
	// deriveds must stay pure (assigning state inside one throws), so missing
	// options are their own derived and fold into `error` below
	#portal: string | null = null
	// the HubSpot space plugin fills this in; without it there's no portal to list
	missing_options = $derived(
		this.plugin?.type === 'loaded' && !this.plugin.data.options.MOXY_HUBSPOT_SECRET_ID
	)
	#api = $derived.by(() => {
		if (this.plugin?.type !== 'loaded' || this.missing_options) return null

		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api/hubspot/',
			headers: {
				Authorization: `Bearer ${this.plugin.data.options.MOXY_HUBSPOT_SECRET_ID}`,
			},
		})
	})
	error = $derived(this.missing_options ? null : this.#fetch_error)
	loading = $derived(
		this.#loading_forms || (this.forms === null && !this.error && !this.missing_options)
	)

	constructor() {
		$effect(() => {
			if (this.#api && !this.forms && !this.#loading_forms) this.get_forms()
		})

		this.initialize_plugin()
	}

	get_forms = async () => {
		if (!this.#api) throw new Error('API not initialized')
		if (this.#loading_forms) return

		this.#loading_forms = true

		try {
			const response = await this.#api
				.get('forms')
				.json<{ portal: string; results: Array<HubspotForm> }>()
			this.#portal = response.portal
			this.forms = response.results
			this.#fetch_error = null
		} catch (error: any) {
			const status = error?.response?.status
			this.#fetch_error =
				status === 401
					? 'This field’s HubSpot connection was replaced. Open HubSpot from the Apps menu to set it up again.'
					: status === 409
						? 'HubSpot no longer accepts this space’s connection. Reconnect it from the HubSpot app.'
						: 'Could not load forms from HubSpot'
		} finally {
			this.#loading_forms = false
		}
	}

	private initialize_plugin() {
		createFieldPlugin<HubspotForm>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.data?.content) this.content = state.data.content
			},
		})
	}

	select = (id: string) => {
		const form = this.forms?.find((form) => form.id === id)
		this.content = form ? { ...form, ...(this.#portal && { portal: this.#portal }) } : null
		if (this.plugin?.type !== 'loaded') return
		this.plugin.actions.setContent(this.content ? $state.snapshot(this.content) : null)
	}
}
