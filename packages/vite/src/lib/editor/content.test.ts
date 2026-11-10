import { describe, expect, test } from "bun:test"
import {
	draft_is_live,
	fields_at,
	at_reading_line,
	is_heading,
	is_link,
	is_plans,
	is_text,
	is_video,
	like_page,
	copy_blok,
	differences,
	find_blok,
	locate,
	paragraphs,
	with_paragraph,
	rich_compact,
	rich_images,
	shows_rich,
	rich_supported,
	same,
	assets_in,
	blok_choices,
	dash,
	date_entry,
	plugin_of,
	page_name,
	page_of,
	who_is_where,
	theme_choices,
	set_asset,
	set_text,
	string_at,
	strings_of,
	trail,
	with_string,
} from "./content.js"

describe("editor content", () => {
	const hero = {
		_uid: "hero",
		component: "hero",
		title: { text: "Hi", level: 1, tag: "h1" },
		action: "Go",
		body: { type: "doc" },
	}
	const embed = { _uid: "embed", component: "buttons" }
	const content = {
		_uid: "root",
		blocks: [
			{ _uid: "a" },
			{ _uid: "b", items: [hero] },
			{ _uid: "c", body: { type: "doc", content: [{ type: "blok", attrs: { body: [embed] } }] } },
		],
	}

	test("finds the story root, nested bloks and richtext embeds by reference", () => {
		expect(find_blok(content, "root")).toBe(content)
		expect(find_blok(content, "hero")).toBe(hero)
		expect(find_blok(content, "embed")).toBe(embed)
		expect(find_blok(content, "missing")).toBeUndefined()
	})

	test("sets text fields and keeps a heading's level", () => {
		const blok = structuredClone(hero)
		expect(set_text(blok, "title", "Hello")).toBe(true)
		expect(blok.title).toEqual({ text: "Hello", level: 1, tag: "h1" })
		expect(set_text(blok, "action", "Go now")).toBe(true)
		expect(blok.action).toBe("Go now")
		expect(set_text(blok, "body", "nope")).toBe(false)
		expect(set_text(blok, "missing", "nope")).toBe(false)
	})

	test("set_asset only replaces assets, keeping the rest of the field", () => {
		const image = { fieldtype: "asset", id: 1, filename: "a.jpg", alt: "", source: "x" }
		const blok = { image: { ...image }, logos: [{ ...image }], title: "Hi" }
		expect(set_asset(blok, "image", undefined, { id: 2, filename: "b.jpg", alt: "B" })).toBe(true)
		expect(blok.image).toEqual({ ...image, id: 2, filename: "b.jpg", alt: "B" })
		expect(set_asset(blok, "logos", 0, { id: 3 })).toBe(true)
		expect(blok.logos[0].id).toBe(3)
		expect(set_asset(blok, "logos", 4, { id: 3 })).toBe(false)
		expect(set_asset(blok, "title", undefined, { id: 3 })).toBe(false)
		expect(blok.title).toBe("Hi")
	})

	test("an image inside a plugin's value is found by its path, and only replaced where one is", () => {
		const plan = { fieldtype: "asset", id: 1, filename: "plan.jpg", alt: "" }
		const blok = {
			plans: { types: [{ name: "A", floors: [{ name: "Ground", plan: { ...plan } }] }] },
		}
		const path = ["types", 0, "floors", 0, "plan"]
		expect(assets_in(blok.plans)).toEqual([{ path, asset: plan }])
		expect(set_asset(blok, "plans", undefined, { id: 2, filename: "new.jpg" }, path)).toBe(true)
		expect(blok.plans.types[0].floors[0].plan).toEqual({ ...plan, id: 2, filename: "new.jpg" })
		expect(set_asset(blok, "plans", undefined, { id: 3 }, ["types", 0, "name"])).toBe(false)
		expect(set_asset(blok, "plans", undefined, { id: 3 }, ["types", 5, "floors", 0, "plan"])).toBe(
			false
		)
		expect(blok.plans.types[0].name).toBe("A")
	})

	test("locate finds a blok's list in bloks fields and richtext embeds", () => {
		const a = { _uid: "a", component: "x" }
		const b = { _uid: "b", component: "x" }
		const embed = { _uid: "e", component: "x" }
		const content = {
			_uid: "root",
			blocks: [a, b],
			body: { type: "doc", content: [{ type: "blok", attrs: { body: [embed] } }] },
		}
		const place = locate(content, "b")
		expect(place?.field).toBe("blocks")
		expect(place?.index).toBe(1)
		expect(place?.parent).toBe(content)
		expect(locate(content, "e")?.list[0]).toBe(embed)
		expect(locate(content, "root")).toBeUndefined()
		expect(locate(content, "nope")).toBeUndefined()
	})

	test("copy_blok gives every nested blok a new _uid and leaves the original alone", () => {
		const blok = { _uid: "a", component: "cards", items: [{ _uid: "b", component: "card" }] }
		let n = 0
		const copy = copy_blok(blok, () => `new${++n}`)
		expect(copy._uid).toBe("new2")
		expect((copy.items as Array<{ _uid: string }>)[0]._uid).toBe("new1")
		expect(blok.items[0]._uid).toBe("b")
	})

	test("trail runs from the root to the blok", () => {
		const card = { _uid: "c", component: "card" }
		const content = {
			_uid: "r",
			component: "page",
			blocks: [{ _uid: "s", component: "cards", items: [card] }],
		}
		expect(trail(content, "c")?.map((b) => b._uid)).toEqual(["r", "s", "c"])
		expect(trail(content, "r")?.map((b) => b._uid)).toEqual(["r"])
		expect(trail(content, "x")).toBeUndefined()
	})

	test("richtext is only edited when every node and mark is known", () => {
		const doc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Hi there", marks: [{ type: "bold" }] }],
				},
				{
					type: "bullet_list",
					content: [
						{
							type: "list_item",
							content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
						},
					],
				},
			],
		}
		expect(rich_supported(doc)).toBe(true)
		expect(rich_compact(doc)).toBe("HithereOne")
		const embedded = rich_compact({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Get in touch." }] },
				{ type: "blok", attrs: { body: [] } },
				{ type: "paragraph", content: [{ type: "text", text: "Thanks" }] },
			],
		})
		expect(shows_rich("Getintouch.EmailUsThanks", embedded)).toBe(true)
		expect(shows_rich("Getintouch.Thanks", embedded)).toBe(true)
		expect(shows_rich("Getintouch.EmailUs", embedded)).toBe(false)
		expect(shows_rich("Getintouch.Thanks", "Getintouch.Thanks")).toBe(true)
		expect(rich_supported({ type: "doc", content: [{ type: "chart" }] })).toBe(false)
		expect(
			rich_supported({
				type: "doc",
				content: [{ type: "text", text: "x", marks: [{ type: "glitter" }] }],
			})
		).toBe(false)
	})
})

