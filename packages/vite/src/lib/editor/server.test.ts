import { describe, expect, test } from "bun:test"
import { allowed, EditorError, input_of, normalise, video_of } from "./server.js"

describe("editor schemas", () => {
	const component = (name: string, group: string | null = null, nestable = true) => ({
		name,
		display_name: null,
		is_nestable: nestable,
		component_group_uuid: group,
		schema: {},
	})
	const components = [component("hero", "g1"), component("card"), component("page", null, false)]
	const names = (field?: Parameters<typeof allowed>[1]) =>
		allowed(components, field).map((c) => c.name)

	test("allowed follows the field's whitelist, groups or nothing", () => {
		expect(names()).toEqual(["hero", "card"])
		expect(names({ type: "bloks", restrict_components: false })).toEqual(["hero", "card"])
		expect(
			names({ type: "bloks", restrict_components: true, component_whitelist: ["card"] })
		).toEqual(["card"])
		expect(
			names({
				type: "bloks",
				restrict_components: true,
				restrict_type: "groups",
				component_group_whitelist: ["g1"],
			})
		).toEqual(["hero"])
	})

	const asset = {
		id: 7,
		filename: "https://a.storyblok.com/f/1/x.jpg",
		alt: "From the library",
		title: "",
		copyright: "",
		focus: "",
		content_type: "image/jpeg",
	}
	const resolve = async (id: number) => ({ ...asset, id })
	const check = (type: string, value: unknown, existing?: unknown, extra = {}) =>
		normalise({ type, ...extra }, value, existing, resolve)
	const refused = async (promise: Promise<unknown>) =>
		expect(
			await promise.then(
				() => null,
				(e) => e
			)
		).toBeInstanceOf(EditorError)

	test("normalise keeps each type to what Storyblok stores", async () => {
		expect(await check("text", "Hi")).toBe("Hi")
		await refused(check("text", 3))
		await refused(check("text", "long", undefined, { max_length: 2 }))
		expect(await check("number", "4")).toBe("4")
		expect(await check("number", "4", 1)).toBe(4)
		await refused(check("number", "four"))
		await refused(check("number", true))
		await refused(check("number", [5]))
		expect(await check("boolean", true)).toBe(true)
		await refused(check("datetime", "tomorrow"))
		expect(await check("datetime", "2026-10-25 09:30")).toBe("2026-10-25 09:30")
		await refused(check("bloks", []))
	})

	test("normalise fetches assets by id and keeps a field's other keys", async () => {
		const value = (await check(
			"asset",
			{ id: 9, alt: "Mine", focus: "1x1:2x2" },
			{ source: "kept", filename: "old" }
		)) as Record<string, unknown>
		expect(value).toMatchObject({
			id: 9,
			filename: asset.filename,
			alt: "Mine",
			focus: "1x1:2x2",
			source: "kept",
			fieldtype: "asset",
		})
		const cleared = (await check("asset", null, { source: "kept" })) as Record<string, unknown>
		expect(cleared).toMatchObject({ id: null, filename: "", source: "kept" })
		const many = (await check("multiasset", [{ id: 1 }, { id: 2 }])) as Array<{ id: number }>
		expect(many.map((a) => a.id)).toEqual([1, 2])
	})

	test("normalise only takes links and plugins it knows", async () => {
		expect(await check("multilink", { linktype: "url", url: "https://x.y" })).toMatchObject({
			linktype: "url",
			url: "https://x.y",
			cached_url: "https://x.y",
			fieldtype: "multilink",
		})
		await refused(check("multilink", { linktype: "javascript" }))
		expect(
			await check(
				"custom",
				{ text: "Hi" },
				{ text: "Old", level: 2 },
				{ field_type: "uiloco-heading" }
			)
		).toEqual({ text: "Hi", level: 2 })
		await refused(check("custom", { id: "x" }, undefined, { field_type: "uiloco-hubspot-form" }))
	})

	test("video_of writes what the Mux field plugin does and keeps the field's own settings", () => {
		const asset = {
			id: "a1",
			playback_ids: [{ id: "p1", policy: "public" }],
			meta: { title: "Launch" },
		}
		const value = video_of(asset, {
			autoplay: true,
			poster: "https://a.storyblok.com/f/1/poster.jpg",
		})
		expect(value).toMatchObject({
			playback_id: "p1",
			title: "Launch",
			m3u8_url: "https://stream.mux.com/p1.m3u8",
			poster: "https://a.storyblok.com/f/1/poster.jpg",
			autoplay: true,
			mux_video: asset,
		})
		expect(video_of(asset, { poster: "https://image.mux.com/old/thumbnail.jpg" }).poster).toBe(
			"https://image.mux.com/p1/thumbnail.jpg"
		)
	})

	test("normalise only changes a video's settings, never which video it is", async () => {
		const existing = { playback_id: "p1", autoplay: false }
		expect(
			await check("custom", { playback_id: "evil", autoplay: true }, existing, {
				field_type: "uiloco-mux",
			})
		).toEqual({ playback_id: "p1", autoplay: true })
		expect(await check("custom", null, existing, { field_type: "uiloco-mux" })).toBeNull()
	})

	test("undo puts a stored value back through the same checks", async () => {
		const back = async (type: string, stored: unknown, extra = {}) =>
			normalise({ type, ...extra }, input_of({ type, ...extra }, stored), stored, resolve)
		const image = { fieldtype: "asset", id: 7, filename: asset.filename, alt: "Kept", focus: "" }
		expect(await back("asset", image)).toMatchObject({ id: 7, alt: "Kept" })
		expect(await back("asset", { fieldtype: "asset", id: null, filename: "" })).toMatchObject({
			id: null,
		})
		expect(await back("multiasset", [image])).toHaveLength(1)
		expect(await back("text", undefined)).toBe("")
		expect(await back("boolean", undefined)).toBe(false)
		expect(await back("multilink", undefined)).toMatchObject({ linktype: "url", url: "" })
		expect(await back("richtext", undefined)).toEqual({ type: "doc", content: [] })
		expect(await back("custom", undefined, { field_type: "uiloco-mux" })).toBeNull()
	})

	test("normalise keeps a table's shape, every row as wide as its heading", async () => {
		const table = await check("table", {
			thead: [{ _uid: "h1", value: "Name" }, { value: "Role" }],
			tbody: [{ _uid: "r1", body: [{ value: "Ada" }, { value: "Maths" }] }],
		})
		expect(table).toMatchObject({
			fieldtype: "table",
			thead: [{ _uid: "h1", value: "Name", component: "_table_head" }, { value: "Role" }],
			tbody: [
				{
					_uid: "r1",
					component: "_table_row",
					body: [{ value: "Ada", component: "_table_col" }, {}],
				},
			],
		})
		await refused(check("table", { thead: [{ value: "A" }], tbody: [{ body: [] }] }))
		await refused(check("table", { thead: [{ value: 3 }], tbody: [] }))
		await refused(check("table", "a,b"))
	})
})
