export interface Ticketsource {
	event: string
	dates: Array<{
		id: string
		start: string
		price: string
	}>
}