describe("differences", () => {
	const card = (uid: string, title: string) => ({ _uid: uid, component: "card", title })
	const page = (body: Array<object>, title = "Home") => ({
		_uid: "root",
		component: "page",
		title,
		body,
	})

	test("says what was added, removed, edited and reordered, block by block", () => {
		const live = page([card("a", "One"), card("b", "Two"), card("c", "Three")])
		const draft = page([card("b", "Two"), card("a", "Uno"), card("d", "Four")])
		const found = differences(live, draft).map(({ uid, kind, hint }) => [uid, kind, hint])
		expect(found).toEqual([
			["root", "reordered", "Home"],
			["a", "edited", "Uno"],
			["d", "added", "Four"],
			["c", "removed", "Three"],
		])
	})

	test("a new block's own children come with it, and nothing changed says nothing", () => {
		const live = page([])
		const added = { ...card("a", "One"), items: [card("x", "Inner")] }
		expect(differences(live, page([added])).map((d) => d.uid)).toEqual(["a"])
		expect(differences(live, { ...live, _editable: "<!--#storyblok#-->" })).toEqual([])
	})

	test("richtext saved differently but showing the same isn't a change", () => {
		const text = (marks: Array<object>, attrs?: object) => ({
			_uid: "r",
			component: "rich",
			body: {
				type: "doc",
				...(attrs && { attrs }),
				content: [{ type: "text", text: "Hi", marks }],
			},
		})
		const bold = { type: "bold" }
		const colour = { type: "textStyle", attrs: { color: "red", id: null } }
		expect(
			differences(
				text([bold, colour]),
				text([{ type: "textStyle", attrs: { color: "red" } }, bold], { textAlign: null })
			)
		).toEqual([])
		expect(differences(text([bold]), text([])).map((d) => d.kind)).toEqual(["edited"])
	})
})

