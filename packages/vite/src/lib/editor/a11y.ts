/**
 * The accessibility check: what can be told about a page from the page as it's rendered, since
 * contrast only exists there. What it can't be sure of, like text over a photo, it asks a person
 * to look at rather than guess. Automated checks only ever catch part of what matters.
 */

export type Rgba = [r: number, g: number, b: number, a: number]

const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

/** `rgb()` and `rgba()` as browsers serialise them; anything else is for `colour_of` */
export function parse_rgb(css: string): Rgba | null {
	const match = css.match(
		/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i
	)
	if (!match) return null
	const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] ? 100 : 1)
	return [Number(match[1]), Number(match[2]), Number(match[3]), alpha]
}

let painter: CanvasRenderingContext2D | null | undefined

/** Any CSS colour as sRGB: a canvas turns `oklch()`, `color()` and the rest into pixels for free */
export function colour_of(css: string): Rgba {
	const plain = parse_rgb(css)
	if (plain) return plain
	painter ??= Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext(
		"2d",
		{ willReadFrequently: true }
	)
	if (!painter) return [0, 0, 0, 0]
	painter.clearRect(0, 0, 1, 1)
	painter.fillStyle = "#000"
	painter.fillStyle = css
	painter.fillRect(0, 0, 1, 1)
	const [r, g, b, a] = painter.getImageData(0, 0, 1, 1).data
	return [r, g, b, a / 255]
}

/** One colour over another, opaque or not */
export function over(top: Rgba, under: Rgba): Rgba {
	const a = top[3] + under[3] * (1 - top[3])
	if (!a) return [0, 0, 0, 0]
	const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a
	return [mix(0), mix(1), mix(2), a]
}

