export interface Asset {
	id: string
	filename?: string
	meta_data?: {
		alt?: string
		title?: string
		source: string
		copyright?: string
		width: number
		height: number
		format: string
	}
}
