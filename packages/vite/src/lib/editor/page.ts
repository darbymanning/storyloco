/**
 * Where the page's origin is in the window, which the body is unless the site positions it. An
 * overlay placed from it sits on the page, so the browser scrolls it with what it marks; one fixed
 * to the window follows a frame behind, from scroll events, and bounces as the page scrolls.
 */
/**
 * `place`, once, in the coming frame: a scroll event comes before the page's scroll-driven
 * animations move what an overlay marks, so measured then it's where it was a frame ago, and an
 * overlay put there is left behind
 */
export function next_frame(place: () => void) {
	let frame = 0
	return () => {
		frame ||= requestAnimationFrame(() => {
			frame = 0
			place()
		})
	}
}

export function page_origin() {
	const body = document.body
	return getComputedStyle(body).position === "static"
		? { top: -scrollY, left: -scrollX }
		: body.getBoundingClientRect()
}