describe("an old version shown on the page", () => {
	const story = (uuid: string, name: string) => ({ uuid, name, full_slug: name, content: {} })
	const a = story("aaaaaaaa-0000-0000-0000-000000000000", "a")
	const b = story("bbbbbbbb-0000-0000-0000-000000000000", "b")
	const link = { id: a.uuid, linktype: "story", cached_url: "a" }
	const page = {
		_uid: "root",
		component: "page",
		body: [
			{ _uid: "x", component: "cards", title: "Now", picks: [a, b], link: { ...link, story: a } },
		],
	}

	test("keeps the page's resolved relations and links where the version has them the same", () => {
		const version = {
			_uid: "root",
			component: "page",
			body: [{ _uid: "x", component: "cards", title: "Then", picks: [a.uuid, b.uuid], link }],
		}
		const shown = like_page(version, page) as typeof page
		expect(shown.body[0].title).toBe("Then")
		expect(shown.body[0].picks).toEqual([a, b])
		expect(shown.body[0].link).toEqual({ ...link, story: a })
	})

	test("resolves a changed relation from stories the page has, leaving out any it hasn't", () => {
		const version = {
			_uid: "root",
			component: "page",
			body: [{ _uid: "x", component: "cards", title: "Now", picks: [b.uuid, "gone"], link }],
		}
		expect((like_page(version, page) as typeof page).body[0].picks).toEqual([b])
	})
})

describe("same", () => {
	test("text Storyblok hands back with its keys in another order is the same text", () => {
		const typed = {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
		}
		const stored = {
			content: [{ content: [{ text: "Hi", type: "text" }], type: "paragraph" }],
			type: "doc",
		}
		expect(same(typed, stored)).toBe(true)
		expect(same(typed, { ...stored, content: [] })).toBe(false)
	})
})

test("storyloco's plugins by any of the names they've had", () => {
	for (const field_type of ["uiloco-heading", "heading-field"])
		expect(is_heading({ field_type })).toBe(true)
	for (const field_type of ["uiloco-mux", "mux-field", "loco-mux", "video-mux"])
		expect(is_video({ field_type })).toBe(true)
	for (const field_type of ["uiloco-link", "loco-link", "link-field"])
		expect(is_link({ field_type })).toBe(true)
	expect(is_heading({ field_type: "uiloco-mux" })).toBe(false)
	expect(is_video(undefined)).toBe(false)
})

test("text fields: plain text, and a heading's or a link's text", () => {
	for (const type of ["text", "textarea", "markdown"]) expect(is_text({ type })).toBe(true)
	expect(is_text({ type: "custom", field_type: "uiloco-link" })).toBe(true)
	expect(is_text({ type: "custom", field_type: "uiloco-heading" })).toBe(true)
	expect(is_text({ type: "custom", field_type: "uiloco-mux" })).toBe(false)
	expect(is_text({ type: "richtext" })).toBe(false)
	expect(is_text(undefined)).toBe(false)
})