const luminance = ([r, g, b]: Rgba) => {
	const channel = (value: number) => {
		const c = value / 255
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG's contrast ratio between two opaque colours, 1 to 21 */
export function contrast(a: Rgba, b: Rgba) {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
	return (light + 0.05) / (dark + 0.05)
}

/** The ratio AA asks of text: large text, 24px or 18.66px bold, may be lower */
export const needed = (size: number, weight: number) =>
	size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5

export const hex = ([r, g, b]: Rgba) =>
	`#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`

/** The nearest colour to `fg` that reads on `bg`, moved only as far toward black or white as it takes */
export function suggest(fg: Rgba, bg: Rgba, target: number) {
	const end: Rgba =
		contrast([0, 0, 0, 1], bg) >= contrast([255, 255, 255, 1], bg)
			? [0, 0, 0, 1]
			: [255, 255, 255, 1]
	for (let step = 1; step <= 40; step++) {
		const t = step / 40
		const next: Rgba = [
			clamp(fg[0] + (end[0] - fg[0]) * t),
			clamp(fg[1] + (end[1] - fg[1]) * t),
			clamp(fg[2] + (end[2] - fg[2]) * t),
			1,
		]
		if (contrast(next, bg) >= target) return next
	}
	return end
}

export type Heading = { level: number; text: string }
export type HeadingProblem = { index: number; problem: "empty" | "skipped" | "another_h1" }

/** What's wrong with a page's headings as an outline, which is how many people move through it */
export function heading_problems(headings: ReadonlyArray<Heading>) {
	const problems: Array<HeadingProblem> = []
	let last = 0
	let seen_h1 = false
	headings.forEach(({ level, text }, index) => {
		if (!text.trim()) problems.push({ index, problem: "empty" })
		if (level === 1 && seen_h1) problems.push({ index, problem: "another_h1" })
		if (last && level > last + 1) problems.push({ index, problem: "skipped" })
		seen_h1 ||= level === 1
		last = level
	})
	return { problems, no_h1: !seen_h1 }
}

const VAGUE =
	/^(click here|click|here|read more|more|learn more|find out more|more info(rmation)?|this|link|details|view|view more|see more|go|continue)[.…!]*$/i

/** Why a link's words won't make sense read out of context, as a screen reader's list of links does */
export function link_problem(name: string): "vague" | "url" | null {
	const text = name.trim()
	if (/^(https?:\/\/|www\.)\S+$/i.test(text)) return "url"
	return VAGUE.test(text) ? "vague" : null
}

/** Why alt text that's there isn't doing its job */
export function alt_problem(alt: string): "filename" | "redundant" | "long" | null {
	const text = alt.trim()
	if (!text) return null
	if (
		/\.(jpe?g|png|gif|webp|avif|svg|heic|tiff?)$/i.test(text) ||
		/^(img|image|dsc|dscn|pxl|screenshot|photo)[-_ ]?\d+/i.test(text) ||
		/^[\w]+([-_][\w]+)+$/.test(text)
	)
		return "filename"
	if (/^(an? )?(image|picture|photo|photograph|graphic) of\b/i.test(text)) return "redundant"
	return text.length > 200 ? "long" : null
}

// --- the page

export type Issue = {
	/** The same problem again adds to this one's count */
	key: string
	group: "contrast" | "images" | "headings" | "links" | "forms" | "video" | "page"
	/** `fail`s are clear problems; `review`s need a person to look */
	severity: "fail" | "review"
	title: string
	why: string
	/** Some of the text, to recognise it by */
	sample?: string
	el: Element | null
	count: number
	/** The colours, for showing the problem and a fix */
	colours?: { fg: string; bg: string; ratio: number; needed: number; suggestion: string }
}

const SKIP = "script,style,noscript,template,[data-storyloco]"
const shown = (el: Element) => {
	if (el.closest(SKIP) || el.closest("[aria-hidden=true]")) return false
	const box = el.getBoundingClientRect()
	return (
		box.width > 1 &&
		box.height > 1 &&
		el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
	)
}

const snippet = (text: string | null | undefined) => {
	const flat = (text ?? "").replace(/\s+/g, " ").trim()
	return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat
}

/** What a link or button is called to someone who can't see it, near enough */
function name_of(el: Element) {
	const labelled = el.getAttribute("aria-labelledby")
	const named =
		el.getAttribute("aria-label") ||
		(labelled &&
			labelled
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent ?? "")
				.join(" ")) ||
		(el as HTMLElement).innerText ||
		[...el.querySelectorAll("img[alt], svg title, [aria-label]")]
			.map(
				(inner) =>
					inner.getAttribute("alt") || inner.getAttribute("aria-label") || inner.textContent || ""
			)
			.join(" ") ||
		el.getAttribute("title") ||
		(el as HTMLInputElement).value ||
		""
	return named.trim()
}

/**
 * Check the page as it's rendered now, at this width: what's hidden, like a closed accordion, isn't
 * looked at. `is_field` says whether an image is a field someone fills in, since an empty alt there
 * has been left out, while one elsewhere is how a template says an image is only decoration.
 */
export async function audit(is_field: (img: HTMLImageElement) => Promise<boolean>) {
	const found = new Map<string, Issue>()
	const add = (issue: Omit<Issue, "count">) => {
		const known = found.get(issue.key)
		if (known) known.count++
		else found.set(issue.key, { ...issue, count: 1 })
	}

	contrast_of_text(add)
	await images(add, is_field)
	headings(add)
	links_and_buttons(add)
	form_fields(add)
	videos(add)
	page(add)
	return [...found.values()]
}

type Add = (issue: Omit<Issue, "count">) => void

function contrast_of_text(add: Add) {
	const root = colour_of(getComputedStyle(document.documentElement).backgroundColor)
	const canvas = over(root, colour_of("Canvas"))
	/** What shows behind an element: null when there's an image or gradient in it */
	const behind = new Map<Element, Rgba | null>()
	function background_of(el: Element | null): Rgba | null {
		if (!el) return canvas[3] === 1 ? canvas : [255, 255, 255, 1]
		const known = behind.get(el)
		if (known !== undefined) return known
		const style = getComputedStyle(el)
		const own = colour_of(style.backgroundColor)
		let result: Rgba | null
		if (style.backgroundImage !== "none") result = null
		else if (own[3] === 1) result = own
		else {
			const under = background_of(el.parentElement)
			result = under && over(own, under)
		}
		behind.set(el, result)
		return result
	}

	const media = [...document.querySelectorAll("img,video,canvas,iframe,picture")]
		.filter((el) => !el.closest(SKIP))
		.map((el) => ({ el, box: el.getBoundingClientRect() }))
		.filter(({ box }) => box.width > 40 && box.height > 40)

	/** The nearest element around this one that paints a solid background */
	const solid_around = (el: Element) => {
		for (let at: Element | null = el; at; at = at.parentElement)
			if (colour_of(getComputedStyle(at).backgroundColor)[3] === 1) return at
		return null
	}

	/**
	 * How far the text is faded against its background. Opacity on the background or beyond fades the
	 * two together, like a carousel dimming a slide, which leaves this at the colours as designed; so
	 * does one mid-animation, on its way somewhere, like a block that fades in as it scrolls up.
	 */
	const opacity_of = (el: Element, solid: Element | null) => {
		let opacity = 1
		for (let at: Element | null = el; at && at !== solid; at = at.parentElement) {
			const own = Number(getComputedStyle(at).opacity)
			if (own < 1 && !at.getAnimations().length) opacity *= own
		}
		return opacity
	}

	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
	const seen = new Set<Element>()
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const el = node.parentElement
		if (!el || seen.has(el) || !node.textContent?.trim()) continue
		seen.add(el)
		if (el.closest("[disabled],[aria-disabled=true]") || !shown(el)) continue

		const style = getComputedStyle(el)
		const painted = colour_of(style.webkitTextFillColor || style.color)
		if (!painted[3]) continue
		const range = document.createRange()
		range.selectNodeContents(node)
		const box = range.getBoundingClientRect()
		if (box.width < 1 || box.height < 1) continue

		const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
		const solid = solid_around(el)
		// a solid box around the text that the image isn't in sits over it, like a cookie banner
		const on_media = media.find(
			({ el: shows, box: at }) =>
				!shows.contains(el) &&
				(!solid || solid.contains(shows)) &&
				x >= at.left &&
				x <= at.right &&
				y >= at.top &&
				y <= at.bottom
		)
		const bg = background_of(el)
		if (on_media || !bg) {
			add({
				key: `contrast:over:${on_media ? "media" : "image"}`,
				group: "contrast",
				severity: "review",
				title: "Text over an image",
				why: "Contrast can’t be measured here. Check it reads, across the whole image and at every screen size.",
				sample: snippet(node.textContent),
				el,
			})
			continue
		}

		const fg = over([painted[0], painted[1], painted[2], painted[3] * opacity_of(el, solid)], bg)
		const ratio = contrast(fg, bg)
		const size = parseFloat(style.fontSize)
		const target = needed(size, Number(style.fontWeight) || 400)
		if (ratio >= target) continue
		add({
			key: `contrast:${hex(fg)}:${hex(bg)}:${target}`,
			group: "contrast",
			severity: "fail",
			title: `Contrast ${ratio.toFixed(1)}:1, needs ${target}:1`,
			why:
				target === 3
					? "Large text needs at least 3:1 to read comfortably."
					: "Text this size needs at least 4.5:1 to read comfortably.",
			sample: snippet(node.textContent),
			el,
			colours: {
				fg: hex(fg),
				bg: hex(bg),
				ratio,
				needed: target,
				suggestion: hex(suggest(fg, bg, target)),
			},
		})
	}
}

