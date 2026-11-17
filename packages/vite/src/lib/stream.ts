import { createAttachmentKey } from "svelte/attachments"
import type { HTMLVideoAttributes } from "svelte/elements"

export interface StreamOptions {
	/**
	 * A background video that plays by itself: it starts once the page has finished loading.
	 * Otherwise nothing is fetched until the video is nearly on screen, and none of the video
	 * itself until someone presses play.
	 */
	autoplay?: boolean
}

/**
 * Plays a Mux (HLS) stream in a `<video>`: `stream(video, blok.video.m3u8_url)`. Returns its own
 * clean-up, for an `$effect` or an attachment.
 *
 * That takes hls.js, which is half a megabyte: it is imported here, when a video actually needs
 * it, rather than by every page that could show one. And it is told to stay out of the page's way:
 *
 * - `capLevelToPlayerSize`: no rendition bigger than the element showing it, so a phone doesn't
 *   download 720p to fill a 400px box.
 * - `maxBufferLength` and `maxMaxBufferLength`: stay 10 seconds ahead of playback. The first is
 *   only a floor: left to itself hls.js buffers up to 60 MB, which for a short film is all of it.
 */
export function stream(
	video: HTMLVideoElement,
	url: string,
	{ autoplay = false }: StreamOptions = {}
) {
	// hls.js needs Media Source Extensions. Only an older iPhone lacks them, and it plays HLS itself.
	// Not `canPlayType`: Chromium now answers "maybe" for HLS and then fails to load it.
	if (!("MediaSource" in window || "ManagedMediaSource" in window)) {
		// with `preload="none"` on the element nothing is fetched until play here either
		video.src = url
		return () => video.removeAttribute("src")
	}

	let cancelled = false
	let teardown: (() => void) | undefined

	async function attach() {
		// the full build, not `hls.js/light`: Mux sends sound as a separate audio track, which light can"t play
		const { default: Hls } = await import("hls.js")
		if (cancelled) return

		const hls = new Hls({
			capLevelToPlayerSize: true,
			maxBufferLength: 10,
			maxMaxBufferLength: 10,
			autoStartLoad: autoplay,
		})
		hls.loadSource(url)
		hls.attachMedia(video)
		teardown = () => hls.destroy()

		if (autoplay) return

		const start = () => hls.startLoad()
		// pressed play before hls.js had arrived
		if (!video.paused) start()
		else video.addEventListener("play", start, { once: true })
	}

	if (autoplay) {
		// after everything the page itself needs
		if (document.readyState === "complete") attach()
		else addEventListener("load", attach, { once: true })
	} else {
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry.isIntersecting) return
				observer.disconnect()
				attach()
			},
			{ rootMargin: "600px" }
		)
		observer.observe(video)
		teardown = () => observer.disconnect()
	}

	return () => {
		cancelled = true
		removeEventListener("load", attach)
		teardown?.()
	}
}

/** What `video` reads of a Mux field's value; `Video` from `storyloco/mux` is one */
export interface Streamable {
	m3u8_url?: string
	poster?: string
	autoplay?: boolean
	muted?: boolean
	loop?: boolean
	playsinline?: boolean
	controls?: boolean
}

const has_stream = <T extends Streamable>(video?: T | null): video is T & { m3u8_url: string } =>
	!!video?.m3u8_url

function attrs(video?: Streamable | null, attrs: HTMLVideoAttributes = {}) {
	// a field left blank: nothing to spread
	if (!has_stream(video)) return undefined

	const autoplay = !!(attrs.autoplay ?? video.autoplay)
	return {
		poster: video.poster,
		// a browser only starts a video by itself when it's silent
		muted: video.muted || autoplay,
		loop: video.loop,
		playsinline: video.playsinline,
		controls: video.controls,
		// nothing of the video until play; `stream` fetches what an autoplaying one needs
		preload: "none",
		...attrs,
		autoplay,
		[createAttachmentKey()]: (element: HTMLVideoElement) =>
			stream(element, video.m3u8_url, { autoplay }),
	} as const
}

/**
 * A `<video>`'s attributes for a Mux field, and the stream itself: the poster, and autoplay, muted,
 * loop, controls and playsinline as the editor set them, any of them overridden by the second
 * argument. Playing is `stream`'s, attached with the rest, so there's nothing to bind or clean up.
 * Nothing for an empty field, so it spreads safely. `video.exists(field)` narrows to one with a
 * stream.
 *
 * @example
 * <video {...video(blok.video)}></video>
 * <video {...video(blok.background, { autoplay: true, loop: true, controls: false })}></video>
 */
export const video = Object.assign(attrs, { exists: has_stream })
