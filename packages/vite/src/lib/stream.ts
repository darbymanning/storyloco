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
