import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import type { R2Asset, R2FolderTree } from '../r2.js'
import { SvelteMap } from 'svelte/reactivity'
import { toast } from 'shared'
import AssetPicker from './app.svelte'
import { mount, unmount } from 'svelte'

type Content = Asset | Array<Asset> | null
type Plugin = FieldPluginResponse<Content>

export interface Props {
	plugin?: Plugin
	onselect?: (asset: Asset) => void
	oncancel?: () => void
}

export type View =
	| { kind: 'all' }
	| { kind: 'unused' }
	| { kind: 'trash' }
	| { kind: 'folder'; id: string }
export type Kind = '' | 'image' | 'video' | 'audio' | 'document'
export type Story = { id: number; name: string; slug: string }
type Upload = {
	name: string
	progress: number
	status: 'uploading' | 'done' | 'failed'
	error?: string
}

const API = 'https://assets.uilo.co/api/r2'
const PAGE_SIZE = 60

// per-browser preferences, like Storyblok's own; storage can be unavailable in private windows
const remembered = (key: string, fallback: string) => {
	try {
		return localStorage.getItem(`uiloco-asset:${key}`) || fallback
	} catch {
		return fallback
	}
}
const remember = (key: string, value: string) => {
	try {
		localStorage.setItem(`uiloco-asset:${key}`, value)
	} catch {
		// not remembered, which is fine
	}
}

// The field's state and actions. Opening the picker or a file's details goes through Storyblok's modal, which
// can remount the plugin, so where the modal should land is also kept in sessionStorage.
export class AssetManager {
	plugin: Plugin | null = $state(null)
	content: Content = $state(null)
	readonly loaded = $derived(this.plugin?.type === 'loaded')
	readonly link = $derived(this.plugin?.data?.options.link === 'true')
	readonly multiple = $derived(this.plugin?.data?.options.multiple === 'true' && !this.link)
	readonly #secret = $derived(this.plugin?.data?.options.MOXY_R2_SECRET_ID ?? '')
	readonly bucket = $derived(this.plugin?.data?.options.R2_BUCKET ?? '')
	// the R2 Assets space plugin fills these in; without them there's nothing to browse
	readonly configured = $derived(!!this.#secret && !!this.bucket)
	readonly is_modal_open = $derived(this.loaded && !!this.plugin?.data?.isModalOpen)

	// the modal shows either the file browser or one file's details
	details: R2Asset | null = $state(null)
	details_from_picker = $state(false)
	replace_index: number | null = $state(null)
	readonly screen = $derived(!this.is_modal_open ? 'field' : this.details ? 'details' : 'picker')

	// browser
	view: View = $state({ kind: 'all' })
	search = $state('')
	kind: Kind = $state('')
	sort = $state(remembered('sort', '-created_at'))
	assets: Array<R2Asset> | null = $state(null)
	total = $state(0)
	all_total: number | null = $state(null)
	unused_total: number | null = $state(null)
	#page = 0
	loading_more = $state(false)
	readonly more = $derived(!!this.assets && this.assets.length < this.total)
	folders: Array<R2FolderTree> = $state([])
	readonly flat = $derived.by(() => {
		const out: Array<{ folder: R2FolderTree; depth: number; path: string }> = []
		const walk = (list: Array<R2FolderTree>, depth: number, path: string) =>
			list.forEach((folder) => {
				const here = path ? `${path} / ${folder.name}` : folder.name
				out.push({ folder, depth, path: here })
				walk(folder.children ?? [], depth + 1, here)
			})
		walk(this.folders, 0, '')
		return out
	})
	readonly folder = $derived(
		this.view.kind === 'folder'
			? this.flat.find((f) => f.folder.id === (this.view as { id: string }).id)?.folder
			: undefined
	)
	busy = $state(false)

	// selection: ids, plus the assets themselves so a selection can span pages
	selected = new SvelteMap<string, R2Asset>()
	#anchor: string | null = null

	// usage, from the R2 Assets usage index (null until known; indexed is false for spaces it hasn't scanned)
	usage: Record<string, Array<Story>> = $state({})
	indexed: boolean | null = $state(null)

	uploads: Array<Upload> = $state([])

	readonly in_field = $derived(
		new Set(
			(Array.isArray(this.content) ? this.content : this.content ? [this.content] : []).map(
				(a) => a._data.id
			)
		)
	)

	onselect?: (asset: Asset) => void
	oncancel?: () => void
	#initial = true

	constructor({ plugin, onselect, oncancel }: Props) {
		this.onselect = onselect
		this.oncancel = oncancel
		if (plugin) {
			// embedded by the link and SEO fields to pick one file
			this.plugin = plugin
			this.#start()
		} else this.#connect()

		$effect(() => {
			document.documentElement.setAttribute(
				'data-modal-open',
				this.is_modal_open ? 'true' : 'false'
			)
		})
	}

	#connect() {
		createFieldPlugin<Content>({
			enablePortalModal: true,
			validateContent: (content) =>
				typeof content === 'object' ? { content: content as Content } : { content: null },
			onUpdateState: (state) => {
				const was_open = this.is_modal_open
				this.plugin = state as Plugin
				this.content = (state.data?.content as Content) ?? null
				if (state.data?.isModalOpen && !was_open) this.#restore_modal()
				if (!state.data?.isModalOpen) this.details = null
				if (this.#initial) {
					this.#initial = false
					this.#start()
				}
			},
		})
	}