describe("paragraphs", () => {
	const body = "First one.\n\nSecond, over\ntwo lines.\n \n\nThird."

	test("split at blank lines, as a site shows them, empty ones left out", () => {
		expect(paragraphs(body)).toEqual(["First one.", "Second, over\ntwo lines.", "Third."])
	})

	test("one replaced, the rest as they were", () => {
		expect(paragraphs(with_paragraph(body, 1, "Second."))).toEqual([
			"First one.",
			"Second.",
			"Third.",
		])
		expect(with_paragraph("A\n\nB", 0, "Z")).toBe("Z\n\nB")
	})
})

describe("a plugin's strings", () => {
	const plans = {
		_active_type: "t1",
		types: [
			{
				id: "t1",
				name: "Apartment 1",
				floors: [
					{
						id: "f1",
						name: "Ground Floor",
						plan: { id: 7, filename: "https://a.storyblok.com/f/1/plan.jpg", fieldtype: "asset" },
						dimensions: [
							{
								id: "d1",
								name: "Apartment 1",
								rooms: [
									{ id: "r1", name: "Utility", area_m: "2.58m x 1.67m", area_ft: "8’5” x 5’5”" },
								],
							},
						],
					},
				],
			},
		],
	}
	const floor = ["types", 0, "floors", 0, "name"]

	test("names and sizes, with where each is: not ids, assets, links or markers", () => {
		expect(strings_of(plans).map(({ text }) => text)).toEqual([
			"Apartment 1",
			"Ground Floor",
			"Apartment 1",
			"Utility",
			"2.58m x 1.67m",
			"8’5” x 5’5”",
		])
		expect(string_at(plans, floor)).toBe("Ground Floor")
		expect(string_at(plans, ["types", 0, "id"])).toBeUndefined()
		expect(string_at(plans, ["types", 0, "floors", 0, "plan", "filename"])).toBeUndefined()
		expect(strings_of({ link: "https://example.com", path: "/about" })).toEqual([])
		expect(strings_of("A plain string")).toEqual([])
	})

	test("one replaced, the rest as they were, and nothing written that isn't text there", () => {
		const next = with_string(plans, floor, "First Floor")
		expect(string_at(next, floor)).toBe("First Floor")
		expect({ ...next, types: [] }).toEqual({ ...plans, types: [] })
		expect(strings_of(next).length).toBe(strings_of(plans).length)
		expect(plans.types[0].floors[0].name).toBe("Ground Floor")
		expect(with_string(plans, ["types", 0, "id"], "x")).toBeUndefined()
		expect(with_string(plans, ["types", 0, "floors"], "x")).toBeUndefined()
		expect(with_string(plans, ["types", 9, "name"], "x")).toBeUndefined()
		expect(with_string(plans, ["__proto__", "name"], "x")).toBeUndefined()
		expect(with_string(["a"], [0], "x")).toBeUndefined()
		expect(is_plans({ field_type: "uiloco-plans" })).toBe(true)
		// by the name a space deployed it under before
		expect(is_plans({ field_type: "plans" })).toBe(true)
		expect(is_plans({ field_type: "uiloco-heading" })).toBe(false)
	})
})

