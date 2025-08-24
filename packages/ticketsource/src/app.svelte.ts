import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Ticketsource } from '../types.js'
import ky from 'ky'
import { format_date } from 'kitto'
import type { TicketsauceEvent } from 'moxyloco/ticketsauce-types'

type Plugin = FieldPluginResponse<Ticketsource | null>

export class TicketSourceManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Ticketsource>({ event: '', dates: [] })
	events = $state<Array<TicketsauceEvent> | null>(null)
	#api = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null
		const secret = this.plugin.data.options.MOXY_TICKETSOURCE_SECRET_ID

		if (!secret) {
			console.error('MOXY_TICKETSOURCE_SECRET_ID is not set')
			return null
		}

		return ky.create({
			prefixUrl: 'https://moxy.admin-54b.workers.dev/api',
			headers: {
				Authorization: `Bearer ${secret}`,
			},
		})
	})
	loading = $derived(this.events?.length === 0)

	constructor() {
		$effect(() => {
			if (this.#api && !this.events) this.get_events()
		})

		this.initialize_plugin()
	}

	get_events = async () => {
		if (!this.#api) throw new Error('API not initialized')

		const response = await this.#api.get('ticketsauce').json<Array<TicketsauceEvent>>()

		this.events = response

		return response
	}

	private initialize_plugin() {
		createFieldPlugin<Ticketsource>({
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

	setup_event = () => {
		this.update()

		const this_event = this.events?.find((e) => e.id === this.content.event)
		if (!this_event) return

		this.content.dates = this_event.dates.map((d) => ({
			id: d.id,
			start: format_date('{ddd} {D} {MMM} {YYYY} at {h}:{mm}{a}', d.attributes.start),
			price: '',
		}))

		this.update()
	}
}
