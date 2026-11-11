import { describe, expect, test } from "bun:test"
import { plugin_link } from "./link.js"

describe("plugin_link", () => {
	const native = { fieldtype: "multilink", id: "", url: "", cached_url: "" }

	test("a story link keeps its native fields, with its anchor as the suffix", () => {
		expect(
			plugin_link({ ...native, linktype: "story", id: "u1", cached_url: "about", anchor: "team" })
		).toEqual({
			type: "internal",
			suffix: "#team",
			story: { uuid: "u1" },
			fieldtype: "multilink",
			linktype: "story",
			id: "u1",
			cached_url: "about",
		})
	})

	test("a story resolved on the page brings its name", () => {
		const story = { id: 7, uuid: "u1", name: "About", full_slug: "about", url: "about" }
		expect(plugin_link({ ...native, linktype: "story", id: "u1", story }).story).toEqual({
			id: 7,
			uuid: "u1",
			name: "About",
			published_at: null,
		})
	})

	test("URLs, emails, assets and empty links", () => {
		expect(
			plugin_link({ ...native, linktype: "url", url: "https://x.test", target: "_blank" })
		).toEqual({ type: "external", url: "https://x.test", target: "_blank" })
		expect(plugin_link({ ...native, linktype: "email", email: "a@b.test" })).toEqual({
			type: "email",
			email: "a@b.test",
			url: "mailto:a@b.test",
		})
		expect(
			plugin_link({ ...native, linktype: "asset", url: "https://a.storyblok.com/f/x.pdf" })
		).toEqual({ type: "external", url: "https://a.storyblok.com/f/x.pdf" })
		expect(plugin_link({ ...native, linktype: "story" })).toEqual({ type: "internal" })
	})

	test("a value already in the plugin's shape is left alone", () => {
		const value = { type: "form", form: { id: "f1", name: "Enquiry" } }
		expect(plugin_link(value)).toBe(value)
	})
})