async function images(add: Add, is_field: (img: HTMLImageElement) => Promise<boolean>) {
	const all = [...document.querySelectorAll("img")].filter(shown)
	await Promise.all(
		all.map(async (img) => {
			const src = img.currentSrc || img.src
			const alt = img.getAttribute("alt")
			const sample = decodeURIComponent(src.split("/m/")[0].split("/").pop() ?? "")
			if (alt === null || (!alt.trim() && (await is_field(img).catch(() => false))))
				return add({
					key: `alt:missing:${src}`,
					group: "images",
					severity: "fail",
					title: "No alt text",
					why: "Someone who can’t see this image won’t know what it shows. If it’s only decoration, say so to a developer instead.",
					sample,
					el: img,
				})
			const problem = alt_problem(alt)
			if (problem)
				add({
					key: `alt:${problem}:${src}`,
					group: "images",
					severity: "review",
					title: {
						filename: "Alt text looks like a file name",
						redundant: "Alt text says it’s an image",
						long: "Alt text is very long",
					}[problem],
					why: {
						filename: "Say what the image shows and why it’s here.",
						redundant: "Screen readers already say it’s an image, so start with what it shows.",
						long: "Keep it to a sentence or so. Screen readers read it all, with no way to skim.",
					}[problem],
					sample: snippet(alt),
					el: img,
				})
		})
	)
}

