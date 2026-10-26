/**
 * Each site loads, and signed in, edits: clicking a block opens its settings with its fields.
 *
 *   bun run smoke https://localhost:5182 https://localhost:5183
 *   bun run smoke --signin https://localhost:5182   (once per site, in a window you sign in from)
 *
 * Sign-ins are kept in one browser profile, so later runs reuse them without a window.
 */
import { chromium, type Page } from "playwright-core"
import { homedir } from "node:os"
import { join } from "node:path"

const args = process.argv.slice(2)
const signin = args.includes("--signin")
const sites = args.filter((arg) => !arg.startsWith("--"))
if (!sites.length) {
	console.error("Usage: bun run smoke [--signin] <site url>…")
	process.exit(2)
}

const context = await chromium.launchPersistentContext(
	join(homedir(), ".cache", "storyloco-smoke"),
	{
		headless: !signin,
		ignoreHTTPSErrors: true,
		viewport: { width: 1440, height: 900 },
	}
)

const user = (page: Page) =>
	page
		.evaluate(
			() =>
				JSON.parse(document.getElementById("storyloco-editor")?.textContent || "{}").user ?? null
		)
		.catch(() => null)

if (signin) {
	for (const site of sites) {
		const page = await context.newPage()
		await page.goto(new URL("/?edit", site).href)
		console.log(`Sign in to ${site} in the window…`)
		await page.waitForFunction(
			(origin) =>
				location.origin === origin &&
				JSON.parse(document.getElementById("storyloco-editor")?.textContent || "{}").user,
			new URL(site).origin,
			{ timeout: 300_000, polling: 1000 }
		)
		console.log(`  signed in`)
	}
	await context.close()
	process.exit(0)
}

/** Loaded and hydrated; a page streaming video never goes quiet, so the wait for that is capped */
async function settle(page: Page) {
	await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})
}

let failures = 0
for (const site of sites) {
	const page = await context.newPage()
	const errors: Array<string> = []
	page.on("pageerror", (error) => errors.push(error.message))
	const problems: Array<string> = []
	let note = ""

	const response = await page.goto(site).catch((error: Error) => error)
	if (response instanceof Error || !response) problems.push(`didn’t load: ${response?.message}`)
	else if (response.status() >= 400) problems.push(`page answered ${response.status()}`)
	else if ((await settle(page), !(await user(page))))
		note = "signed out, so only loading was checked (run with --signin)"
	else {
		// edit mode on, whatever this profile last left it as
		await page.evaluate(() => localStorage.setItem("storyloco-editing", "on"))
		await page.reload()
		await settle(page)
		// the biggest block in view that isn't the whole page, so the click lands on content
		const point = await page.evaluate(() => {
			const boxes = [...document.querySelectorAll("[data-blok-c]")]
				.map((node) => node.getBoundingClientRect())
				.filter(
					(r) => r.height > 40 && r.top < innerHeight && r.bottom > 0 && r.height < innerHeight * 2
				)
				.sort((a, b) => b.width * b.height - a.width * a.height)
			const box = boxes[0]
			return box && { x: box.left + box.width / 2, y: Math.max(box.top, 0) + 24 }
		})
		if (!point) problems.push("no blocks marked for editing")
		else {
			await page.mouse.move(point.x, point.y)
			await page.mouse.click(point.x, point.y)
			const fields = page.locator("[data-storyloco=inspector] .field")
			await fields
				.first()
				.waitFor({ timeout: 10_000 })
				.catch(() => problems.push("clicking a block didn’t open its settings"))
			const count = await fields.count()
			const unknown = await page.locator("[data-storyloco=inspector] .readonly").count()
			note = `${count} fields${unknown ? `, ${unknown} only editable in Storyblok` : ""}`
		}
	}
	for (const error of errors) problems.push(`page error: ${error}`)

	if (problems.length) failures++
	console.log(`${problems.length ? "✗" : "✓"} ${site}${note ? ` · ${note}` : ""}`)
	for (const problem of problems) console.log(`    ${problem}`)
	await page.close()
}

await context.close()
process.exit(failures ? 1 : 0)
