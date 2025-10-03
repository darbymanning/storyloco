import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import Mux from '@mux/mux-node'
import type { Video, VimeoVideo } from '../types.js'
import { format_date, format_elapse } from 'kitto'
import ky from 'ky'

export type MuxAsset = Mux.Video.Assets.Asset

export type R2List = {
	$metadata: {
		httpStatusCode: number
		attempts: number
		totalRetryDelay: number
	}
	Contents: Array<{
		Key: string
		LastModified: string
		ETag: string
		Size: number
		StorageClass: string
	}>
	IsTruncated: boolean
	KeyCount: number
	MaxKeys: number
	Name: string
}

export type R2Item = R2List['Contents'][number]

type Plugin = FieldPluginResponse<Video | null>

export class AssetManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Video | null>({})
	assets = $state<Array<R2List['Contents'][number]> | null>(null)
	open_actions = $state<string | null>(null)
	timeout = $state<NodeJS.Timeout | null>(null)
	video_options_open = $state(false)
	vimeo_upload_state: null | 'loading' = $state(null)
	open_item: null | R2Item = $state(null)

	#poll: NodeJS.Timeout | null = $state(null)
	#initial = $state(true)
	#secrets: {
		mux_secret: string
		vimeo_secret?: string
		r2_secret: string
		r2_bucket: string
	} | null = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null

		const mux_secret = this.plugin.data.options.MOXY_MUX_SECRET_ID
		const vimeo_secret = this.plugin.data.options.MOXY_VIMEO_SECRET_ID
		const r2_secret = this.plugin.data.options.MOXY_R2_SECRET_ID
		const r2_bucket = this.plugin.data.options.R2_BUCKET

		return { mux_secret, vimeo_secret, r2_secret, r2_bucket }
	})

	constructor() {
		this.initialize_plugin()

		$effect(() => {
			document.documentElement.setAttribute(
				'data-modal-open',
				this.is_modal_open ? 'true' : 'false'
			)
		})
	}

	open_item_details(item: R2Item) {
		if (!this.is_modal_open) this.plugin?.actions?.setModalOpen(true)
		this.open_item = item
		this.content = {
			...this.content,
			filename: `https://r2.uilo.co/${item.Key}`,
			meta_data: {
				alt: this.content.alt,
				title: this.content.title,
				source: this.content.source,
				copyright: this.content.copyright,
				width: Number(item.Metadata.width),
				height: Number(item.Metadata.height),
				format: item.Metadata.format,
			},
		}
	}

	close_item_details() {
		this.plugin?.actions?.setModalOpen(false)
		this.open_item = null
	}

	private initialize_plugin() {
		createFieldPlugin<Video | null>({
			enablePortalModal: true,
			validateContent(content) {
				if (typeof content !== 'object') return { content: null }
				return { content: content as Video }
			},
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (this.plugin.data?.content) {
					this.content = this.plugin.data.content
					if (this.#initial) this.#initial = false
				}
			},
		})
	}

	get mux() {
		return new Mux({
			baseURL: 'https://moxy.uilo.co/api/mux/',
			tokenId: '',
			tokenSecret: '',
			defaultHeaders: {
				authorization: `Bearer ${this.#secrets?.mux_secret}`,
			},
		})
	}

	get vimeo() {
		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api/vimeo/',
			headers: {
				authorization: `Bearer ${this.#secrets?.vimeo_secret}`,
			},
		})
	}

	get r2() {
		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api/r2/',
			headers: {
				authorization: `Bearer ${this.#secrets?.r2_secret}`,
			},
		})
	}

	get_poster(video: MuxAsset) {
		const playback_id = video.playback_ids?.[0]?.id
		return playback_id ? `https://image.mux.com/${playback_id}/thumbnail.jpg` : undefined
	}

	update(c?: Partial<Video>) {
		if (this.plugin?.type !== 'loaded') return
		const existing_content = this.content || {}
		const state = $state.snapshot({ ...existing_content, ...c })
		this.content = state
		this.plugin.actions.setContent(state)
	}

	set_video = (video: MuxAsset | null) => {
		if (!video) {
			this.content = null
			this.update()
			return
		}
		const playback_id = video.playback_ids?.[0]?.id
		this.content = {
			...this.content,
			playback_id,
			title: video.meta?.title,
			m3u8_url: playback_id ? `https://stream.mux.com/${playback_id}.m3u8` : undefined,
			poster: this.get_poster(video),
			mux_video: video,
		}
		this.update()
		this.plugin?.actions?.setModalOpen(false)
	}

	list = async () => {
		if (!this.#secrets) return
		this.assets = (await this.r2.get<R2List>(this.#secrets.r2_bucket).json()).Contents
	}

	delete = async (id: string) => {
		if (this.plugin?.type !== 'loaded' || !this.plugin.data.options.MOXY_MUX_SECRET_ID || !this.mux)
			throw new Error('Mux not initialised')
		const confirm = window.confirm('Are you sure you want to delete this video?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((asset) => asset.Key !== id)
		await this.mux.video.assets.delete(id)
		if (this.content?.mux_video?.id === id) this.set_video(null)
		await this.list()
	}

	get_upload_endpoint = async () => {
		if (!this.mux) throw new Error('Mux not initialised')

		return (
			await this.mux.video.uploads.create({
				cors_origin: 'https://storyblok.com',
				new_asset_settings: {
					playback_policy: ['public'],
					encoding_tier: 'baseline',
				},
			})
		).url
	}

	toggle_actions(id: string) {
		this.open_actions = this.open_actions === id ? null : id
	}

	async set_title(title: string, id: string) {
		if (this.timeout) clearTimeout(this.timeout)
		this.update({ title })
		this.timeout = setTimeout(async () => {
			if (!this.mux) return
			await this.mux.video.assets.update(id, {
				meta: { title },
			})
		}, 1000)
	}

	async select_poster() {
		if (!this.content?.mux_video) return
		const asset = await this.plugin?.actions?.selectAsset()
		if (!asset) this.update({ poster: this.get_poster(this.content.mux_video) })
		else this.update({ poster: asset.filename })
	}

	async delete_poster() {
		if (!this.content?.mux_video) return
		this.update({ poster: this.get_poster(this.content.mux_video) })
	}

	format_duration(seconds: number): string {
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		const remaining_seconds = Math.floor(seconds % 60)
		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${remaining_seconds.toString().padStart(2, '0')}`
		}
		return `${minutes}:${remaining_seconds.toString().padStart(2, '0')}`
	}

	date(date: string): string {
		const d = new Date(Number(date) * 1000)
		return format_elapse(d) || format_date('{MMM} {D}, {YYYY}', d)
	}

	get is_mux_poster() {
		return this.content?.poster?.startsWith('https://image.mux.com/')
	}

	get poster() {
		if (this.is_mux_poster) return `${this.content?.poster}?width=558&height=314&fit_mode=smartcrop`
		if (this.content?.poster?.endsWith('.svg')) return this.content.poster
		return `${this.content?.poster}/m/558x314/smart`
	}

	get is_modal_open() {
		return this.plugin?.type === 'loaded' && this.plugin.data?.isModalOpen
	}

	get has_vimeo() {
		return !!this.#secrets?.vimeo_secret
	}

	add_vimeo_url = async (e: Event) => {
		e.preventDefault()
		const form = e.target
		if (!(form instanceof HTMLFormElement)) return

		const url = form.vimeo_url.value
		if (!url) throw new Error('No URL found')

		// extract video id from vimeo url using regex - handles all formats:
		// https://vimeo.com/867092030
		// https://vimeo.com/867092030/02e4819d25
		// https://vimeo.com/channels/staffpicks/867092030
		const vimeo_regex =
			/vimeo\.com\/(?:channels\/\w+\/|groups\/\w+\/|album\d+\/|video\/)?(\d+)(?:\/[\w-]+)?/
		const match = url.match(vimeo_regex)
		const video_id = match?.[1]
		if (!video_id) throw new Error('No video ID found')

		this.vimeo_upload_state = 'loading'
		const video = await this.vimeo.get<VimeoVideo>(`videos/${video_id}`).json()

		const largest_file = video.files.find(
			(file) => file.size === Math.max(...video.files.map((file) => file.size))
		)

		if (!largest_file) {
			this.vimeo_upload_state = null
			throw new Error('No largest file found')
		}

		await this.mux.video.assets.create({
			inputs: [
				{
					url: largest_file.link,
				},
			],
			playback_policy: ['public'],
			encoding_tier: 'baseline',
			meta: {
				title: video.name,
				external_id: video_id,
			},
		})

		await this.list()
		this.vimeo_upload_state = null
	}
}
