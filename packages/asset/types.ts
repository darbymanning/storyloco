export interface Asset {
	id?: string
	filename?: string
	meta_data?: {
		alt?: string | null
		title?: string | null
		source?: string | null
		copyright?: string | null
		width?: number | null
		height?: number | null
		format?: string | null
	}
}
