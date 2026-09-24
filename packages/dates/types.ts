export interface DateEntry {
	/** `YYYY-MM-DD`, wall-clock in the field's `timezone` */
	start_date: string
	/** `HH:mm`; `null` makes this an all-day entry */
	start_time: string | null
	/** `YYYY-MM-DD`; `null` means the same day as `start_date` */
	end_date: string | null
	/** `HH:mm`; only set when `start_time` is */
	end_time: string | null
	/** the start as an ISO instant, e.g. `2026-09-15T10:00:00.000Z`; `null` for all-day entries, which are dates, not moments */
	utc_start: string | null
	/** the end as an ISO instant; `null` without an `end_time` */
	utc_end: string | null
}

export interface Dates {
	/** IANA zone the editor picked, e.g. `Europe/London` */
	timezone: string
	dates: DateEntry[]
}
