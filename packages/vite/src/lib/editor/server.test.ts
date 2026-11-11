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

	test("an R2 Assets field's file comes from its bucket, or is what the field held", async () => {
		const field = { type: "custom", field_type: "uiloco-asset" }
		const r2_asset = (id: string) => ({
			id,
			type: "asset",
			links: { self: `https://assets.uilo.co/f/c/b/10x10/${id}/a.jpg` },
			attributes: { width: 10, height: 10, alt: "In the bucket" },
		})
		const fetched: Array<string> = []
		const r2 = async (_: unknown, id: string) => (fetched.push(id), r2_asset(id))
		const put = (value: unknown, existing?: unknown, extra = {}) =>
			normalise({ ...field, ...extra }, value, existing, resolve, undefined, r2)

		// the page's filename is ignored: the file is the bucket's
		const one = (await put({
			id: "u1",
			alt: "Head",
			focus: "1x2:3x4",
			filename: "evil",
		})) as Record<string, unknown>
		expect(one.filename).toBe(r2_asset("u1").links.self)
		expect([one.alt, one.focus, (one.meta_data as { alt: string }).alt]).toEqual([
			"Head",
			"1x2:3x4",
			"Head",
		])
		expect(fetched).toEqual(["u1"])

		// a file the field already holds isn't fetched again; a new one in a list is
		const list = (await put([{ id: "u2" }, { id: "u1", alt: "New alt" }], [one])) as Array<
			Record<string, unknown>
		>
		expect(list.map((item) => [item.id, item.alt])).toEqual([
			["u2", ""],
			["u1", "New alt"],
		])
		expect(fetched).toEqual(["u1", "u2"])

		expect(await put(null, one)).toBeNull()
		// undoing puts the stored value back through the same checks
		expect(await put(input_of(field, list), list)).toEqual(list)
		await refused(put({ id: "u1", focus: "middle" }))
		await refused(put({ id: "../x" }))
		await refused(put({ id: "u1" }, undefined, { options: [{ name: "link", value: "true" }] }))
	})

	test("a storyloco plugin's value is only what its plugin would store", async () => {
		const plugin = (field_type: string, value: unknown, existing?: unknown, extra = {}) =>
			check("custom", value, existing, { field_type, ...extra })
		const themes = { options: [{ name: "Dark Green", value: "#0a3" }] }
		expect(await plugin("uiloco-theme", "theme-dark-green", null, themes)).toBe("theme-dark-green")
		expect(await plugin("uiloco-theme", null, "theme-dark-green", themes)).toBeNull()
		await refused(plugin("uiloco-theme", "theme-red", null, themes))
		expect(await plugin("uiloco-time", "09:30")).toBe("09:30")
		await refused(plugin("uiloco-time", "25:00"))
		expect(
			await plugin(
				"uiloco-currency",
				{ currency: "GBP", amount: 1234.5, formatted: "lies" },
				{
					plugin: "uiloco-currency",
				}
			)
		).toEqual({
			plugin: "uiloco-currency",
			currency: "GBP",
			amount: 1234.5,
			formatted: "£1,234.50",
		})
		await refused(plugin("uiloco-currency", { currency: "GBP", amount: -1 }))
		expect(await plugin("uiloco-blok-select", { id: "abc-1", extra: "<script>" })).toEqual({
			plugin: "uiloco-blok-select",
			id: "abc-1",
		})
		const dates = await plugin("uiloco-dates", {
			timezone: "Europe/London",
			dates: [{ start_date: "2026-09-15", start_time: "11:00", utc_start: "forged" }],
		})
		expect((dates as { dates: Array<{ utc_start: string }> }).dates[0].utc_start).toBe(
			"2026-09-15T10:00:00.000Z"
		)
		await refused(plugin("uiloco-dates", { timezone: "Mars/Olympus", dates: [] }))
		expect(
			await plugin("uiloco-link", { type: "external", url: "https://x.test", text: "Go" })
		).toMatchObject({
			type: "external",
			url: "https://x.test",
			text: "Go",
		})
		await refused(plugin("uiloco-link", { type: "external", url: "javascript:alert(1)" }))
		await refused(plugin("uiloco-link", { type: "asset", text: "A" }, { type: "external" }))
	})

	test("a link plugin's story link carries a native link's fields, and drops them once it stops", async () => {
		const field = { type: "custom", field_type: "uiloco-link" } as Parameters<typeof normalise>[0]
		const found = { id: 7, uuid: "u7", name: "About", full_slug: "about", published_at: null }
		const put = (value: unknown, existing?: unknown) =>
			normalise(field, value, existing, resolve, async () => found)
		const linked = await put({ type: "internal", story: { id: 7 } })
		expect(linked).toMatchObject({
			story: { id: 7, uuid: "u7", name: "About" },
			fieldtype: "multilink",
			linktype: "story",
			id: "u7",
			cached_url: "about",
		})
		// the same story again keeps what it had, without asking Storyblok
		expect(await normalise(field, { type: "internal", story: { id: 7 } }, linked, resolve)).toEqual(
			linked
		)
		const external = (await put({ type: "external", url: "https://x.test" }, linked)) as object
		for (const key of ["story", "fieldtype", "linktype", "id", "cached_url"])
			expect(external).not.toHaveProperty(key)
		const unpicked = (await put({ type: "internal" }, linked)) as object
		for (const key of ["fieldtype", "linktype", "id", "cached_url"])
			expect(unpicked).not.toHaveProperty(key)
	})

	test("a link plugin's form link keeps its form, which is only chosen in Storyblok", async () => {
		const field = { type: "custom", field_type: "uiloco-link" } as Parameters<typeof normalise>[0]
		const form = { id: "f1", name: "Enquiry", portal: "123" }
		const stored = { plugin: "uiloco-link", type: "form", text: "Ask", form }
		expect(
			await normalise(
				field,
				{ type: "form", text: "Get in touch", form: { id: "evil" } },
				stored,
				resolve
			)
		).toEqual({ ...stored, text: "Get in touch", target: undefined })
		await refused(normalise(field, { type: "form", form }, { type: "external" }, resolve))
	})

	test("a field switched from Storyblok's own link keeps an old story link through an edit", async () => {
		const field = { type: "custom", field_type: "uiloco-link" } as Parameters<typeof normalise>[0]
		const found = { id: 7, uuid: "u7", name: "About", full_slug: "about-us", published_at: null }
		const native = {
			fieldtype: "multilink",
			linktype: "story",
			id: "u7",
			url: "",
			cached_url: "about",
		}
		// the panel sends what it shows: the old link as the plugin holds it, with its story by id
		const saved = await normalise(
			field,
			{ type: "internal", text: "About us", story: { id: 7, uuid: "u7", name: "About" } },
			native,
			resolve,
			async () => found
		)
		expect(saved).toMatchObject({
			type: "internal",
			text: "About us",
			story: { id: 7, uuid: "u7", name: "About" },
			fieldtype: "multilink",
			linktype: "story",
			id: "u7",
			cached_url: "about-us",
		})
	})

	test("a floor plans value keeps its images by id, asks Storyblok for new ones, and drops the rest", async () => {
		const plan = { fieldtype: "asset", id: 1, filename: "old.jpg", alt: "", title: "Kept" }
		const stored = {
			plugin: "plans",
			_active_type: "t",
			types: [{ id: "t", name: "A", floors: [{ id: "f", name: "Ground", plan, dimensions: [] }] }],
		}
		const next = {
			types: [
				{
					id: "t",
					name: "Apartment A",
					junk: "dropped",
					floors: [
						{ id: "f", name: "Ground", plan: { id: 1, alt: "Plan" }, dimensions: [] },
						{
							id: "g",
							name: "First",
							plan: { id: 9 },
							dimensions: [
								{
									id: "d",
									name: "",
									rooms: [{ id: "r", name: "Bed", area_m: "3 x 4m", area_ft: "" }],
								},
							],
						},
					],
				},
			],
		}
		const out = (await check("custom", next, stored, { field_type: "plans" })) as typeof stored
		expect(out._active_type).toBe("t")
		expect(out.types[0]).not.toHaveProperty("junk")
		expect(out.types[0].name).toBe("Apartment A")
		expect(out.types[0].floors[0].plan).toEqual({ ...plan, alt: "Plan" })
		expect(out.types[0].floors[1].plan).toMatchObject({
			id: 9,
			filename: asset.filename,
			fieldtype: "asset",
		})
		expect(input_of({ type: "custom", field_type: "uiloco-time" }, "09:30")).toBe("09:30")
	})

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

