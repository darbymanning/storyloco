import { expect, test } from 'bun:test'
import { sort_dates, to_entry, to_utc, type Row } from './src/dates.js'

test('to_utc follows the zone, DST included', () => {
	expect(to_utc('2026-09-15', '11:00', 'Europe/London')).toBe('2026-09-15T10:00:00.000Z')
	expect(to_utc('2026-12-15', '11:00', 'Europe/London')).toBe('2026-12-15T11:00:00.000Z')
	expect(to_utc('2026-09-15', '11:00', 'America/New_York')).toBe('2026-09-15T15:00:00.000Z')
	expect(to_utc('2026-09-15', '09:00', 'Asia/Kolkata')).toBe('2026-09-15T03:30:00.000Z')
	expect(to_utc('2026-09-15', '00:30', 'Asia/Tokyo')).toBe('2026-09-14T15:30:00.000Z')
	expect(to_utc('2026-09-15', '11:00', 'UTC')).toBe('2026-09-15T11:00:00.000Z')
	// London skips 01:00–02:00 on 29 Mar: 01:30 lands after the jump, at 02:30 BST
	expect(to_utc('2026-03-29', '01:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z')
	// and repeats it on 25 Oct: the later 01:30, in GMT
	expect(to_utc('2026-10-25', '01:30', 'Europe/London')).toBe('2026-10-25T01:30:00.000Z')
	// either side of the change
	expect(to_utc('2026-03-29', '00:30', 'Europe/London')).toBe('2026-03-29T00:30:00.000Z')
	expect(to_utc('2026-03-29', '03:00', 'Europe/London')).toBe('2026-03-29T02:00:00.000Z')
})

const row = (fields: Partial<Row>): Row => ({
	id: 'x',
	start_date: '2026-09-15',
	start_time: null,
	end_date: null,
	end_time: null,
	...fields,
})

test('to_entry: instants only where there is a time, no id', () => {
	expect(to_entry(row({}), 'Europe/London')).toEqual({
		start_date: '2026-09-15',
		start_time: null,
		end_date: null,
		end_time: null,
		utc_start: null,
		utc_end: null,
	})
	expect(
		to_entry(
			row({ start_time: '11:00', end_date: '2026-10-22', end_time: '11:30' }),
			'Europe/London'
		)
	).toEqual({
		start_date: '2026-09-15',
		start_time: '11:00',
		end_date: '2026-10-22',
		end_time: '11:30',
		utc_start: '2026-09-15T10:00:00.000Z',
		utc_end: '2026-10-22T10:30:00.000Z',
	})
	// same-day end uses start_date; an end time without a start time is dropped
	expect(to_entry(row({ start_time: '09:00', end_time: '17:00' }), 'UTC').utc_end).toBe(
		'2026-09-15T17:00:00.000Z'
	)
	expect(to_entry(row({ start_time: '', end_time: '17:00' }), 'UTC')).toMatchObject({
		start_time: null,
		end_time: null,
		utc_end: null,
	})
})

test('sort_dates orders by start, all-day first, undated last', () => {
	const rows = [
		row({ id: 'e', start_date: '' }),
		row({ id: 'c', start_date: '2026-10-30' }),
		row({ id: 'b', start_time: '13:00' }),
		row({ id: 'a' }),
		row({ id: 'd', start_date: '2024-01-01', start_time: '23:00' }),
	]
	expect(sort_dates(rows).map((r) => r.id)).toEqual(['d', 'a', 'b', 'c', 'e'])
})
