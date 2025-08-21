import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type {
	Ticketsource,
	ListEventsResponse,
	EventVenuesResponse,
	PaginatedResponse,
	EventDatesResponse,
} from '../types.js'
import ky from 'ky'
import { format_date } from 'kitto'

type Plugin = FieldPluginResponse<Ticketsource | null>

export class HeadingManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Ticketsource>({ event: '' })
	events = $state<ListEventsResponse | null>(null)
	#api = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null
		const secret = this.plugin.data.options.MOXY_TICKETSOURCE_SECRET_ID

		if (!secret) {
			console.error('MOXY_TICKETSOURCE_SECRET_ID is not set')
			return null
		}

		return ky.create({
			prefixUrl: 'https://moxy.admin-54b.workers.dev/api/ticketsource',
			headers: {
				Authorization: `Bearer ${secret}`,
			},
		})
	})
	unique_events = $derived.by(() => {
		if (!this.events) return []
		return this.events.data.filter(
			(event, index) =>
				this.events?.data.findIndex((e) => e.attributes.name === event.attributes.name) === index
		)
	})
	loading = $derived(this.unique_events.length === 0)

	constructor() {
		$effect(() => {
			if (this.#api && !this.events) this.get_events()
		})

		this.initialize_plugin()
	}

	recursive_get = async <T extends PaginatedResponse<any>>(path: string) => {
		if (!this.#api) throw new Error('API not initialized')

		const result = await this.#api.get(path).json<T>()

		while (result.links.next) {
			const next_path = result.links.next.split('/').pop()!
			const next = await this.#api.get(next_path).json<T>()
			result.data.push(...next.data)
			result.links = next.links
		}

		return result
	}

	get_events = async () => {
		if (!this.#api) throw new Error('API not initialized')

		const response = await this.recursive_get<ListEventsResponse>('events?per_page=100')

		response.data = await Promise.all(
			response.data
				.filter((e) => !e.attributes.archived && e.attributes.activated)
				.sort((a, b) => {
					const a_date = new Date(a.attributes.created_at)
					const b_date = new Date(b.attributes.created_at)
					return b_date.getTime() - a_date.getTime()
				})
				.map(async (event) => {
					const dates = (await this.get_event_dates(event.id)).data
					const count = response.data.filter(
						(e) => e.attributes.name === event.attributes.name
					).length

					return {
						...event,
						dates,
						count,
					}
				})
		)

		this.events = response

		return response
	}

	get_event_venues = async (event_id: string) => {
		if (!this.#api) throw new Error('API not initialized')
		return await this.recursive_get<EventVenuesResponse>(`events/${event_id}/venues?per_page=100`)
	}

	get_event_dates = async (event_id: string) => {
		if (!this.#api) throw new Error('API not initialized')
		return await this.recursive_get<EventDatesResponse>(`events/${event_id}/dates?per_page=100`)
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
		const this_event = this.events?.data.find((e) => e.id === this.content.event)
		const events_with_same_name = this.events?.data.filter(
			(e) => e.attributes.name === this_event?.attributes.name
		)
		this.content.dates = events_with_same_name
			?.filter((e) => e.dates && e.dates.length > 0)
			?.map((e) => ({
				id: e.dates![0].id,
				start: format_date('{ddd} {D} {MMM} {YYYY} at {h}:{mm}{a}', e.dates![0].attributes.start),
				price: '',
			}))
		this.update()
	}
}
