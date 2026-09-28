// Backup, list and restore through the real handlers, against a stubbed Storyblok and an in-memory R2.
import { expect, test } from 'bun:test'
import worker from './worker.js'

const secret = 'test-secret'
const stories = {
	1: {
		id: 1,
		name: 'Home',
		slug: 'home',
		full_slug: 'home',
		is_folder: false,
		parent_id: 0,
		content: { component: 'page', title: 'Old' }
	},
	2: { id: 2, name: 'Blog', slug: 'blog', full_slug: 'blog', is_folder: true, parent_id: 0 },
	3: {
		id: 3,
		name: 'Post',
		slug: 'post',
		full_slug: 'blog/post',
		is_folder: false,
		parent_id: 2,
		content: { component: 'post', body: 'Hi' }
	}
}
const writes = []
globalThis.fetch = async (url, init = {}) => {
	const path = new URL(url).pathname.replace('/v1/spaces/42', '')
	if (init.method) {
		writes.push({ method: init.method, path, body: JSON.parse(init.body) })
		return Response.json({ story: { id: 99 } })
	}
	const story = path.match(/^\/stories\/(\d+)$/)
	if (story)
		return stories[story[1]]
			? Response.json({ story: stories[story[1]] })
			: new Response('gone', { status: 404 })
	if (path === '/stories') return Response.json({ stories: Object.values(stories).map(({ content, ...s }) => s) })
	if (path === '') return Response.json({ space: { id: 42, name: 'Test' } })
	if (path === '/datasources') return Response.json({ datasources: [{ id: 7 }] })
	if (path === '/datasource_entries') return Response.json({ datasource_entries: [{ name: 'a', value: 'b' }] })
	const key = path.slice(1)
	return Response.json({ [key]: [{ id: 1 }] })
}

const r2 = new Map()
const env = {
	STORYBLOK_TOKEN: 'pat',
	STORYBLOK_CLIENT_SECRET: secret,
	QUEUE: { send: async () => {} },
	BACKUPS: {
		put: async (key, body, opts) => r2.set(key, { body, ...opts }),
		get: async key => r2.has(key) && { body: new Response(r2.get(key).body).body },
		list: async ({ prefix }) => ({
			objects: [...r2]
				.filter(([k]) => k.startsWith(prefix))
				.map(([key, v]) => ({
					key,
					size: v.body.byteLength,
					uploaded: new Date(),
					customMetadata: v.customMetadata
				}))
		})
	}
}

const b64url = b => Buffer.from(b).toString('base64url')
async function jwt(claims) {
	const data = `${b64url(JSON.stringify({ alg: 'HS256' }))}.${b64url(JSON.stringify(claims))}`
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	)
	return `${data}.${b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))}`
}
const call = async (path, token, method = 'GET') =>
	worker.fetch(new Request(`https://x${path}`, { method, headers: { authorization: `Bearer ${token}` } }), env)

test('backup, list, restore', async () => {
	await worker.queue({ messages: [{ body: { space_id: 42 } }] }, env)
	const token = await jwt({ space_id: 42, user_id: 1, exp: Date.now() / 1000 + 60 })

	expect((await call('/api/backups', 'nope')).status).toBe(401)
	expect((await call('/api/backups', await jwt({ space_id: 42, exp: 1 }))).status).toBe(401)
	// Another space's token can't see this space's backups.
	expect(
		await (await call('/api/backups', await jwt({ space_id: 43, exp: Date.now() / 1000 + 60 }))).json()
	).toEqual([])

	const [backup] = await (await call('/api/backups', token)).json()
	expect(backup.stories).toBe(3)
	expect((await call(`/api/backups/..%2F43%2Fx.json.gz/stories`, token)).status).toBe(400)
	expect(await (await call(`/api/backups/${backup.name}/stories`, token)).json()).toEqual([
		{ id: 1, name: 'Home', full_slug: 'home' },
		{ id: 3, name: 'Post', full_slug: 'blog/post' }
	])

	// Existing story: overwrite its draft.
	expect(await (await call(`/api/backups/${backup.name}/stories/1`, token, 'POST')).json()).toEqual({
		recreated: false,
		id: 1
	})
	expect(writes.pop()).toEqual({
		method: 'PUT',
		path: '/stories/1',
		body: {
			story: { name: 'Home', slug: 'home', content: { component: 'page', title: 'Old' } },
			force_update: '1'
		}
	})

	// Deleted story whose folder is gone too: recreated at the root.
	delete stories[3]
	delete stories[2]
	expect(await (await call(`/api/backups/${backup.name}/stories/3`, token, 'POST')).json()).toEqual({
		recreated: true,
		id: 99
	})
	expect(writes.pop()).toMatchObject({
		method: 'POST',
		path: '/stories',
		body: { story: { slug: 'post', parent_id: 0, content: { body: 'Hi' } } }
	})
})
