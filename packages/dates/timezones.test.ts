import { expect, test } from 'bun:test'
import { filter_zones, list_zones } from './src/timezones.js'

const summer = new Date('2025-07-01T12:00:00Z')
const zones = list_zones(summer)
const ids = (query: string) => filter_zones(zones, query).map((zone) => zone.id)

test('list covers the world plus UTC, sorted by city', () => {
	expect(zones.length).toBeGreaterThan(300)
	expect(zones.find((zone) => zone.id === 'UTC')?.flag).toBe('🌐')
	const cities = zones.map((zone) => zone.city)
	expect(cities).toEqual([...cities].sort((a, b) => a.localeCompare(b)))
	expect(zones.find((zone) => zone.id === 'Europe/London')).toMatchObject({
		city: 'London',
		country: 'United Kingdom',
		flag: '🇬🇧',
		abbr: 'BST',
		offset: 'GMT+1',
		time: '13:00',
	})
})

test('search by city, country, abbreviation and offset', () => {
	expect(ids('london')[0]).toBe('Europe/London')
	expect(ids('france')).toEqual(['Europe/Paris'])
	expect(ids('bst')).toContain('Europe/London')
	expect(ids('utc+9')).toContain('Asia/Tokyo')
	// engines disagree on the canonical id (America/Buenos_Aires vs America/Argentina/Buenos_Aires)
	expect(filter_zones(zones, 'buenos').map((zone) => zone.city)).toEqual(['Buenos Aires'])
	expect(ids('new york')[0]).toBe('America/New_York')
	expect(ids('zzzz')).toEqual([])
})