describe("storyloco's plugins in the panel", () => {
	test("plugin_of names each by what its space deployed it as", () => {
		expect(plugin_of({ field_type: "plans" })).toBe("plans")
		expect(plugin_of({ field_type: "uiloco-time" })).toBe("time")
		expect(plugin_of({ field_type: "link-field" })).toBe("link")
		expect(plugin_of({ field_type: "uiloco-hubspot-form" })).toBeUndefined()
	})

	test("theme choices are keyed as the theme plugin keys them", () => {
		expect(["Dark Green", "darkGreen", "NAVY", "sky_blue"].map(dash)).toEqual([
			"dark-green",
			"dark-green",
			"navy",
			"sky-blue",
		])
		expect(theme_choices([{ name: "Dark Green", value: "#0a3, #fff" }])).toEqual([
			{ name: "Dark Green", value: "theme-dark-green", colors: ["#0a3", "#fff"] },
		])
	})

	test("a dates entry gets its UTC instants, across a clock change, and blanks as null", () => {
		expect(date_entry({ start_date: "2026-09-15", start_time: "11:00" }, "Europe/London")).toEqual({
			start_date: "2026-09-15",
			start_time: "11:00",
			end_date: null,
			end_time: null,
			utc_start: "2026-09-15T10:00:00.000Z",
			utc_end: null,
		})
		const winter = date_entry(
			{ start_date: "2026-12-01", start_time: "09:00", end_time: "17:30", end_date: "" },
			"Europe/London"
		)
		expect([winter.utc_start, winter.utc_end]).toEqual([
			"2026-12-01T09:00:00.000Z",
			"2026-12-01T17:30:00.000Z",
		])
		// an end time means nothing without a start time
		expect(date_entry({ start_date: "2026-12-01", end_time: "10:00" }, "UTC").end_time).toBeNull()
	})

	test("a blok select's choices are the story's blocks and those nested in them", () => {
		const content = {
			blocks: [
				{ _uid: "a", component: "area", title: "Top", blocks: [{ _uid: "b", component: "card" }] },
				{ component: "no uid" },
			],
		}
		expect(blok_choices(content)).toEqual([
			{ id: "a", label: "area · Top", depth: 0 },
			{ id: "b", label: "card", depth: 1 },
		])
	})
})

describe("a richtext field's own images", () => {
	test("found by their src, however deep, and nothing else", () => {
		const logo = "https://a.storyblok.com/f/1/349x104/abc/logo.png"
		const doc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "Welcome to" },
						{ type: "hard_break" },
						{ type: "image", attrs: { src: logo, alt: "" } },
					],
				},
				{ type: "image", attrs: { alt: "no src" } },
			],
		}
		expect(rich_images(doc)).toEqual([logo])
		expect(rich_images({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([])
		expect(rich_images(null)).toEqual([])
	})
})

