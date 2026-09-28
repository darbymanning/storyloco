// Storyblok space backups in R2. A daily cron queues every space our token can see, and the queue backs
// each one up. The space plugin (public/index.html) lists backups, queues one on demand, and restores a story.
// Plugin requests carry Storyblok's App Bridge JWT, which pins them to the space it was issued for.
// ponytail: EU region only (mapi.storyblok.com). Spaces in other regions need their own API host.
const MAPI = 'https://mapi.storyblok.com/v1'
const PER_PAGE = 100

class ApiError extends Error {
	constructor(status, message) {
		super(message)
		this.status = status
	}
}

async function mapi(env, path, init = {}, tries = 6) {
	const res = await fetch(MAPI + path, {
		...init,
		headers: { authorization: env.STORYBLOK_TOKEN, 'content-type': 'application/json' }
	})
	if (res.status === 429 && tries > 1) {
		await new Promise(r => setTimeout(r, 1000 * (7 - tries)))
		return mapi(env, path, init, tries - 1)
	}
	if (!res.ok)
		throw new ApiError(res.status, `Storyblok ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`)
	return res.json()
}

async function paged(env, path, key) {
	const out = []
	for (let page = 1; ; page++) {
		const items = (await mapi(env, `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`))[
			key
		]
		out.push(...items)
		if (items.length < PER_PAGE) return out
	}
}

// ponytail: 4 at a time keeps under the Management API rate limit; 429s back off in mapi().
async function each(items, fn, n = 4) {
	let i = 0
	await Promise.all(
		Array.from({ length: n }, async () => {
			while (i < items.length) await fn(items[i++])
		})
	)
}

// The stories list omits `content`, and the CDN drops field-level translations, so each story is read on its own.
// ponytail: one request per story. A space with tens of thousands of stories will outrun the queue's 15 minutes.
// ponytail: asset binaries aren't copied, only their metadata and CDN urls (same as the old GitHub Action).
async function backup(env, id) {
	const s = `/spaces/${id}`
	const { space } = await mapi(env, s)
	const stories = await paged(env, `${s}/stories`, 'stories')
	await each(stories, async story => {
		if (!story.is_folder) story.content = (await mapi(env, `${s}/stories/${story.id}`)).story.content
	})
	const datasources = await paged(env, `${s}/datasources`, 'datasources')
	// ponytail: default dimension only. Add a pass per dimension if a space uses them.
	await each(datasources, async d => {
		d.entries = await paged(env, `${s}/datasource_entries?datasource_id=${d.id}`, 'datasource_entries')
	})
	const data = {
		created_at: new Date().toISOString(),
		space,
		stories,
		components: (await mapi(env, `${s}/components`)).components,
		component_groups: (await mapi(env, `${s}/component_groups`)).component_groups,
		datasources,
		assets: await paged(env, `${s}/assets`, 'assets'),
		asset_folders: (await mapi(env, `${s}/asset_folders`)).asset_folders
	}
	const gz = await new Response(
		new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))
	).arrayBuffer()
	const key = `${id}/${data.created_at.slice(0, 19).replace(/:/g, '-')}.json.gz`
	await env.BACKUPS.put(key, gz, {
		httpMetadata: { contentType: 'application/gzip' },
		customMetadata: { stories: String(stories.length) }
	})
	console.log(
		`Backed up space ${id} (${space.name}): ${stories.length} stories, ${gz.byteLength} bytes to ${key}`
	)
}

async function read(env, key) {
	const obj = await env.BACKUPS.get(key)
	if (!obj) throw new ApiError(404, 'Backup not found')
	return new Response(obj.body.pipeThrough(new DecompressionStream('gzip'))).json()
}

