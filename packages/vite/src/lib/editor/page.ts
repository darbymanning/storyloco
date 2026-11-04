/**
 * Where the page's origin is in the window, which the body is unless the site positions it. An
 * overlay placed from it sits on the page, so the browser scrolls it with what it marks; one fixed
 * to the window follows a frame behind, from scroll events, and bounces as the page scrolls.
 */
export function page_origin() {
	const body = document.body
	return getComputedStyle(body).position === "static"
		? { top: -scrollY, left: -scrollX }
		: body.getBoundingClientRect()
}
