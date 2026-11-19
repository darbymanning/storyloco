import { afterEach, describe, expect, test } from "bun:test"
import { exif_orientation, upright, type Ask } from "./orient.js"

/** A JPEG that is only its EXIF: SOI, an APP1 whose IFD0 holds the Orientation tag, EOI */
function jpeg(orientation: number, little = true) {
	const tiff = new DataView(new ArrayBuffer(26))
	tiff.setUint16(0, little ? 0x4949 : 0x4d4d)
	tiff.setUint16(2, 42, little)
	tiff.setUint32(4, 8, little) // IFD0 follows the header
	tiff.setUint16(8, 1, little) // one entry
	tiff.setUint16(10, 0x0112, little)
	tiff.setUint16(12, 3, little) // SHORT
	tiff.setUint32(14, 1, little)
	tiff.setUint16(18, orientation, little)
	const app1 = [
		0xff,
		0xe1,
		0,
		2 + 6 + 26,
		0x45,
		0x78,
		0x69,
		0x66,
		0,
		0,
		...new Uint8Array(tiff.buffer),
	]
	return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9])
}

describe("exif_orientation", () => {
	test("reads the tag in either byte order", () => {
		expect(exif_orientation(jpeg(6))).toBe(6)
		expect(exif_orientation(jpeg(3, false))).toBe(3)
	})

	test("is 1 for what has no tag to act on", () => {
		expect(exif_orientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1)
		expect(exif_orientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
		expect(exif_orientation(jpeg(9))).toBe(1)
		expect(exif_orientation(jpeg(6).slice(0, 20))).toBe(1)
	})
})

describe("upright", () => {
	const real = globalThis.fetch
	afterEach(() => void (globalThis.fetch = real))

	class Image {
		width = 50
		height = 100
		jpeg() {
			return this
		}
		async blob() {
			return new Blob(["turned"])
		}
	}

	function storyblok(file: Uint8Array, content_type = "image/jpeg") {
		const steps: Array<[string, unknown]> = []
		const uploads: Array<FormData> = []
		const ask: Ask = async (step, more) => {
			steps.push([step, more])
			if (step === "read")
				return { filename: "https://a.storyblok.com/f/1/photo.jpg", content_type }
			if (step === "sign") return { post_url: "https://s3.test/up", fields: { key: "k" } }
			return {}
		}
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			if (url === "https://s3.test/up") uploads.push(init?.body as FormData)
			return new Response(url === "https://s3.test/up" ? null : new Blob([file as BlobPart]))
		}) as never
		return { ask, steps, uploads }
	}

	test("a sideways JPEG is replaced by its turned pixels, at their size", async () => {
		const { ask, steps, uploads } = storyblok(jpeg(6))
		expect(await upright(ask, Image as never)).toBe("turned from orientation 6")
		expect(steps).toEqual([
			["read", undefined],
			["sign", { size: "50x100" }],
			["finish", undefined],
		])
		expect([...uploads[0].keys()]).toEqual(["key", "file"])
	})

	test("an upright JPEG, another format and another runtime are left alone", async () => {
		const straight = storyblok(jpeg(1))
		expect(await upright(straight.ask, Image as never)).toBe("left: already upright")
		const png = storyblok(jpeg(6), "image/png")
		expect(await upright(png.ask, Image as never)).toBe("left: not a JPEG")
		const node = storyblok(jpeg(6))
		expect(await upright(node.ask, null as never)).toStartWith("left: this runtime")
		expect([straight, png, node].flatMap((s) => s.steps.map(([step]) => step))).toEqual([
			"read",
			"read",
		])
		expect([straight, png, node].flatMap((s) => s.uploads)).toEqual([])
	})
})
