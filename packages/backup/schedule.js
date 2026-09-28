// When a space's backups run. Hours, weekdays and days of the month are in the schedule's own timezone.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function local(date, timezone) {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: timezone,
		hour: 'numeric',
		hourCycle: 'h23',
		weekday: 'short',
		day: 'numeric'
	}).formatToParts(date)
	const part = type => parts.find(p => p.type === type).value
	return { hour: +part('hour'), weekday: WEEKDAYS.indexOf(part('weekday')), day: +part('day') }
}

// ponytail: matched on the local hour, so a DST change can skip or double one backup a year.
export function due(schedule, date) {
	if (schedule.frequency === 'off') return false
	const t = local(date, schedule.timezone)
	if (t.hour !== schedule.hour) return false
	if (schedule.frequency === 'weekly') return t.weekday === schedule.weekday
	if (schedule.frequency === 'monthly') return t.day === schedule.day
	return true
}

export function next_at(schedule, now = new Date()) {
	const start = Math.floor(now / 36e5 + 1) * 36e5
	for (let h = 0; h < 24 * 32; h++) {
		const date = new Date(start + h * 36e5)
		if (due(schedule, date)) return date.toISOString()
	}
	return null
}

export function parse_schedule(body) {
	const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
	if (!['daily', 'weekly', 'monthly', 'off'].includes(body?.frequency)) return null
	// Days 1 to 28 run every month.
	if (!int(body.hour, 0, 23) || !int(body.weekday, 0, 6) || !int(body.day, 1, 28)) return null
	try {
		new Intl.DateTimeFormat('en', { timeZone: body.timezone })
	} catch {
		return null
	}
	const { frequency, hour, weekday, day, timezone } = body
	return { frequency, hour, weekday, day, timezone }
}
