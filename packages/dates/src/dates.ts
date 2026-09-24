import type { DateEntry } from '../types.js'

/** What the editor works with: the typed fields plus a key that follows the row through drags and sorts. */
export type Row = Pick<DateEntry, 'start_date' | 'start_time' | 'end_date' | 'end_time'> & {
	id: string
}

// ms `zone` is ahead of UTC at `instant`
function offset_at(zone: string, instant: number): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
		})
			.formatToParts(instant)
			.map((part) => [part.type, Number(part.value)])
	)
	const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
	return wall - Math.floor(instant / 60_000) * 60_000
}

/**
 * Wall-clock `date` + `time` in `zone` as an ISO instant: `('2026-09-15', '11:00', 'Europe/London')` → `2026-09-15T10:00:00.000Z`.
 * A time the clocks skip (01:30 when they go forward) lands after the jump; one they repeat gets the later of the two.
 */
export function to_utc(date: string, time: string, zone: string): string {
	const wall = Date.parse(`${date}T${time}Z`)
	// the first guess uses the offset at the wrong instant, which can sit across a DST change; the second settles it
	const guess = wall - offset_at(zone, wall)
	return new Date(wall - offset_at(zone, guess)).toISOString()
}

/** A row as it's stored: optional fields as `null`, UTC instants added, the editor's `id` dropped. */
export function to_entry({ start_date, ...row }: Row, zone: string): DateEntry {
	const start_time = row.start_time || null
	const end_date = row.end_date || null
	// an end time means nothing without a start time
	const end_time = (start_time && row.end_time) || null
	return {
		start_date,
		start_time,
		end_date,
		end_time,
		utc_start: start_time ? to_utc(start_date, start_time, zone) : null,
		utc_end: end_time ? to_utc(end_date ?? start_date, end_time, zone) : null,
	}
}

// '~' sorts after any digit, so a row still missing its start date goes last
const sort_key = (row: Pick<Row, 'start_date' | 'start_time'>) =>
	row.start_date ? `${row.start_date}T${row.start_time ?? ''}` : '~'

/** Sorts in place by start, earliest first. All-day comes before timed on the same day; undated goes last. */
export function sort_dates<T extends Pick<Row, 'start_date' | 'start_time'>>(rows: T[]): T[] {
	return rows.sort((a, b) => (sort_key(a) < sort_key(b) ? -1 : sort_key(a) > sort_key(b) ? 1 : 0))
}