// Writes the backed-up content back as a draft. Storyblok keeps the overwritten version in the story's history.
// A story deleted since is recreated, under its old folder if that still exists, and gets a new id.
async function restore(env, id, key, story_id) {
	const story = (await read(env, key)).stories.find(s => s.id === story_id && !s.is_folder)
	if (!story) throw new ApiError(404, 'Story not in this backup')
	const s = `/spaces/${id}/stories`
	const fields = { name: story.name, slug: story.slug, content: story.content }
	const exists = await mapi(env, `${s}/${story_id}`).then(
		() => true,
		e => (e.status === 404 ? false : Promise.reject(e))
	)
	if (exists) {
		await mapi(env, `${s}/${story_id}`, {
			method: 'PUT',
			body: JSON.stringify({ story: fields, force_update: '1' })
		})
		return { recreated: false, id: story_id }
	}
	const parent =
		story.parent_id &&
		(await mapi(env, `${s}/${story.parent_id}`).then(
			() => story.parent_id,
			() => 0
		))
	const created = await mapi(env, s, {
		method: 'POST',
		body: JSON.stringify({
			story: { ...fields, parent_id: parent || 0, is_startpage: story.is_startpage, tag_list: story.tag_list }
		})
	})
	return { recreated: true, id: created.story.id }
}

const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

// App Bridge JWT: HS256, signed with the plugin's client secret, carrying space_id, user_id and exp.
async function verify(request, env) {
	try {
		const [header, payload, sig] = (request.headers.get('authorization') ?? '')
			.replace(/^Bearer /, '')
			.split('.')
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(env.STORYBLOK_CLIENT_SECRET),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		)
		if (!(await crypto.subtle.verify('HMAC', key, b64(sig), new TextEncoder().encode(`${header}.${payload}`))))
			return null
		const claims = JSON.parse(new TextDecoder().decode(b64(payload)))
		return claims.exp * 1000 > Date.now() && claims.space_id ? claims : null
	} catch {
		return null
	}
}

const json = (data, status = 200) => Response.json(data, { status })

async function api(request, env, url) {
	const claims = await verify(request, env)
	if (!claims) return json({ message: 'Invalid or expired Storyblok token' }, 401)
	const id = claims.space_id
	const [, , , name, action, story_id] = url.pathname.split('/') // /api/backups/:name/(download|stories)/:story_id?

	if (!name) {
		if (request.method === 'POST') {
			await env.QUEUE.send(id)
			return json({ queued: true }, 202)
		}
		const { objects } = await env.BACKUPS.list({ prefix: `${id}/`, include: ['customMetadata'] })
		// ponytail: newest 1000 is a list() page; R2 lists keys in order, and ISO names sort by date.
		return json(
			objects.reverse().map(o => ({
				name: o.key.slice(`${id}/`.length),
				uploaded: o.uploaded,
				size: o.size,
				stories: +(o.customMetadata?.stories ?? 0)
			}))
		)
	}

	if (!/^[\w-]+\.json\.gz$/.test(name)) return json({ message: 'Bad backup name' }, 400)
	const key = `${id}/${name}`

	if (action === 'download') {
		const obj = await env.BACKUPS.get(key)
		if (!obj) return json({ message: 'Backup not found' }, 404)
		return new Response(obj.body, { headers: { 'content-type': 'application/gzip' } })
	}
	if (action === 'stories' && !story_id) {
		const { stories } = await read(env, key)
		return json(stories.filter(s => !s.is_folder).map(s => ({ id: s.id, name: s.name, full_slug: s.full_slug })))
	}
	if (action === 'stories' && request.method === 'POST') {
		console.log(`User ${claims.user_id} restoring story ${story_id} in space ${id} from ${name}`)
		return json(await restore(env, id, key, Number(story_id)))
	}
	return json({ message: 'Not found' }, 404)
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		if (!url.pathname.startsWith('/api/backups')) return env.ASSETS.fetch(request)
		try {
			return await api(request, env, url)
		} catch (e) {
			console.error(e)
			return json({ message: e.message }, e.status ?? 500)
		}
	},

	// Queue every space the token can see, one message each, so a slow space can't starve the rest.
	async scheduled(_, env) {
		const { spaces } = await mapi(env, '/spaces')
		for (let i = 0; i < spaces.length; i += 100)
			await env.QUEUE.sendBatch(spaces.slice(i, i + 100).map(s => ({ body: s.id })))
		console.log(`Queued ${spaces.length} space backups`)
	},

	async queue(batch, env) {
		for (const message of batch.messages) await backup(env, message.body)
	}
}