function headings(add: Add) {
	// by what's displayed rather than its size: an empty one has no height, and is still announced
	const list = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading][aria-level]")]
		.filter(
			(el) =>
				!el.closest(SKIP) &&
				!el.closest("[aria-hidden=true]") &&
				el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
		)
		.map((el) => ({
			el,
			level: Number(el.getAttribute("aria-level") ?? el.tagName[1]),
			text: el.textContent ?? "",
		}))
	const { problems, no_h1 } = heading_problems(list)
	if (no_h1)
		add({
			key: "heading:no_h1",
			group: "headings",
			severity: "fail",
			title: "No main heading",
			why: "A page needs one h1 saying what it’s about. It’s how many people find their bearings.",
			el: list[0]?.el ?? null,
		})
	for (const { index, problem } of problems) {
		const { el, level, text } = list[index]
		const before = list[index - 1]?.level
		add({
			key: `heading:${problem}:${index}`,
			group: "headings",
			severity: problem === "empty" ? "fail" : "review",
			title: {
				empty: "Empty heading",
				skipped: `Heading jumps from h${before} to h${level}`,
				another_h1: "More than one main heading",
			}[problem],
			why: {
				empty: "Screen readers announce a heading with nothing in it.",
				skipped: "People moving through a page by its headings may think they’ve missed a section.",
				another_h1: "One h1 says what the page is about. The rest are usually better as h2s.",
			}[problem],
			sample: snippet(text),
			el,
		})
	}
}

function links_and_buttons(add: Add) {
	for (const el of document.querySelectorAll("a[href],button,[role=button],[role=link]")) {
		if (!shown(el)) continue
		const name = name_of(el)
		const link = el.matches("a,[role=link]")
		if (!name) {
			add({
				key: `control:unnamed:${link ? (el as HTMLAnchorElement).href : (el.className ?? "")}`,
				group: "links",
				severity: "fail",
				title: link ? "Link with no words" : "Button with no words",
				why: "A screen reader can only say “link” or “button” here. Add text, or alt text to its image.",
				el,
			})
			continue
		}
		const problem = link ? link_problem(name) : null
		if (problem)
			add({
				key: `link:${problem}:${name.toLowerCase()}`,
				group: "links",
				severity: "review",
				title: problem === "url" ? "Link reads out a web address" : `“${snippet(name)}” as a link`,
				why:
					problem === "url"
						? "Say where it goes in words instead."
						: "Links are often read as a list, away from the text around them. Say where this one goes.",
				sample: snippet(name),
				el,
			})
		const box = el.getBoundingClientRect()
		const inline = getComputedStyle(el).display === "inline"
		// only small both ways: a line of links is usually spaced enough to meet the rule's exception
		if (!inline && box.width < 24 && box.height < 24)
			add({
				key: `control:small:${Math.round(box.width)}x${Math.round(box.height)}`,
				group: "links",
				severity: "review",
				title: `Small to tap: ${Math.round(box.width)}×${Math.round(box.height)}px`,
				why: "Links and buttons should be at least 24×24px, so they’re easy to hit on a touch screen or with shaky hands.",
				sample: snippet(name),
				el,
			})
	}
}

function form_fields(add: Add) {
	const fields = document.querySelectorAll<HTMLInputElement>("input,select,textarea")
	for (const field of fields) {
		if (["hidden", "submit", "button", "reset", "image"].includes(field.type) || !shown(field))
			continue
		if (
			field.labels?.length ||
			field.getAttribute("aria-label") ||
			field.getAttribute("aria-labelledby") ||
			field.title
		)
			continue
		add({
			key: `form:unlabelled:${field.name || field.id || field.placeholder}`,
			group: "forms",
			severity: "fail",
			title: "Form field with no label",
			why: "A placeholder disappears when you type, and isn’t a label. Someone using a screen reader may not know what to enter.",
			sample: snippet(field.placeholder || field.name),
			el: field,
		})
	}
}