describe("a plugin's moxy keys", () => {
	test("a field's own option, else the space's Moxy datasource, before any other", async () => {
		const { moxy_setting } = await import("./ops.js")
		const asked: Array<string> = []
		const entries: Record<string, Array<{ name: string; value: string }>> = {
			"1": [{ name: "MOXY_MUX_SECRET_ID", value: "from-other" }],
			"2": [
				{ name: "MOXY_MUX_SECRET_ID", value: "from-moxy" },
				{ name: "NOT_OURS", value: "x" },
			],
		}
		const editor = {
			space: `s${Math.random()}`,
			mapi: async (path: string) => {
				asked.push(path)
				if (path.startsWith("/datasources/"))
					return {
						datasources: [
							{ id: 1, name: "Colours", slug: "colours" },
							{ id: 2, name: "Moxy", slug: "moxy" },
						],
					}
				return { datasource_entries: entries[path.match(/datasource_id=(\d+)/)![1]] }
			},
		} as never
		const field = (value: string) => ({
			type: "custom",
			field_type: "mux-field",
			options: [{ name: "MOXY_MUX_SECRET_ID", value }],
		})
		expect(await moxy_setting(editor, field("own"), "MOXY_MUX_SECRET_ID")).toBe("own")
		expect(asked).toEqual([])
		expect(await moxy_setting(editor, field(""), "MOXY_MUX_SECRET_ID")).toBe("from-moxy")
		// the Moxy datasource answered, so the others weren't read
		expect(asked.filter((p) => p.includes("datasource_id=1"))).toEqual([])
		expect(await moxy_setting(editor, field(""), "NOT_OURS")).toBeUndefined()
	})
})