	#start() {
		if (!this.configured) return
		this.#restore_modal()
		this.load()
	}

	// ---- modal

	#restore_modal() {
		try {
			const saved = sessionStorage.getItem('uiloco-asset:modal')
			if (!saved) return
			const { details, from_picker, replace_index } = JSON.parse(saved)
			this.details = details ?? null
			this.details_from_picker = !!from_picker
			this.replace_index = replace_index ?? null
		} catch {
			// nothing to restore
		}
	}

	#set_modal(state: {
		details?: R2Asset | null
		from_picker?: boolean
		replace_index?: number | null
	}) {
		this.details = state.details ?? null
		this.details_from_picker = !!state.from_picker
		this.replace_index = state.replace_index ?? null
		try {
			sessionStorage.setItem('uiloco-asset:modal', JSON.stringify(state))
		} catch {
			// the modal still opens; a remount would just land on the browser
		}
	}

	open_picker = (replace_index: number | null = null) => {
		this.#set_modal({ replace_index })
		this.plugin?.actions?.setModalOpen(true)
	}

	open_details = async (asset: R2Asset, from_picker = this.screen === 'picker') => {
		// the story keeps a copy of the file from when it was picked, which older fields saved without the
		// date, alt text and so on; the library's copy is always current
		if (!from_picker)
			asset = await this.#request<{ data: R2Asset }>(`assets/${asset.id}`).then(
				(res) => res.data,
				() => asset
			)
		this.#set_modal({
			details: asset,
			from_picker,
			replace_index: this.replace_index,
		})
		if (!this.is_modal_open) this.plugin?.actions?.setModalOpen(true)
		if (!(asset.id in this.usage)) this.find_usage([asset])
	}

	close_details = () => {
		if (this.details_from_picker) this.#set_modal({ replace_index: this.replace_index })
		else this.close_modal()
	}

	// the link and SEO fields also get told, so they stop waiting for a file
	close_modal = () => {
		this.#set_modal({})
		this.selected.clear()
		this.oncancel?.()
		this.plugin?.actions?.setModalOpen(false)
	}

	// ---- requests

	async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const headers: Record<string, string> = {
			authorization: `Bearer ${this.#secret}`,
		}
		if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json'
		const res = await fetch(`${API}/${this.bucket}/${path}`, {
			...init,
			headers,
		})
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as {
				error?: string
			} | null
			throw new Error(body?.error ?? `Request failed (${res.status})`)
		}
		return res.status === 204 ? (undefined as T) : res.json()
	}
	#json = (method: string, body: unknown): RequestInit => ({
		method,
		body: JSON.stringify(body),
	})

	// runs an action, showing any failure as a toast
	async run(task: () => Promise<unknown>, { quiet = false } = {}) {
		if (!quiet) this.busy = true
		try {
			await task()
			return true
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e))
			return false
		} finally {
			if (!quiet) this.busy = false
		}
	}

	// ---- browsing

	load = () =>
		this.run(() => Promise.all([this.list(), this.list_folders(), this.count_unused()]), {
			quiet: true,
		})

	async list() {
		this.#page = 1
		const res = await this.#fetch_page(1)
		this.assets = res.data ?? []
		this.total = res.meta?.total ?? this.assets.length
		if (this.view.kind === 'all' && !this.search && !this.kind) this.all_total = this.total
		this.find_usage(this.assets)
	}

	next_page = async () => {
		if (!this.more || this.loading_more) return
		this.loading_more = true
		try {
			const res = await this.#fetch_page(this.#page + 1)
			this.#page++
			const seen = new Set(this.assets?.map((a) => a.id))
			const fresh = (res.data ?? []).filter((a) => !seen.has(a.id))
			this.assets = [...(this.assets ?? []), ...fresh]
			this.find_usage(fresh)
		} finally {
			this.loading_more = false
		}
	}

	#fetch_page(page: number) {
		const params = new URLSearchParams({
			limit: String(PAGE_SIZE),
			page: String(page),
			sort: this.sort,
		})
		if (this.view.kind === 'folder') params.set('folder_id', this.view.id)
		if (this.view.kind === 'trash') params.set('deleted', 'true')
		if (this.view.kind === 'unused') params.set('filter[unused]', 'true')
		if (this.search) params.set('filter[q]', this.search)
		if (this.kind) params.set('filter[type]', this.kind)
		return this.#request<{ data?: Array<R2Asset>; meta?: { total?: number } }>(`assets?${params}`)
	}

	async list_folders() {
		const res = await this.#request<{
			data?: { structured?: Array<R2FolderTree> }
		}>('folders')
		this.folders = res.data?.structured ?? []
	}

	async count_unused() {
		if (this.indexed === false) return
		const res = await this.#request<{ meta?: { total?: number } }>(
			'assets?limit=1&page=1&filter[unused]=true'
		).catch(() => null)
		this.unused_total = res?.meta?.total ?? null
	}

	refresh = () =>
		this.run(() => Promise.all([this.list(), this.list_folders(), this.count_unused()]), {
			quiet: true,
		})

	async find_usage(list: Array<R2Asset>) {
		if (this.view.kind === 'trash' || this.indexed === false) return
		const ids = list.map((a) => a.id).filter((id) => !(id in this.usage))
		for (let i = 0; i < ids.length; i += 200) {
			const res = await this.#request<{
				indexed: boolean
				used: Record<string, Array<Story>>
			}>(`usage?ids=${ids.slice(i, i + 200).join(',')}`).catch(() => null)
			if (!res) return
			this.indexed = res.indexed
			Object.assign(this.usage, res.used)
		}
	}

	go = (view: View) => {
		this.view = view
		this.selected.clear()
		this.run(() => this.list(), { quiet: true })
	}

	#search_timer: ReturnType<typeof setTimeout> | undefined
	search_changed = () => {
		clearTimeout(this.#search_timer)
		this.#search_timer = setTimeout(() => this.run(() => this.list(), { quiet: true }), 300)
	}

	set_sort = (sort: string) => {
		this.sort = sort
		remember('sort', sort)
		this.run(() => this.list(), { quiet: true })
	}

	// ---- selection: click toggles, shift-click takes the range from the last one clicked

	toggle = (asset: R2Asset, range = false) => {
		const list = this.assets ?? []
		const at = list.findIndex((a) => a.id === this.#anchor)
		if (range && at !== -1) {
			const to = list.findIndex((a) => a.id === asset.id)
			const [from, until] = [at, to].sort((a, b) => a - b)
			for (const each of list.slice(from, until + 1)) this.selected.set(each.id, each)
		} else if (this.selected.has(asset.id)) this.selected.delete(asset.id)
		else this.selected.set(asset.id, asset)
		this.#anchor = asset.id
	}
	select_all = () => this.assets?.forEach((a) => this.selected.set(a.id, a))

	// ---- the field's value

	update = () => this.plugin?.actions?.setContent($state.snapshot(this.content))

	// a picked file as the field stores it: Storyblok's asset shape, plus the R2 record
	to_asset = (asset: R2Asset): Asset => {
		const { alt, title, source, copyright, name, focus } = asset.attributes
		return {
			id: asset.id,
			alt,
			filename: asset.links?.self || '',
			focus,
			title,
			source,
			copyright,
			is_external_url: false,
			meta_data: { alt, title, source, copyright },
			name,
			width: asset.attributes.width,
			height: asset.attributes.height,
			format: asset.attributes.format,
			content_type: asset.attributes.content_type,
			size_bytes: asset.attributes.size_bytes,
			_data: asset,
		}
	}

	// picking in the browser: replaces the file being replaced, adds to a list, or sets the one file
	pick = (asset: R2Asset) => {
		const chosen = this.to_asset(asset)
		// the link and SEO fields take the file themselves; like the old picker, this closes their modal
		if (this.onselect) {
			this.onselect(chosen)
			this.plugin?.actions?.setModalOpen(false)
			return
		}
		if (Array.isArray(this.content) && this.replace_index !== null) {
			if (!this.content.some((a) => a._data.id === asset.id))
				this.content[this.replace_index] = chosen
		} else if (this.multiple) {
			const list = Array.isArray(this.content) ? this.content : []
			if (!list.some((a) => a._data.id === asset.id)) this.content = [...list, chosen]
		} else this.content = chosen
		this.update()
		this.close_modal()
	}

	insert_selected = () => {
		const list = Array.isArray(this.content) ? this.content : []
		const fresh = [...this.selected.values()].filter(
			(a) => !list.some((item) => item._data.id === a.id)
		)
		this.content = [...list, ...fresh.map(this.to_asset)]
		this.update()
		this.close_modal()
	}

	remove = (id: string) => {
		if (Array.isArray(this.content)) this.content = this.content.filter((a) => a._data.id !== id)
		else if (this.content?._data.id === id) this.content = null
		this.update()
	}

	// keeps this field's copies of a file in step with its record
	#sync_content = (asset: R2Asset) => {
		const fresh = this.to_asset(asset)
		if (Array.isArray(this.content)) {
			if (!this.content.some((a) => a._data.id === asset.id)) return
			this.content = this.content.map((a) => (a._data.id === asset.id ? fresh : a))
		} else if (this.content?._data.id === asset.id) this.content = fresh
		else return
		this.update()
	}

	// ---- files

	// quiet when the change shows itself, e.g. back in the field
	save = (
		asset: R2Asset,
		changes: Partial<R2Asset['attributes']> & { folder_id?: string | null },
		{ quiet = false } = {}
	) =>
		this.run(async () => {
			await this.#request(`assets/${asset.id}`, this.#json('PATCH', changes))
			const { folder_id: _, ...fields } = changes
			const saved = {
				...asset,
				attributes: { ...asset.attributes, ...fields },
			}
			this.assets = this.assets?.map((a) => (a.id === asset.id ? saved : a)) ?? null
			this.#sync_content(saved)
			if ('folder_id' in changes) await this.refresh()
			if (!quiet) toast.success('Saved')
		})

	move = (ids: Array<string>, folder_id: string | null) =>
		this.run(async () => {
			await this.#request(
				'assets',
				this.#json('PATCH', {
					assets: ids,
					metadata: { folder_id: folder_id ?? '' },
				})
			)
			const into = folder_id ? this.flat.find((f) => f.folder.id === folder_id)?.folder.name : null
			toast.success(`Moved ${count(ids)} ${into ? `to ${into}` : 'out of folders'}`)
			this.selected.clear()
			await this.refresh()
		})

	// deleted files go to the trash, and out of this field
	trash = (ids: Array<string>) =>
		this.run(async () => {
			await this.#request('assets', this.#json('DELETE', ids))
			this.assets = this.assets?.filter((a) => !ids.includes(a.id)) ?? null
			this.total -= ids.length
			if (this.all_total !== null) this.all_total -= ids.length
			ids.forEach((id) => this.selected.delete(id))
			const in_field = ids.filter((id) => this.in_field.has(id))
			in_field.forEach(this.remove)
			toast(`Moved ${count(ids)} to the trash${in_field.length ? ' and out of this field' : ''}`, {
				action: { label: 'Undo', onClick: () => this.restore(ids, true) },
			})
			await Promise.all([this.list_folders(), this.count_unused()])
		})

	restore = (ids: Array<string>, quiet = false) =>
		this.run(async () => {
			await this.#request('assets/restore', this.#json('POST', ids))
			if (!quiet) toast.success(`Restored ${count(ids)}`)
			this.selected.clear()
			await this.refresh()
		})

	destroy = (ids: Array<string>) =>
		this.run(async () => {
			await this.#request('assets?hard=true', this.#json('DELETE', ids))
			toast.success(`Deleted ${count(ids)} for good`)
			this.selected.clear()
			await this.refresh()
		})

	copy = async (text: string) => {
		await navigator.clipboard.writeText(text)
		toast.success('Link copied')
	}

	// XHR rather than fetch, for progress; one file per request so one bad file doesn't sink the rest.
	// Resolves to the uploaded files, so the field can use them straight away.
	upload = async (files: FileList | Array<File> | null) => {
		if (!files?.length || !this.configured) return []
		const folder_id = this.view.kind === 'folder' ? this.view.id : null
		const added: Array<R2Asset> = []
		for (const file of [...files]) {
			this.uploads.push({ name: file.name, progress: 0, status: 'uploading' })
			const entry = this.uploads[this.uploads.length - 1]
			await new Promise<void>((done) => {
				const xhr = new XMLHttpRequest()
				xhr.open('POST', `${API}/${this.bucket}/assets`)
				xhr.setRequestHeader('authorization', `Bearer ${this.#secret}`)
				xhr.upload.onprogress = (e) => e.lengthComputable && (entry.progress = e.loaded / e.total)
				xhr.onload = () => {
					entry.progress = 1
					try {
						const body = JSON.parse(xhr.responseText)
						if (xhr.status < 300) {
							entry.status = 'done'
							added.push(...(body.data ?? []))
						} else {
							entry.status = 'failed'
							entry.error = body.error ?? `Upload failed (${xhr.status})`
						}
					} catch {
						entry.status = xhr.status < 300 ? 'done' : 'failed'
					}
					done()
				}
				xhr.onerror = () => {
					entry.status = 'failed'
					entry.error = 'Network error'
					done()
				}
				const body = new FormData()
				body.append('file', file)
				if (folder_id) body.append('folder_id', folder_id)
				xhr.send(body)
			})
		}
		if (this.view.kind === 'trash' || this.view.kind === 'unused') this.view = { kind: 'all' }
		if (this.all_total !== null) this.all_total += added.length
		await this.refresh()
		// finished uploads leave the tray; failures stay until dismissed
		setTimeout(() => (this.uploads = this.uploads.filter((u) => u.status === 'failed')), 2500)
		return added
	}

	// dropped or chosen straight onto the field: upload, then use them
	upload_into_field = async (files: FileList | Array<File> | null) => {
		const added = await this.upload(files)
		if (!added.length) return
		if (this.multiple) {
			const list = Array.isArray(this.content) ? this.content : []
			this.content = [...list, ...added.map(this.to_asset)]
		} else this.content = this.to_asset(added[0])
		this.update()
	}

	// ---- folders

	create_folder = (name: string, parent_id: string | null) =>
		this.run(async () => {
			await this.#request('folders', this.#json('POST', { name, parent_id }))
			await this.list_folders()
		})

	rename_folder = (folder: R2FolderTree, name: string) =>
		this.run(async () => {
			await this.#request(
				`folders/${folder.id}`,
				this.#json('PATCH', { name, parent_id: folder.parent_id ?? null })
			)
			await this.list_folders()
		})

	move_folder = (folder: R2FolderTree, parent_id: string | null) =>
		this.run(async () => {
			await this.#request(
				`folders/${folder.id}`,
				this.#json('PATCH', { name: folder.name, parent_id })
			)
			const into = parent_id ? this.flat.find((f) => f.folder.id === parent_id)?.folder.name : null
			toast.success(`Moved “${folder.name}” ${into ? `into ${into}` : 'to the top level'}`)
			await this.list_folders()
		})

	delete_folder = (folder: R2FolderTree) =>
		this.run(async () => {
			await this.#request(`folders/${folder.id}`, { method: 'DELETE' })
			if (this.view.kind === 'folder' && this.view.id === folder.id) this.view = { kind: 'all' }
			toast.success(`Deleted “${folder.name}”`)
			await this.refresh()
		})

	// ---- used by the link and SEO fields: shows the browser in place of their UI until a file is picked

	// other fields pass their own plugin (with their own content type), so it's taken loosely
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	static select_asset(plugin: FieldPluginResponse<any> | null) {
		return new Promise<Asset | null>((resolve) => {
			const app = document.body.querySelector('#app') as HTMLElement
			if (document.getElementById('asset_picker_mount') || !app) return
			const target = document.createElement('div')
			target.id = 'asset_picker_mount'
			document.body.appendChild(target)
			app.style.display = 'none'
			// the field only hears back once the browser is gone and its own UI is showing again; handing the file
			// over mid-teardown left the link field showing its old state until something re-rendered it
			const finish = async (asset: Asset | null) => {
				await unmount(picker)
				target.remove()
				app.style.display = 'block'
				resolve(asset)
			}
			const picker = mount(AssetPicker, {
				target,
				props: {
					plugin: plugin as Plugin,
					onselect: (asset) => finish(asset),
					oncancel: () => finish(null),
				},
			})
		})
	}
}

