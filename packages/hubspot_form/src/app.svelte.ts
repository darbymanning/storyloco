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
	#missing_options = $derived(
		this.plugin?.type === 'loaded' &&
			!(this.plugin.data.options.HUBSPOT_PROXY_URL && this.plugin.data.options.HUBSPOT_PROXY_TOKEN)
	)
	#api = $derived.by(() => {
		if (this.plugin?.type !== 'loaded' || this.#missing_options) return null
		const { HUBSPOT_PROXY_URL, HUBSPOT_PROXY_TOKEN } = this.plugin.data.options

		return ky.create({
			prefixUrl: HUBSPOT_PROXY_URL,
			headers: {
				Authorization: `Bearer ${HUBSPOT_PROXY_TOKEN}`,
			},
		})
	})
	error = $derived(
		this.#missing_options
			? 'HUBSPOT_PROXY_URL and HUBSPOT_PROXY_TOKEN options are required'
			: this.#fetch_error
	)
	loading = $derived(this.#loading_forms || (this.forms === null && !this.error))

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
			const response = await this.#api.get('forms').json<{ results: Array<HubspotForm> }>()
			this.forms = response.results
			this.#fetch_error = null
		} catch (error: any) {
			this.#fetch_error =
				error?.response?.status === 401
					? 'HUBSPOT_PROXY_TOKEN was rejected by the proxy'
					: 'Could not load forms from the proxy'
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
		this.content = this.forms?.find((form) => form.id === id) ?? null
		if (this.plugin?.type !== 'loaded') return
		this.plugin.actions.setContent(this.content ? $state.snapshot(this.content) : null)
	}
}
