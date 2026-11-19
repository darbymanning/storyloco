/**
 * The EXIF Orientation tag of a JPEG, 1 when there's none to act on.
 *
 * Storyblok's image service drops EXIF when it transcodes to WebP without turning the pixels, so
 * a photo tagged anything but 1 shows sideways to every browser that asks for WebP.
 */
export function exif_orientation(bytes: Uint8Array): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1 // not a JPEG

	let offset = 2
	while (offset + 4 <= view.byteLength) {
		// every marker segment starts 0xFF; anything else is lost sync
		if (view.getUint8(offset) !== 0xff) return 1
		const marker = view.getUint8(offset + 1)
		if (marker === 0xda || marker === 0xd9) return 1 // start of scan, end of image: no EXIF
		const length = view.getUint16(offset + 2)
		if (length < 2) return 1
		// APP1 with an "Exif\0\0" header
		if (
			marker === 0xe1 &&
			offset + 10 <= view.byteLength &&
			view.getUint32(offset + 4) === 0x45786966
		)
			return ifd0_orientation(view, offset + 10)
		offset += 2 + length
	}
	return 1
}

function ifd0_orientation(view: DataView, tiff: number): number {
	if (tiff + 8 > view.byteLength) return 1
	const byte_order = view.getUint16(tiff)
	if (byte_order !== 0x4949 && byte_order !== 0x4d4d) return 1
	const little = byte_order === 0x4949

	const ifd0 = tiff + view.getUint32(tiff + 4, little)
	if (ifd0 + 2 > view.byteLength) return 1
	const entries = view.getUint16(ifd0, little)
	for (let i = 0; i < entries; i++) {
		const entry = ifd0 + 2 + i * 12
		if (entry + 12 > view.byteLength) return 1
		if (view.getUint16(entry, little) === 0x0112) {
			const value = view.getUint16(entry + 8, little)
			return value >= 1 && value <= 8 ? value : 1
		}
	}
	return 1
}

type Encoded = { blob(): Promise<Blob>; width: number; height: number }
type BunImage = new (bytes: Uint8Array) => { jpeg(options: { quality: number }): Encoded }

/** One Management API call moxy makes with the space's grant: `read`, `sign` or `finish` */
export type Ask = (step: string, more?: Record<string, unknown>) => Promise<Record<string, unknown>>

/**
 * Replaces a newly uploaded JPEG that's tagged sideways with one whose pixels are turned, which
 * no reader can get wrong. Resolves to what was done, or why nothing was.
 *
 * Bun's decoder does the turning, so on another runtime the photo is left as it is.
 */
export async function upright(
	ask: Ask,
	image = (globalThis as { Bun?: { Image?: BunImage } }).Bun?.Image
) {
	if (!image) return "left: this runtime can't re-encode a JPEG"
	const asset = await ask("read")
	// re-encoding anything else would leave the pixels at odds with the stored extension
	if (!/^image\/jpe?g$/.test(String(asset.content_type ?? ""))) return "left: not a JPEG"

	const original = new Uint8Array(await (await fetch(String(asset.filename))).arrayBuffer())
	const orientation = exif_orientation(original)
	// also what stops a loop: the file written back carries no EXIF
	if (orientation === 1) return "left: already upright"

	// decoding applies the EXIF rotation to the pixels; re-encoding leaves no tag to misread
	const turned = new image(original).jpeg({ quality: 95 })
	const file = await turned.blob()
	// the size is only the output's once the encode has run
	const slot = await ask("sign", { size: `${turned.width}x${turned.height}` })

	const form = new FormData()
	for (const [name, value] of Object.entries((slot.fields ?? {}) as Record<string, string>))
		form.append(name, value)
	form.append("file", file) // S3 wants the file last
	const upload = await fetch(String(slot.post_url), { method: "POST", body: form })
	if (!upload.ok) throw new Error(`the upload was refused: ${upload.status}`)

	await ask("finish")
	return `turned from orientation ${orientation}`
}
