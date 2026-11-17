import { expect, test } from "bun:test"
import { video } from "./stream.js"

const field = { m3u8_url: "https://stream.mux.com/x.m3u8", poster: "p.jpg", controls: true }

test("a Mux field's attributes, with the stream attached", () => {
	const attrs = video(field, { class: "wide" })
	expect(attrs).toMatchObject({
		poster: "p.jpg",
		controls: true,
		preload: "none",
		autoplay: false,
		class: "wide",
	})
	expect(Object.getOwnPropertySymbols(attrs)).toHaveLength(1)
})

test("an autoplaying video is muted, whichever side asked for it", () => {
	expect(video({ ...field, autoplay: true })).toMatchObject({ autoplay: true, muted: true })
	expect(video(field, { autoplay: true })).toMatchObject({ autoplay: true, muted: true })
	expect(video({ ...field, autoplay: true }, { autoplay: false })).toMatchObject({
		autoplay: false,
		muted: false,
	})
})

test("nothing for a field left blank", () => {
	expect(video(undefined)).toBeUndefined()
	expect(video({})).toBeUndefined()
	expect(video.exists(field)).toBe(true)
})
