import { describe, expect, test } from "bun:test"
import {
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
	shows_rich,
	rich_supported,
	same,
	assets_in,
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
