import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Dates } from '../types.js'
import { sort_dates, to_entry, type Row } from './dates.js'

type Plugin = FieldPluginResponse<Dates | null | ''>

export const blank = (): Row => ({
	id: crypto.randomUUID(),
	start_date: '',
	start_time: null,
	end_date: null,
	end_time: null,
})

const start_of = (entry: Row) => `${entry.start_date}T${entry.start_time ?? ''}`
const end_of = (entry: Row) =>
	`${entry.end_date || entry.start_date}T${(entry.start_time && entry.end_time) || ''}`

export class DatesManager {
	plugin = $state<Plugin | null>(null)
	entries = $state<Row[]>([])
	#loaded = false

	options = $derived(this.plugin?.type === 'loaded' ? this.plugin.data.options : {})
	// blank or missing: no limit / no minimum
	max = $derived(Number(this.options.max) || Infinity)
	min = $derived(Number(this.options.min) || 0)
	auto_sort = $derived(this.options.auto_sort !== 'false')
	// UTC can't be worked out without one, so it starts as the editor's own
	timezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone)
	can_add = $derived(this.entries.length < this.max)
	can_remove = $derived(this.entries.length > this.min)

	constructor() {
		createFieldPlugin<Dates>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (this.#loaded || state.type !== 'loaded') return
				// ponytail: content is only read once. setContent echoes back here, and swapping the
				// array would detach drag and drop from it; re-read on echo if something else ever writes this field
				this.#loaded = true
				const content = state.data.content
				if (content?.timezone) this.timezone = content.timezone
				// ids only live in the editor, where they keep each row's identity through drags and sorts
				this.entries.push(
					...(content?.dates ?? []).map(({ start_date, start_time, end_date, end_time }) => ({
						id: crypto.randomUUID(),
						start_date,
						start_time,
						end_date,
						end_time,
					}))
				)
				while (this.entries.length < this.min) this.entries.push(blank())
				this.settle()
			},
		})
	}

	is_invalid = (entry: Row) => !!entry.start_date && end_of(entry) < start_of(entry)

	// sorting as you type would move the row out from under you, so it waits until focus leaves it
	settle = () => {
		if (this.auto_sort) sort_dates(this.entries)
	}

	set_timezone = (value: string) => {
		this.timezone = value
		this.update()
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return

		// rows without a start date are still being filled in
		const rows = $state.snapshot(this.entries).filter((row) => row.start_date)
		this.plugin.actions.setContent({
			timezone: this.timezone,
			dates: (this.auto_sort ? sort_dates(rows) : rows).map((row) => to_entry(row, this.timezone)),
		})
	}
}
