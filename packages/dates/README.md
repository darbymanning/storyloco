# Dates

A list of dates. Each has a start date, plus an optional start time, end date and end time, all wall-clock
in the field's `timezone`. Editors pick that from the settings button; it starts as their own zone.

```json
{
	"timezone": "Europe/London",
	"dates": [
		{
			"start_date": "2026-09-15",
			"start_time": "11:00",
			"end_date": "2026-10-22",
			"end_time": "11:30",
			"utc_start": "2026-09-15T10:00:00.000Z",
			"utc_end": "2026-10-22T10:30:00.000Z"
		}
	]
}
```

- `utc_start` / `utc_end` are only set where there's a time. An entry without one is all-day: a date, not a moment, so
  converting it to UTC would shift it a day for anyone formatting in another zone.
- A missing `end_date` means the same day. An `end_time` is only kept alongside a `start_time`.

## Options

- `min` — rows that can't be removed (blank or `0` lets editors remove them all); the manifest ships `1`
- `max` — most dates allowed (blank for no limit)
- `auto_sort` — `true` (default) keeps dates in start order; `false` lets editors drag to reorder
