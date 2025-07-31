import type { Asset } from '@storyblok/field-plugin'

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
			dimensions: Array<{
				id: UUID
				name: string
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
export type Dimension = Floor['dimensions'][number]
export type Room = Dimension['rooms'][number]
