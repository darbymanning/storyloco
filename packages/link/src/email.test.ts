import { expect, test } from 'bun:test'
import { looks_like_email } from './email.js'

test('valid addresses pass, however unusual', () => {
	for (const email of [
		'hello@eatechnology.com',
		'first.last+newsletter@mail.example.co.uk',
		"o'connor@example.ie",
		'x@sub.domain.museum',
		'ünïcode@exämple.de',
		'  padded@example.com  ',
	])
		expect(looks_like_email(email)).toBe(true)
})

test('plainly broken ones are caught', () => {
	for (const email of [
		'hello',
		'hello@',
		'@example.com',
		'hello@example',
		'hello@@example.com',
		'hello @example.com',
		'hello@example..com',
		'hello@example.com.',
	])
		expect(looks_like_email(email)).toBe(false)
})
