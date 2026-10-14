export interface ChurchsuiteCategory {
	id: number
	name: string
	colour?: string
}

// the chosen ChurchSuite calendar category ids; the same shape the legacy
// churchsuite-event-categories plugin saved, so old values load as they are
export type ChurchsuiteCategories = Array<number>
