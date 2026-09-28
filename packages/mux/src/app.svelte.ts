import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import Mux from '@mux/mux-node'
import type { MuxAsset, Video, VimeoVideo } from '../types.js'
import { format_date, format_elapse } from 'kitto'
import ky, { HTTPError } from 'ky'

export type { MuxAsset }

type Plugin = FieldPluginResponse<Video | null>

// passthrough marker for assets deleted while still preparing
const PENDING_DELETE = 'delete-when-ready'

export class MuxManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Video | null>(null)
	assets = $state<Array<MuxAsset> | null>(null)
	open_actions = $state<string | null>(null)
	timeout = $state<NodeJS.Timeout | null>(null)
	video_options_open = $state(false)
	vimeo_upload_state: null | 'loading' = $state(null)
	youtube_upload_state: null | 'loading' = $state(null)
	youtube_progress = $state<{
		stage: 'downloading' | 'merging' | 'uploading' | 'finishing'
		part?: number
		percent?: number
	} | null>(null)

	// sign-in (OAuth) connections from the Mux Library space plugin can't delete: Mux answers
	// DELETE with 404 for them. null until moxy has said which kind this field's secret is.
	connection = $state<{ sign_in: boolean; environment_id: string | null } | null>(null)
	// a video Mux wouldn't let us delete, so the field can point to the Mux dashboard instead
	undeletable = $state<{ title: string; url: string } | null>(null)

	#poll: NodeJS.Timeout | null = $state(null)
	#initial = $state(true)
	#secrets: { mux_secret: string; vimeo_secret?: string } | null = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null

		const mux_secret = this.plugin.data.options.MOXY_MUX_SECRET_ID
		const vimeo_secret = this.plugin.data.options.MOXY_VIMEO_SECRET_ID

		return { mux_secret, vimeo_secret }
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
			// moxy swaps in the real credentials; the SDK just refuses to run with empty ones
			tokenId: 'moxy',
			tokenSecret: 'moxy',
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

	// ponytail: a failed lookup leaves connection null, so the field keeps its old delete behaviour
	#load_connection = async () => {
		this.connection ??= await ky
			.get('https://moxy.uilo.co/api/mux-connection', {
				headers: { authorization: `Bearer ${this.#secrets?.mux_secret}` },
			})
			.json<{ sign_in: boolean; environment_id: string | null }>()
			.catch(() => null)
	}

	#dashboard_url = (id: string) =>
		this.connection?.environment_id
			? `https://dashboard.mux.com/environments/${this.connection.environment_id}/video/assets/${id}`
			: 'https://dashboard.mux.com'

	list = async () => {
		if (!this.mux) throw new Error('Mux not initialised')
		const [{ data: assets }] = await Promise.all([
			this.mux.video.assets.list({ limit: 0 }),
			this.#load_connection(),
		])

		// finish deferred deletes (see `delete`) now Mux allows them; failures just retry next list.
		// Sign-in connections can never delete, so their flagged videos stay listed rather than vanish.
		if (!this.connection?.sign_in) {
			await Promise.allSettled(
				assets
					.filter((asset) => asset.passthrough === PENDING_DELETE && asset.status !== 'preparing')
					.map((asset) => this.mux.video.assets.delete(asset.id))
			)
		}
		this.assets = this.connection?.sign_in
			? assets
			: assets.filter((asset) => asset.passthrough !== PENDING_DELETE)

		// keeps polling for pending deletes too, so they go as soon as they're ready
		const has_preparing = assets.some(({ status }) => status === 'preparing')

		if (has_preparing)
			this.#poll = setTimeout(this.list, 3000) // 3 seconds
		else if (this.#poll) clearTimeout(this.#poll)
	}

	delete = async (id: string) => {
		if (this.plugin?.type !== 'loaded' || !this.plugin.data.options.MOXY_MUX_SECRET_ID || !this.mux)
			throw new Error('Mux not initialised')
		const asset = this.assets?.find((asset) => asset.id === id)
		const undeletable = () =>
			(this.undeletable = {
				title: asset?.meta?.title || 'this video',
				url: this.#dashboard_url(id),
			})
		this.undeletable = null
		if (this.connection?.sign_in) return undeletable()

		const confirm = window.confirm('Are you sure you want to delete this video?')
		if (!confirm) return
		const before = this.assets
		if (this.assets?.length) this.assets = this.assets.filter((asset) => asset.id !== id)
		try {
			// Mux refuses to delete (or abort) a preparing asset, so flag it and let `list` delete it once ready
			if (asset?.status === 'preparing')
				await this.mux.video.assets.update(id, { passthrough: PENDING_DELETE })
			else await this.mux.video.assets.delete(id)
		} catch (error) {
			// a 404 for a video we can still list means Mux won't let this connection delete it
			if ((error as { status?: number }).status === 404 && asset) {
				this.assets = before
				return undeletable()
			}
			throw error
		}
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
		if (!this.content?.mux_video || !this.plugin?.actions) return
		const asset = await this.plugin.actions.selectAsset()
		if (asset) this.update({ poster: asset.filename })
		else this.update({ poster: this.get_poster(this.content.mux_video) })
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

	get youtube_progress_label() {
		const progress = this.youtube_progress
		switch (progress?.stage) {
			case 'downloading':
				return `Downloading ${progress.part === 2 ? 'audio' : 'video'} from YouTube…`
			case 'merging':
				return 'Merging video and audio…'
			case 'uploading':
				return 'Uploading to Mux…'
			case 'finishing':
				return 'Handing over to Mux…'
			default:
				return 'Starting YouTube import…'
		}
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

	add_youtube_url = async (e: Event) => {
		e.preventDefault()
		const form = e.target
		if (!(form instanceof HTMLFormElement)) return

		// handles watch?v=, youtu.be/, shorts/, embed/, live/ and m./music. subdomains
		const match = form.youtube_url.value.match(
			/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/
		)
		const video_id = match?.[1]
		if (!video_id) return window.alert('That doesn’t look like a YouTube URL')

		this.youtube_upload_state = 'loading'
		try {
			// moxy downloads the video and pushes it into a Mux direct upload, streaming NDJSON progress
			const res = await ky.post('https://moxy.uilo.co/api/youtube', {
				json: { video_id },
				headers: { authorization: `Bearer ${this.#secrets?.mux_secret}` },
				timeout: false,
			})
			const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
			let buffer = ''
			let upload_id: string | undefined
			let done = false
			for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
				const lines = (buffer + chunk.value).split('\n')
				buffer = lines.pop()!
				for (const line of lines.filter(Boolean)) {
					const event = JSON.parse(line)
					if (event.error) throw new Error(`YouTube import failed: ${event.error}`)
					if (event.upload_id) upload_id = event.upload_id
					else if (event.done) done = true
					else this.youtube_progress = event
				}
			}
			if (!upload_id || !done) throw new Error('YouTube import stopped unexpectedly')

			// the asset appears once Mux has picked up the finished upload
			this.youtube_progress = { stage: 'finishing' }
			while ((await this.mux.video.uploads.retrieve(upload_id)).status === 'waiting') {
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
			await this.list()
		} catch (error) {
			const message =
				error instanceof HTTPError
					? ((await error.response.json().catch(() => null))?.message ?? error.message)
					: String(error)
			window.alert(message)
		} finally {
			this.youtube_upload_state = null
			this.youtube_progress = null
		}
	}
}
