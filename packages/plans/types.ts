import { Asset } from '@storyblok/field-plugin'

export type UUID = ReturnType<typeof crypto.randomUUID>

export type Types = {
	_active_type?: UUID
	_active_floor?: UUID
	types: Array<{
		id: UUID
		name?: string
		floors: Array<{
			id: UUID
			name: string
			plan?: Asset
			plot_dimensions: Array<{
				id: UUID
				plot_number: number
				rooms: Array<{
					id: UUID
					name: string
					area_m: `${string} x ${string}m`
					area_ft: `${string} x ${string}"`
				}>
			}>
		}>
	}>
}

export type Type = Types['types'][number]
export type Floor = Type['floors'][number]
export type PlotDimension = Floor['plot_dimensions'][number]
export type Room = PlotDimension['rooms'][number]
