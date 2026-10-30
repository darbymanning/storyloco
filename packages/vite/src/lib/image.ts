import type { HTMLImgAttributes } from "svelte/elements"

/**
 * A Storyblok asset, as either type generator types it: structural, so a generated
 * `StoryblokAsset` or `AssetFieldValue` fits, whose parts are null when unset.
 */
export interface Asset {
	filename?: string | null
	alt?: string | null
	focus?: string | null
	meta_data?: unknown
}
type AssetWithImage = Asset & { filename: string }
type Size = `${number}x${number}`
type AssetWithFocus = AssetWithImage & { focus: `${Size}:${Size}` }

function has_image(asset?: Asset): asset is AssetWithImage {
	return !!asset?.filename
}

function has_focus(asset: Asset): asset is AssetWithFocus {
	return /^\d+x\d+:\d+x\d+$/.test(asset.focus ?? "")
}

function get_dimensions(asset: AssetWithImage): { width?: number; height?: number } {
	const size = (asset.meta_data as { size?: unknown } | null | undefined)?.size
	const meta_data_size =
		typeof size === "string" ? (size.split("x").map(Number) as [number, number]) : undefined
	const filename_size = asset.filename
		.match(/(\d+)x(\d+)/i)
		?.slice(1)
		.map(Number) as [number, number] | undefined

	// not all assets carry dimensions (newer Storyblok asset URLs omit them)
	return {
		width: meta_data_size?.[0] ?? filename_size?.[0] ?? undefined,
		height: meta_data_size?.[1] ?? filename_size?.[1] ?? undefined,
	}
}

function focus_to_position_pc(asset: AssetWithImage): { x: number; y: number } | undefined {
	if (!has_focus(asset)) return undefined

	const { width, height } = get_dimensions(asset)
	if (!width || !height) return undefined
	const [start, end] = asset.focus.split(":")
	const [x1, y1] = start.split("x").map(Number)
	const [x2, y2] = end.split("x").map(Number)

	const mid_x = (x1 + x2) / 2
	const mid_y = (y1 + y2) / 2

	return {
		x: parseFloat(((mid_x / width) * 100).toFixed(2)),
		y: parseFloat(((mid_y / height) * 100).toFixed(2)),
	}
}

function generate_target_widths() {
	const widths: Array<number> = []
	let prev = 100
	const increment = 0.16
	const max_size = 8192

	const ensure_even = (n: number) => 2 * Math.round(n / 2)

	while (prev <= max_size) {
		widths.push(ensure_even(prev))
		prev = prev * (1 + increment)
	}

	return widths
}

const TARGET_WIDTHS = generate_target_widths()

type Options = { quality?: number; max_width?: number; max_height?: number }

function get_sources(
	asset: AssetWithImage,
	options: Options = { quality: 85 }
): { src: string; srcset: string | undefined; sizes: string | undefined } {
	if (asset.filename.endsWith(".svg"))
		return {
			src: asset.filename,
			srcset: undefined,
			sizes: undefined,
		}

	const position = focus_to_position_pc(asset)
	const asset_dims = get_dimensions(asset)
	const width = options.max_width ?? asset_dims.width
	const aspect_ratio =
		options.max_height && options.max_width
			? options.max_height / options.max_width
			: asset_dims.width && asset_dims.height
				? asset_dims.height / asset_dims.width
				: undefined

	const filter_parts: Array<string> = []
	if (options.quality) filter_parts.push(`quality(${options.quality})`)
	if (position) filter_parts.push(`focal(${asset.focus})`)

	const filters = filter_parts.length > 0 ? `filters:${filter_parts.join(":")}` : ""
	const path = filters ? `/${filters}` : ""

	// dimensions unknown: serve the original image (filters only, no resize/crop)
	if (!width)
		return {
			src: `${asset.filename}/m${path}`,
			srcset: undefined,
			sizes: undefined,
		}

	const resize_mode = position ? "" : "/smart"
	const ensure_even = (n: number) => 2 * Math.round(n / 2)
	// height 0 tells Storyblok to keep the original proportions
	const height_for = (w: number) => (aspect_ratio ? ensure_even(w * aspect_ratio) : 0)
	const filtered_widths = TARGET_WIDTHS.filter((w) => w <= width)
	const srcset = filtered_widths
		.map((w) => `${asset.filename}/m/${w}x${height_for(w)}${resize_mode}${path} ${w}w`)
		.join(", ")

	// if explicit dimensions provided, use those; otherwise use filtered width
	const final_max_width =
		options.max_width && options.max_height
			? ensure_even(options.max_width)
			: (filtered_widths.at(-1) ?? ensure_even(width))
	const final_max_height =
		options.max_width && options.max_height
			? ensure_even(options.max_height)
			: height_for(final_max_width)

	return {
		src: `${asset.filename}/m/${final_max_width}x${final_max_height}${resize_mode}${path}`,
		srcset: srcset || undefined,
		sizes: srcset ? `(max-width: ${width}px) 100vw, ${width}px` : undefined,
	}
}

function attrs(asset?: Asset, attrs: HTMLImgAttributes = {}, options: Options = { quality: 85 }) {
	// Storyblok assets are optional and their filename is nullable, so an empty
	// asset reaches here whenever a field was left blank — nothing to spread.
	if (!has_image(asset)) return undefined

	const asset_dims = get_dimensions(asset)
	const width = (attrs.width ? Number(attrs.width) : undefined) ?? asset_dims.width
	const height = (attrs.height ? Number(attrs.height) : undefined) ?? asset_dims.height
	const position = focus_to_position_pc(asset)

	let style = ""
	if (width && height) style += `--aspect: ${width}/${height};`
	if (position) style += `object-position: ${position.x}% ${position.y}%;`
	if (attrs.style) style += attrs.style

	const sources = get_sources(asset, { ...options, max_width: width, max_height: height })

	return {
		loading: "lazy",
		decoding: "async",
		alt: asset.alt ?? "",
		width,
		height,
		style,
		...sources,
		...attrs,
	} as const
}

/**
 * An `<img>`'s attributes for a Storyblok asset, resized by Storyblok's image service: a `srcset`
 * of widths up to the asset's own (or `width`'s), the focal point as the crop's centre and
 * `object-position`, `--aspect`, alt text and lazy loading. Nothing for an empty asset, so it
 * spreads safely. `image.exists(asset)` narrows to one with a file.
 *
 * @example
 * <img {...image(blok.photo, { width: 1048, height: 587, loading: 'eager' })} />
 */
export const image = Object.assign(attrs, { exists: has_image, has_focus })
