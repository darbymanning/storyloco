import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Ticketsource } from '../types.js'
import ky from 'ky'
import { format_date } from 'kitto'
import type { TicketsauceEvent, ListEventsResponse } from 'moxyloco/ticketsauce-types'

type Plugin = FieldPluginResponse<Ticketsource | null>

export class TicketSourceManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Ticketsource>({ event: '', dates: [] })
	events = $state<Array<TicketsauceEvent> | null>(null)
	#loading_events = $state(false)
	#api = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null
		const secret = this.plugin.data.options.MOXY_TICKETSOURCE_SECRET_ID

		if (!secret) {
			console.error('MOXY_TICKETSOURCE_SECRET_ID is not set')
			return null
		}

		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api',
			headers: {
				Authorization: `Bearer ${secret}`,
			},
		})
	})
	loading = $derived(this.#loading_events || this.events === null)

	constructor() {
		$effect(() => {
			if (this.#api && !this.events && !this.#loading_events) this.get_events()
		})

		this.initialize_plugin()
	}

	get_events = async () => {
		if (!this.#api) throw new Error('API not initialized')
		if (this.#loading_events) return

		this.#loading_events = true

		try {
			const all_events: Array<TicketsauceEvent> = []
			let page = 1
			let has_more = true

			while (has_more) {
				try {
					const response = await this.#api
						.get(`ticketsauce?page=${page}`)
						.json<ListEventsResponse<Array<TicketsauceEvent>>>()

					all_events.push(...response.data)
					has_more = response.meta.has_next
					page++
				} catch (error: any) {
					// if we get a 401, stop retrying - auth is fucked
					if (error?.response?.status === 401) {
						console.error('ticketsauce api returned 401 - stopping pagination')
						break
					}
					throw error
				}
			}

			this.events = all_events
			return all_events
		} finally {
			this.#loading_events = false
		}
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
