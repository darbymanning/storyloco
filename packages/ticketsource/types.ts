export interface Ticketsource {
	event: string
	dates: Array<{
		id: string
		start: string
		price: string
	}>
}

export interface PaginatedResponse<T> {
	data: T
	links: {
		first: string
		last: string | null
		prev: string | null
		next: string | null
	}
	meta: {
		current_page: number
		from: number
		path: string
		per_page: number
		to: number
	}
}

export type ListEventsResponse = PaginatedResponse<
	Array<{
		id: string
		type: string
		attributes: {
			name: string
			reference: string
			description: string
			comment: string
			keywords: string
			terms: string
			category: string
			genre: string
			images: Array<{
				type: string
				src: string
			}>
			third_party_consent: {
				capture: boolean
				name: string
				show_consent: {
					email: boolean
					post: boolean
					sms: boolean
				}
			}
			activated: boolean
			archived: boolean
			public: boolean
			settled: boolean
			created_at: string
			updated_at: string
		}
		links: {
			self: string
			venues: string
			dates: string
		}
		venues?: EventVenuesResponse['data']
		dates?: EventDatesResponse['data']
		count?: number
	}>
>

export type EventVenuesResponse = PaginatedResponse<
	Array<{
		id: string
		type: string
		attributes: {
			name: string
			address: {
				line_1: string
				line_2: string
				line_3: string
				line_4: string
				postcode: string
			}
			boxoffice: {
				telephone: string
				email: string
			}
			created_at: string
			updated_at: any
		}
		links: {
			self: string
			dates: string
			event: string
		}
	}>
>

export type EventDatesResponse = PaginatedResponse<
	Array<{
		id: string
		type: string
		attributes: {
			doors_open: any
			start: string
			end: string
			on_sale: boolean
			on_sale_start: string
			on_sale_end: string
			public: boolean
			cancelled: boolean
			created_at: string
			updated_at: string
		}
		links: {
			self: string
			book_now: string
			bookings: string
			event: string
			venue: string
		}
	}>
>