const count = (ids: Array<string>) =>
	ids.length === 1 ? '1 file' : `${ids.length.toLocaleString()} files`

// ---- display helpers

export const is_image = (a: R2Asset) =>
	!!a.attributes.content_type?.startsWith('image/') && !!a.links?.self
export const is_svg = (a: R2Asset) => a.attributes.content_type === 'image/svg+xml'
// formats that can be see-through get a checkerboard behind them
export const may_be_clear = (a: R2Asset) =>
	/^image\/(png|svg\+xml|webp|gif|avif)$/.test(a.attributes.content_type ?? '')
export const thumb = (a: R2Asset, width: number) =>
	is_svg(a) ? a.links!.self! : `${a.links!.self}/m/${width}x0/filters:quality(75)`
export const label = (a: R2Asset) =>
	a.attributes.name || a.attributes.filename.replace(/\.[^.]+$/, '')
export const extension = (a: R2Asset) =>
	(a.attributes.filename.includes('.')
		? a.attributes.filename.split('.').pop()
		: (a.attributes.format ?? 'file'))!.toLowerCase()
export const size = (bytes: number) =>
	bytes < 1024 * 1024
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
export const describe = (a: R2Asset) =>
	[
		`.${extension(a)}`,
		a.attributes.width && `${a.attributes.width}×${a.attributes.height}`,
		size(a.attributes.size_bytes),
	]
		.filter(Boolean)
		.join(' · ')

// a focus point ("x1xy1:x2xy2" in the image's own pixels) as percentages, for object-position and markers
export const focus_of = (a: R2Asset, focus = a.attributes.focus) => {
	const [x, y] = focus?.split(':')[0].split('x').map(Number) ?? []
	const { width, height } = a.attributes
	return width && height && Number.isFinite(x) && Number.isFinite(y)
		? { x: (x / width) * 100, y: (y / height) * 100 }
		: null
}