describe("who's where on the site", () => {
	test("a page is its site, path and query, without what's only for this visit", () => {
		expect(page_of("https://a.test/news?page=2")).toBe("https://a.test/news?page=2")
		expect(page_of("https://a.test/")).toBe("https://a.test/")
		expect(
			page_of("https://a.test/form?sl_share=abc&comment=9&_storyblok=1&_storyblok_tk[x]=2")
		).toBe("https://a.test/form")
		expect(page_of("https://a.test/news?page=2&sl_share=abc")).toBe("https://a.test/news?page=2")
		// two sites in one space each have a home page, and they aren't the same one
		expect(page_of("https://a.test/")).not.toBe(page_of("https://b.test/"))
		// the room keeps 200 characters: a query that wouldn't fit goes whole
		expect(page_of(`https://a.test/news?q=${"x".repeat(300)}`)).toBe("https://a.test/news")
	})

	test("a page is named as someone would say it", () => {
		const origin = "https://a.test"
		expect(page_name("https://a.test/", origin)).toBe("Home")
		expect(page_name("https://a.test/news?page=2", origin)).toBe("/news?page=2")
		expect(page_name("https://a.test/caf%C3%A9", origin)).toBe("/café")
		expect(page_name("https://a.test/50%off", origin)).toBe("/50%off")
		expect(page_name("https://b.test/", origin)).toBe("b.test")
		expect(page_name("https://b.test/form", origin)).toBe("b.test/form")
		// a tab still on an older editor says only the path
		expect(page_name("/news", origin)).toBe("/news")
	})

	const tab = (id: string, user: number | string, page: string | null, joined = 0) => ({
		id,
		user: { id: user },
		page,
		joined,
	})
	const ids = (list: Array<{ id: string }>) => list.map(({ id }) => id)
	const base = { me: "me", page: "/here", moved: new Map<string, number>(), following: null }

	test("others are on this page or elsewhere, and never me, in any tab", () => {
		const { here, elsewhere, followed } = who_is_where({
			...base,
			people: [
				tab("me", 1, "/here"),
				tab("my-other-tab", 1, "/there"),
				tab("a", 2, "/here"),
				tab("b", 3, "/there"),
				tab("just-connected", 4, null),
			],
		})
		expect(ids(here)).toEqual(["a"])
		expect(ids(elsewhere)).toEqual(["b"])
		expect(followed).toBeNull()
	})

	test("someone with several tabs is one person: here if any tab is, else where they moved last", () => {
		const people = [tab("me", 1, "/here"), tab("a1", 2, "/old", 1), tab("a2", 2, "/new", 2)]
		expect(ids(who_is_where({ ...base, people }).elsewhere)).toEqual(["a2"])
		const moved = new Map([["a1", 9]])
		expect(ids(who_is_where({ ...base, people, moved }).elsewhere)).toEqual(["a1"])
		const present = [...people, tab("a3", 2, "/here", 0)]
		const seen = who_is_where({ ...base, people: present })
		expect(ids(seen.here)).toEqual(["a3"])
		expect(seen.elsewhere).toEqual([])
	})

	test("following goes by the person, so it survives a new tab or a reload", () => {
		const before = [tab("me", 1, "/here"), tab("old-connection", 2, "/here")]
		const after = [tab("me", 1, "/here"), tab("new-connection", 2, "/next")]
		expect(who_is_where({ ...base, people: before, following: "2" }).followed?.id).toBe(
			"old-connection"
		)
		expect(who_is_where({ ...base, people: after, following: "2" }).followed?.id).toBe(
			"new-connection"
		)
		// they're followed to the tab they're using, even with an older one still on this page
		const both = [tab("me", 1, "/here"), tab("a1", 2, "/here", 1), tab("a2", 2, "/next", 2)]
		const moved = new Map([["a2", 5]])
		const seen = who_is_where({ ...base, people: both, following: "2", moved })
		expect(seen.followed?.id).toBe("a2")
		expect(ids(seen.here)).toEqual(["a1"])
	})

	test("a page that isn't a safe address is ignored, as anyone in the room can say anything", () => {
		const bad = [
			"http://[",
			"javascript:alert(1)",
			"data:text/html,x",
			"https://a.test//evil.test",
			"//",
		]
		const people = [tab("me", 1, "/here"), ...bad.map((page, i) => tab(`x${i}`, 10 + i, page))]
		const seen = who_is_where({ ...base, people, following: "10" })
		expect(seen.elsewhere).toEqual([])
		expect(seen.followed).toBeNull()
		// a bare path, from a tab on an older editor, is fine
		const old = who_is_where({ ...base, people: [tab("me", 1, "/here"), tab("a", 2, "/news")] })
		expect(ids(old.elsewhere)).toEqual(["a"])
	})

	test("someone on another site of the same space isn't here: staging's guests don't show on a developer's machine", () => {
		const people = [
			tab("me", 1, "https://localhost:3473/"),
			tab("guest", 2, "https://next.example.com/"),
			tab("local", 3, "https://localhost:3473/about"),
			tab("old-editor", 4, "/news"),
		]
		const seen = who_is_where({ ...base, page: "https://localhost:3473/", people, following: "2" })
		expect(ids(seen.elsewhere)).toEqual(["local", "old-editor"])
		expect(seen.here).toEqual([])
		expect(seen.followed).toBeNull()
	})

	test("the latest tab doesn't compare this browser's clock with the room's", () => {
		// moved a moment ago by a slow clock, against a later join by the room's
		const people = [
			tab("me", 1, "/here"),
			tab("moved", 2, "/a", 1000),
			tab("idle", 2, "/b", 900000),
		]
		const moved = new Map([["moved", 500]])
		expect(ids(who_is_where({ ...base, people, moved }).elsewhere)).toEqual(["moved"])
	})

	test("a guest sees their own page, and whoever they follow", () => {
		const people = [
			tab("me", "g", "/here"),
			tab("a", 2, "/here"),
			tab("b", 3, "/draft"),
			tab("c", 4, "/other"),
		]
		const seen = who_is_where({ ...base, people, guest: true })
		expect(ids(seen.here)).toEqual(["a"])
		expect(seen.elsewhere).toEqual([])
		expect(ids(who_is_where({ ...base, people, guest: true, following: "3" }).elsewhere)).toEqual([
			"b",
		])
	})
})

