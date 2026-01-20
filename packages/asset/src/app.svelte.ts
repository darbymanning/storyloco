import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import ky from 'ky'
import type { R2Asset, Paths, R2FolderTree } from 'moxyloco/r2'
import { SvelteSet } from 'svelte/reactivity'
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

export class AssetManager {
	plugin: Plugin | null = $state(null)
	readonly loaded = $derived(this.plugin?.type === 'loaded')
	readonly link = $derived(this.plugin?.data?.options.link === 'true')
	readonly multiple = $derived(this.plugin?.data?.options.multiple === 'true' && !this.link)
	content: Content = $state(null)
	selected: Array<R2Asset> = $state([])
	toggle_selected = (asset: R2Asset) => {
		if (this.multiple) {
			this.selected = this.selected.includes(asset)
				? this.selected.filter((a) => a !== asset)
				: [...this.selected, asset]
		} else {
			if (this.selected.includes(asset)) {
				this.selected = this.selected.filter((a) => a !== asset)
			} else {
				this.selected = [asset]
			}
		}
	}
	expanded_folders: Set<string> = $state(new SvelteSet())
	toggle_folder_expansion = (folder_id: string) => {
		if (this.expanded_folders.has(folder_id)) {
			this.expanded_folders.delete(folder_id)
		} else {
			this.expanded_folders.add(folder_id)
		}
	}
	show_deleted = $state(false)
	search_query: string = $state('')
	loading_assets = $state(false)
	active_asset_ids = $derived.by(() => {
		if (Array.isArray(this.content)) return this.content.map((item) => item._data.id)
		return this.content?._data.id ? [this.content?._data.id] : []
	})
	assets: Array<R2Asset> | undefined = $state(undefined)
	folders: Array<R2FolderTree> | undefined = $state(undefined)
	meta: Paths.ListAssets.Responses.$200['meta'] = $state()
	active_asset: R2Asset | null = $derived.by(() => {
		if (sessionStorage.getItem('view') === 'details' && this.is_modal_open) {
			return JSON.parse(sessionStorage.getItem('active_asset') || 'null')
		}
	})
	active_folder = $derived(sessionStorage.getItem('active_folder') || null)
	open_actions: string | null = $state(null)
	is_image = $derived(this.active_asset?.attributes.content_type?.startsWith('image/'))
	limit = 96
	#initial = $state(true)
	#search_timeout: number | null = $state(null)
	readonly #secrets: {
		r2_secret: string
		r2_bucket: string
	} | null = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null

		const r2_secret = this.plugin.data.options.MOXY_R2_SECRET_ID
		const r2_bucket = this.plugin.data.options.R2_BUCKET

		return { r2_secret, r2_bucket }
	})
	focus_x = $derived(this.active_asset?.attributes.focus?.split(':')[0].split('x')[0])
	focus_y = $derived(this.active_asset?.attributes.focus?.split(':')[0].split('x')[1])
	back = $state(false)
	folder_modal = $state(false)
	folder_name = $state('')
	loading = $state(false)
	create_folder_modal = $state(false)
	rename_folder_modal = $state(false)
	move_folder_modal = $state(false)
	active_folder_id = $state<string | null>(null)
	parent_folder_id = $state<string | null>(null)
	move_asset_modal = $state(false)
	item_details_open = $derived.by(() => sessionStorage.getItem('view') === 'details')
	replace_index_target = $derived.by(() => sessionStorage.getItem('replace_index_target') || null)
	onselect?: (asset: Asset) => void
	oncancel?: () => void
	set_modal_open = $derived.by(() => this.plugin?.actions?.setModalOpen || (() => {}))

	constructor({ plugin, onselect, oncancel }: Props) {
		if (plugin) {
			this.plugin = plugin
			this.list_assets(1)
		}
		if (onselect) this.onselect = onselect
		if (oncancel) this.oncancel = oncancel
		if (!plugin) this.initialize_plugin()

		$effect(() => {
			document.documentElement.setAttribute(
				'data-modal-open',
				this.is_modal_open ? 'true' : 'false'
			)
		})
	}

	private initialize_plugin() {
		createFieldPlugin<Asset | null>({
			enablePortalModal: true,
			validateContent(content) {
				if (typeof content !== 'object') return { content: null }
				return { content: content as Asset }
			},
			onUpdateState: (state) => {
				this.plugin = state as Plugin

				if (state.data?.content) {
					if (Array.isArray(state.data.content)) {
						if (!Array.isArray(this.content)) {
							this.content = []
						}
						this.content.splice(0, this.content.length, ...state.data.content)
					} else {
						this.content = state.data.content
					}
				} else {
					this.content = null
				}

				if (!this.#initial) return

				this.#initial = false
				// initial fetch for picker view
				this.list_assets(1)
			},
		})
	}

	static async select_asset(plugin: any) {
		return new Promise<Asset | null>(async (resolve) => {
			const app = document.body.querySelector('#app') as HTMLElement
			if (document.getElementById('asset_picker_mount') || !app) return
			const target = document.createElement('div')
			target.id = 'asset_picker_mount'
			document.body.appendChild(target)
			app.style.display = 'none'

			const picker = mount(AssetPicker, {
				target,
				props: {
					plugin,
					onselect(asset) {
						resolve(asset)
						target.remove()
						app.style.display = 'block'
					},
					async oncancel() {
						resolve(null)
						await unmount(picker, { outro: true })
						target.remove()
						document.body.removeChild(target)
						app.style.display = 'block'
					},
				},
			})
		})
	}

	close_rename_folder_modal = () => {
		this.rename_folder_modal = false
		this.folder_name = ''
		this.active_folder_id = null
	}
	open_rename_folder_modal = (folder: R2FolderTree) => {
		this.rename_folder_modal = true
		this.active_folder_id = folder.id
		this.folder_name = folder.name
		this.parent_folder_id = folder.parent_id || null
	}
	open_move_folder_modal = (folder: R2FolderTree) => {
		this.move_folder_modal = true
		this.active_folder_id = folder.id
		this.folder_name = folder.name
		this.parent_folder_id = folder.parent_id || null
	}
	close_move_folder_modal = () => {
		this.move_folder_modal = false
		this.parent_folder_id = null
	}
	open_create_folder_modal = (parent_folder_id?: string) => {
		this.create_folder_modal = true
		this.parent_folder_id = parent_folder_id || null
	}
	close_create_folder_modal = () => {
		this.create_folder_modal = false
		this.parent_folder_id = null
	}
	open_move_asset_modal = (asset_or_assets: R2Asset | Array<R2Asset>) => {
		this.move_asset_modal = true
		this.selected = Array.isArray(asset_or_assets) ? asset_or_assets : [asset_or_assets]
	}
	close_move_asset_modal = () => {
		this.move_asset_modal = false
		this.active_asset = null
		this.selected = []
	}

	view_folder = (folder_id: string) => {
		if (folder_id) sessionStorage.setItem('active_folder', folder_id)
		this.active_folder = folder_id
		this.show_deleted = false
		this.list_assets(1)
	}

	active_asset_details = (item?: R2Asset) => {
		// Need to set the view to details in sessionStorage to persist the state between modal opens
		if (item) {
			sessionStorage.setItem('view', 'details')
			sessionStorage.setItem('active_asset', JSON.stringify(item))
		}

		if (!this.is_modal_open) this.set_modal_open(true)
		if (!item) return
		this.active_asset = item
		if (!this.multiple) this.set_asset(item)
	}

	close_item_details = () => {
		sessionStorage.setItem('view', 'picker')
		this.set_modal_open(false)
		this.active_asset = null
	}

	#get_card_index = (event?: Event): string | undefined => {
		if (!event) return undefined
		const card = (event.target as HTMLElement)?.closest('[data-index]')
		return (card as HTMLElement)?.dataset.index
	}

	open_asset_picker = async (event?: Event) => {
		const index = this.#get_card_index(event)
		if (index) sessionStorage.setItem('replace_index_target', index)
		else sessionStorage.removeItem('replace_index_target')
		sessionStorage.setItem('view', 'picker')
		await this.set_modal_open(true)
	}

	close_modals = () => {
		this.close_move_asset_modal()
		this.close_rename_folder_modal()
		this.close_create_folder_modal()
		this.close_move_folder_modal()
	}

	get r2() {
		return ky.create({
			prefixUrl: 'https://assets.uilo.co/api/r2/',
			headers: {
				authorization: `Bearer ${this.#secrets?.r2_secret}`,
			},
			hooks: {
				beforeError: [
					async (error) => {
						const msg = await error.response.json<{ error: string }>()
						if (typeof msg === 'object' && 'error' in msg) {
							toast.error(msg.error)
						} else {
							toast.error('An unknown error occurred')
						}

						return error
					},
				],
			},
		})
	}

	load = async () => {
		if (!this.#secrets) return
		await this.list_assets(1)
		await this.list_folders()
	}

	update = () => {
		if (!this.plugin?.actions) return
		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}

	insert_selected_assets = () => {
		if (!this.selected.length || !this.multiple) return

		const content = (this.content || []) as Array<Asset>

		// Only add assets that are not already in the content
		const new_assets = this.selected.filter(
			(asset) => !content.some((item) => item._data.id === asset.id)
		)

		if (new_assets.length) {
			content.push(...new_assets.map(this.#turn_r2_asset_into_asset))
			this.content = content
			this.update()
		}

		this.selected = []
		if (this.is_modal_open) this.set_modal_open(false)
	}

	#turn_r2_asset_into_asset = (asset: R2Asset): Asset => {
		const { alt, title, source, copyright, name } = asset.attributes
		const meta_data: Asset['meta_data'] = {
			alt,
			title,
			source,
			copyright,
		}

		return {
			// Storyblok attributes
			id: asset.id,
			alt,
			filename: asset.links?.self || '',
			focus: asset.attributes.focus,
			title,
			source,
			copyright,
			is_external_url: false,
			meta_data,
			name,

			// Additional attributes
			width: asset.attributes.width,
			height: asset.attributes.height,
			format: asset.attributes.format,
			size_bytes: asset.attributes.size_bytes,
			_data: asset,
		}
	}

	set_asset = (asset: R2Asset | null) => {
		if (!asset) {
			this.content = null
			this.update()
			return
		}

		this.content = this.#turn_r2_asset_into_asset(asset)
		if (this.onselect) this.onselect(this.content)

		this.update()
	}

	replace_asset_at = (index: number, asset: R2Asset) => {
		if (!Array.isArray(this.content)) return

		// don't replace if the asset is already in the content
		if (this.content.some((item) => item._data.id === asset.id)) return

		this.content[index] = this.#turn_r2_asset_into_asset(asset)
		this.update()
		this.close_item_details()
	}

	select_asset = (asset: R2Asset | null) => {
		this.set_asset(asset)
		if (this.is_modal_open) this.set_modal_open(false)
	}

	update_asset = async (): Promise<void> => {
		if (!this.#secrets) return
		this.loading = true

		if (this.selected.length) {
			const json: Paths.UpdateAssetsBulk.RequestBody = {
				assets: this.selected.map((asset) => asset.id),
				metadata: {
					folder_id: this.parent_folder_id || '',
				},
			}

			await this.r2.patch<Paths.UpdateAssetsBulk.Responses.$204>(
				`${this.#secrets.r2_bucket}/assets`,
				{ json }
			)
		} else {
			const json: Paths.UpdateAssetMetadata.RequestBody = {
				...this.active_asset?.attributes,
				folder_id: this.parent_folder_id || '',
			}
			await this.r2.patch<Paths.UpdateAssetMetadata.Responses.$200>(
				`${this.#secrets.r2_bucket}/assets/${this.active_asset?.id}`,
				{
					json,
				}
			)
		}
		await this.load()
		this.close_move_asset_modal()
		this.loading = false
	}

	update_folder = async (): Promise<void> => {
		if (!this.#secrets) return
		if (!this.folder_name) return
		if (!this.active_folder_id) return
		this.loading = true
		try {
			const req = await this.r2.patch<R2FolderTree>(
				`${this.#secrets.r2_bucket}/folders/${this.active_folder_id}`,
				{
					json: { name: this.folder_name, parent_id: this.parent_folder_id },
				}
			)

			if (req.ok) await this.load()
			this.loading = false
			this.close_modals()
		} catch (error) {
			this.loading = false
		}
	}

	create_folder = async (): Promise<void> => {
		if (!this.#secrets) return
		if (!this.folder_name) return
		this.loading = true

		const json: Paths.CreateFolder.RequestBody = {
			name: this.folder_name,
			parent_id: this.parent_folder_id,
		}
		const req = await this.r2.post<Paths.CreateFolder.Responses.$201>(
			`${this.#secrets.r2_bucket}/folders`,
			{ json }
		)
		if (req.ok) await this.load()
		this.loading = false
		this.close_create_folder_modal()
		this.folder_name = ''
	}

	list_folders = async () => {
		if (!this.#secrets) return
		const res = await this.r2
			.get<Paths.ListFolders.Responses.$200>(`${this.#secrets.r2_bucket}/folders`)
			.json()
		this.folders = res.data?.structured
	}

	remove_asset = (asset: R2Asset) => {
		if (Array.isArray(this.content)) {
			const index = this.content.findIndex((item) => item._data.id === asset.id)
			if (index !== -1) {
				this.content.splice(index, 1)
			}
			this.update()
		} else if (this.content?._data.id === asset.id) {
			this.content = null
			this.update()
		}
	}

	list_assets = async (page?: number) => {
		if (!this.#secrets) return
		this.loading_assets = true
		const params = new URLSearchParams([
			['limit', this.limit.toString()],
			['page', page?.toString() || '1'],
		])

		if (this.active_folder) params.set('folder_id', this.active_folder)
		if (this.show_deleted) params.set('deleted', 'true')
		if (this.search_query) params.set('filter[q]', this.search_query)

		const target = `${this.#secrets.r2_bucket}/assets?${params.toString()}`

		try {
			const res = await this.r2.get<Paths.ListAssets.Responses.$200>(target).json()
			this.assets = res.data
			this.meta = res.meta
		} finally {
			this.loading_assets = false
		}
	}

	search_keyup = (event: KeyboardEvent) => {
		const value = (event.target as HTMLInputElement)?.value || ''
		this.search_query = value

		if (this.#search_timeout) window.clearTimeout(this.#search_timeout)

		this.#search_timeout = window.setTimeout(() => {
			this.list_assets(1)
		}, 500)
	}

	soft_delete_asset = async (asset: R2Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => item.id !== asset.id)

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets/${asset.id}`)

		// If multiple assets are selected, remove the asset from the content
		if (Array.isArray(this.content))
			this.content = this.content.filter((item) => item._data.id !== asset.id)
		// If a single asset is selected, deselect it
		else if (this.content?._data.id === asset.id) this.select_asset(null)

		await this.load()
	}

	hard_delete_asset = async (asset: R2Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset permanently?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/assets/${asset.id}?hard=true`)
		await this.load()
	}

	hard_delete_many_assets = async (assets: Array<R2Asset>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets permanently?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/assets?hard=true`, {
			json: assets.map((asset) => asset.id),
		})
		await this.load()
		this.selected = []
	}

	soft_delete_many_assets = async (assets: Array<R2Asset>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets?')
		if (!confirm) return
		if (this.assets?.length)
			this.assets = this.assets.filter((item) => !assets.some((asset) => asset.id === item.id))

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets`, {
			json: assets.map((asset) => asset.id),
		})

		// If multiple assets are selected, remove the assets from the content
		if (Array.isArray(this.content)) {
			this.content = this.content.filter(
				(item) => !assets.some((asset) => asset.id === item._data.id)
			)
			// If a single asset is selected, deselect it
		} else if (this.content?._data.id === assets[0].id) {
			this.select_asset(null)
		}
		await this.load()
		this.selected = []
	}

	delete_folder = async (folder_id: string) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this folder?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/folders/${folder_id}`)
		await this.list_folders()
	}

	save_and_close = async (event: SubmitEvent) => {
		if (!this.active_asset) return
		this.loading = true
		event.preventDefault()
		event.stopPropagation()

		const data = new FormData(event.target as HTMLFormElement)
		const [title, alt, name, copyright, source] = [
			data.get('title'),
			data.get('alt'),
			data.get('name'),
			data.get('copyright'),
			data.get('source'),
		] as Array<string | null>

		// Update this.active_asset
		this.active_asset.attributes.title = title || undefined
		this.active_asset.attributes.alt = alt || undefined
		this.active_asset.attributes.name = name || undefined
		this.active_asset.attributes.copyright = copyright || undefined
		this.active_asset.attributes.source = source || undefined

		// Update local content if single asset is selected
		if (!this.multiple && this.content && !Array.isArray(this.content)) {
			this.content.alt = alt
			this.content.title = title
			this.content.source = source
			this.content.copyright = copyright
			this.content.name = name || undefined
			this.content._data = {
				...this.content._data,
				attributes: {
					...this.content._data.attributes,
					title: title || undefined,
					alt: alt || undefined,
					name: name || undefined,
					copyright: copyright || undefined,
					source: source || undefined,
				},
			}
		} else if (this.multiple && Array.isArray(this.content)) {
			this.content = this.content.map((item) => {
				if (item._data.id === this.active_asset!.id) {
					return {
						...item,
						title,
						alt,
						name: name || undefined,
						copyright,
						source,
						_data: {
							...item._data,
							attributes: {
								...item._data.attributes,
								title: title || undefined,
								alt: alt || undefined,
								name: name || undefined,
								copyright: copyright || undefined,
								source: source || undefined,
							},
						},
					}
				}
				return item
			})
		}
		this.update()
		await this.update_asset()
		this.close_item_details()
		this.loading = false
	}

	toggle_actions(id: string) {
		this.open_actions = this.open_actions === id ? null : id
	}

	readonly is_modal_open = $derived(this.loaded && this.plugin?.data?.isModalOpen)

	set_focus(e: MouseEvent) {
		if (!this.content) return
		if (Array.isArray(this.content)) {
			this.content.forEach((item) => {
				item.focus = e ? `${e.offsetX}x${e.offsetY}:${e.offsetX + 1}x${e.offsetY + 1}` : undefined
			})
		} else {
			this.content.focus = e
				? `${e.offsetX}x${e.offsetY}:${e.offsetX + 1}x${e.offsetY + 1}`
				: undefined
		}

		this.update()
	}

	upload = async ({ target }: Event) => {
		if (!(target instanceof HTMLInputElement) || !target.files) return

		const body = new FormData()
		for (const file of target.files) body.append('file', file)

		if (this.active_folder) body.append('folder_id', this.active_folder)

		if (!this.#secrets) return
		const req = await this.r2.post(`${this.#secrets.r2_bucket}/assets`, { body })

		if (!req.ok) return

		this.load()
		target.value = ''
	}

	restore = async (asset: R2Asset) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/assets/${asset.id}/restore`)
		this.load()
	}

	restore_many_assets = async (assets: Array<R2Asset>) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/assets/restore`, {
			json: assets.map((asset) => asset.id),
		})
		this.load()
	}

	next_page = () => {
		if (!this.meta?.page) return
		this.list_assets(this.meta.page + 1)
	}

	previous_page = () => {
		if (!this.meta?.page) return
		this.list_assets(this.meta.page - 1)
	}

	go_to_page = (page: number) => {
		if (!this.meta?.page) return
		this.list_assets(page)
	}
}