function videos(add: Add) {
	for (const video of document.querySelectorAll("video")) {
		if (!shown(video)) continue
		const moving = video.autoplay && video.loop
		const key = video.currentSrc || video.src || video.poster
		if (moving && !video.controls)
			add({
				key: `video:moving:${key}`,
				group: "video",
				severity: "review",
				title: "Video plays by itself",
				why: "Moving content that lasts over 5 seconds needs a way to pause it, as it can be distracting or make people unwell.",
				el: video,
			})
		// one that loops silently is a moving picture, with nothing to caption
		if (
			!(video.muted && moving) &&
			!video.querySelector("track[kind=captions],track[kind=subtitles]")
		)
			add({
				key: `video:captions:${key}`,
				group: "video",
				severity: "review",
				title: "Video may have no captions",
				why: "None were found on this video. If it has speech, it needs captions for people who can’t hear it.",
				el: video,
			})
	}
}

function page(add: Add) {
	const root = document.documentElement
	if (!root.lang)
		add({
			key: "page:lang",
			group: "page",
			severity: "fail",
			title: "The page doesn’t say its language",
			why: "Screen readers use it to pronounce the text. A developer sets it on the page’s html tag.",
			el: null,
		})
	if (!document.title.trim() || /\b(undefined|null)\b/.test(document.title))
		add({
			key: "page:title",
			group: "page",
			severity: "fail",
			title: "The page’s title is missing or broken",
			why: "It’s the first thing a screen reader says, and what a browser tab shows.",
			sample: snippet(document.title),
			el: null,
		})
	const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? ""
	const largest = viewport.match(/maximum-scale\s*=\s*([\d.]+)/)?.[1]
	if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || (largest && Number(largest) < 2))
		add({
			key: "page:zoom",
			group: "page",
			severity: "fail",
			title: "Zooming is turned off",
			why: "People with low vision need to be able to pinch to zoom. A developer sets this in the page’s viewport tag.",
			el: null,
		})
	if (!document.querySelector("main,[role=main]"))
		add({
			key: "page:main",
			group: "page",
			severity: "review",
			title: "No main landmark",
			why: "A main element lets people using screen readers jump straight past the navigation. A developer adds it to the template.",
			el: null,
		})
}

// --- seeing the page as others do

/** Machado et al.'s colour vision matrices, which a filter applies in linear RGB as they expect */
const MATRICES = {
	protanopia: "0.152 1.053 -0.205 0 0 0.115 0.786 0.099 0 0 -0.004 -0.048 1.052 0 0 0 0 0 1 0",
	deuteranopia: "0.367 0.861 -0.228 0 0 0.280 0.673 0.047 0 0 -0.012 0.043 0.969 0 0 0 0 0 1 0",
	tritanopia: "1.256 -0.077 -0.179 0 0 -0.078 0.931 0.148 0 0 0.005 0.691 0.304 0 0 0 0 0 1 0",
}

export type Vision = keyof typeof MATRICES | "grayscale" | "blurred" | null

export const VISIONS: ReadonlyArray<{ id: Vision; name: string }> = [
	{ id: null, name: "Typical vision" },
	{ id: "protanopia", name: "Red-blind (protanopia)" },
	{ id: "deuteranopia", name: "Green-blind (deuteranopia)" },
	{ id: "tritanopia", name: "Blue-blind (tritanopia)" },
	{ id: "grayscale", name: "No colour" },
	{ id: "blurred", name: "Blurred" },
]

/** Show the page through a kind of vision, on the root, where a filter leaves fixed elements fixed */
export function see_as(vision: Vision) {
	const root = document.documentElement
	document.querySelector("svg[data-storyloco=vision]")?.remove()
	if (!vision) return root.style.removeProperty("filter")
	if (vision === "grayscale") return root.style.setProperty("filter", "grayscale(1)")
	if (vision === "blurred") return root.style.setProperty("filter", "blur(1.5px)")
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
	svg.dataset.storyloco = "vision"
	svg.setAttribute("aria-hidden", "true")
	svg.style.cssText = "position:absolute;inline-size:0;block-size:0"
	svg.innerHTML = `<filter id="storyloco-vision"><feColorMatrix values="${MATRICES[vision]}"/></filter>`
	document.body.append(svg)
	root.style.setProperty("filter", "url(#storyloco-vision)")
}