describe("at_reading_line", () => {
	const blocks = [
		{ top: 0, bottom: 100 },
		{ top: 100, bottom: 700 },
		{ top: 700, bottom: 800 },
	]

	test("the line runs down the window as the page does, so short first and last blocks get a turn", () => {
		expect(at_reading_line(blocks, 0, 2000, 800)).toBe(blocks[0])
		expect(at_reading_line(blocks, 1000, 2000, 800)).toBe(blocks[1])
		expect(at_reading_line(blocks, 2000, 2000, 800)).toBe(blocks[2])
	})

	test("the nearest when the line's between blocks, and only those in the window", () => {
		const gaps = [
			{ top: -300, bottom: -10 },
			{ top: 50, bottom: 300 },
			{ top: 500, bottom: 900 },
			{ top: 900, bottom: 1200 },
		]
		expect(at_reading_line(gaps, 1.2, 2, 800)).toBe(gaps[2])
		expect(at_reading_line(gaps, 0, 2000, 800)).toBe(gaps[1])
		expect(at_reading_line([gaps[0]], 0, 2000, 800)).toBeUndefined()
	})

	test("a page that doesn't scroll reads from the top", () => {
		expect(at_reading_line(blocks, 0, 0, 800)).toBe(blocks[0])
	})
})

describe("fields_at", () => {
	const hero = "VisNetForecastCreateaccuratescenariosBookademo"
	const cta = "BookyourfreedemotodaySeehowBookademo"
	const beside = [["Createaccuratescenarios"], ["Bookyourfreedemotoday"]]

	test("each place gets the field whose neighbours it's among, whatever order they're in", () => {
		expect(fields_at(beside, [hero, cta], 0)).toEqual([0])
		expect(fields_at(beside, [hero, cta], 1)).toEqual([1])
		expect(fields_at(beside, [cta, hero], 0)).toEqual([1])
	})

	test("a neighbour's words turning up in another section don't make it home", () => {
		const both = [["VisNet", "Createaccuratescenarios"], ["Bookyourfreedemotoday"]]
		const mentions = "BookyourfreedemotodaySeehowVisNethelpsBookademo"
		expect(fields_at(both, ["VisNetCreateaccuratescenariosBookademo", mentions], 1)).toEqual([1])
	})

	test("a place showing a default isn't the field that's only seen elsewhere", () => {
		expect(fields_at([["Bookyourfreedemotoday"]], [hero, cta], 0)).toEqual([])
		expect(fields_at([["Bookyourfreedemotoday"]], [hero, cta], 1)).toEqual([0])
	})

	test("with nothing to go on, every field is still a candidate", () => {
		expect(fields_at([[], []], [hero, cta], 0)).toEqual([0, 1])
	})

	test("a field seen nowhere can take a place no other field is seen at", () => {
		expect(fields_at([[], ["Bookyourfreedemotoday"]], [hero, cta], 0)).toEqual([0])
	})
})

describe("draft_is_live", () => {
	const published_at = "2026-11-09T10:00:00Z"

	test("a story left out of the reply has nothing to publish", () => {
		expect(draft_is_live([], 1)).toBe(true)
		expect(draft_is_live([{ id: 2, published_at, changes: [{}] }], 1)).toBe(true)
	})

	test("a story listed is live only when it was published and nothing differs", () => {
		expect(draft_is_live([{ id: 1, published_at, changes: [] }], 1)).toBe(true)
		expect(draft_is_live([{ id: 1, published_at, changes: [{}] }], 1)).toBe(false)
		expect(draft_is_live([{ id: 1, published_at: null, changes: null }], 1)).toBe(false)
	})

	test("with no reply or no live copy to compare, it can't say so", () => {
		expect(draft_is_live(undefined, 1)).toBe(false)
		expect(draft_is_live([{ id: 1, published_at, changes: null }], 1)).toBe(false)
	})
})
