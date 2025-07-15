export interface Heading {
	text: string
	level: 1 | 2 | 3 | 4 | 5 | 6 | null
	tag: `h${Exclude<Heading['level'], null>}` | null
}
