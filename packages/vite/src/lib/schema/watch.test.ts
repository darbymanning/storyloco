import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Each dev server runs in its own process to isolate its module runner and output.
test.each(["broken import", "external dependency", "external entry"])(
	"schema watcher regenerates after editing %s",
	async (scenario) => {
		const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-watch-")))
		const script = String.raw`
			import { createServer } from ${JSON.stringify(import.meta.resolve("vite"))}
			import schema from ${JSON.stringify(new URL("./plugin.ts", import.meta.url).href)}
			import { mkdir, readFile, writeFile } from "node:fs/promises"
			import path from "node:path"
			const scenario = ${JSON.stringify(scenario)}
			const root = process.cwd()
			const app = path.join(root, "app")
			const source = path.join(app, "src")
			const shared = path.join(root, "shared")
			const output = path.join(source, "lib")
			for (const directory of [source, shared, output]) await mkdir(directory, { recursive: true })
			await writeFile(path.join(output, "components.schema.ts"), "// generated")
			const log = path.join(root, "loads.log")
			const helper = path.join(scenario === "broken import" ? source : shared, "fields.ts")
			const entry = path.join(scenario === "external entry" ? shared : source, "schema.ts")
			const contents = (value) =>
				'import { appendFileSync } from "node:fs"; appendFileSync(' + JSON.stringify(log) + ', ' +
				JSON.stringify(value + "\n") + '); export const fields = []'
			await writeFile(helper, scenario === "broken import" ? "export const fields = [" : contents("initial"))
			await writeFile(entry, 'import { fields } from ' + JSON.stringify(helper) + '; export default { blocks: fields.length ? {} : {} }')
			const server = await createServer({
				root: app,
				configFile: false,
				logLevel: "silent",
				plugins: [schema({ output_path: output, entry: scenario === "external entry" ? entry : undefined })],
				server: { middlewareMode: true, ws: false, watch: { usePolling: true, interval: 30 } },
			})
			async function until(predicate) {
				const deadline = Date.now() + 5000
				while (Date.now() < deadline) {
					if (await predicate()) return
					await new Promise(resolve => setTimeout(resolve, 25))
				}
				throw new Error("Schema did not regenerate after " + scenario)
			}
			try {
				// Let the watcher establish its initial file stats before making an edit.
				await new Promise(resolve => setTimeout(resolve, 150))
				await writeFile(helper, contents("updated"))
				await until(async () => (await readFile(log, "utf8").catch(() => "")).includes("updated"))
				if (scenario !== "broken import") {
					// Dependencies first reached on a later reload must also be registered,
					// even if that reload fails before evaluating the new file.
					const later = path.join(shared, "later.ts")
					await writeFile(later, "export const fields = [")
					await writeFile(helper, 'export { fields } from ' + JSON.stringify(later))
					await until(() => server.watcher.getWatched()[shared]?.includes("later.ts"))
					await new Promise(resolve => setTimeout(resolve, 150))
					await writeFile(later, contents("recovered later"))
					await until(async () => (await readFile(log, "utf8")).includes("recovered later"))
				}
			} finally {
				await server.close()
			}
		`
		try {
			const child = Bun.spawn([process.execPath, "--eval", script], {
				cwd: root,
				stdout: "pipe",
				stderr: "pipe",
			})
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			])
			if (code !== 0) throw new Error(stdout + stderr)
			expect(code).toBe(0)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	},
	15000
)

test("invalid schemas reach the dev overlay and fail production builds", async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-errors-")))
	const script = String.raw`
		import { createServer, build } from ${JSON.stringify(import.meta.resolve("vite"))}
		import schema from ${JSON.stringify(new URL("./plugin.ts", import.meta.url).href)}
		import { mkdir, writeFile } from "node:fs/promises"
		import path from "node:path"
		await mkdir("src")
		await writeFile("src/schema.ts", 'export default {blocks: {hero: {name: "hero", fields: [{name: "title", type: "not-real"}]}}}')
		const messages = []
		const server = await createServer({ root: process.cwd(), configFile: false, logLevel: "silent", plugins: [
			{ name: "capture-errors", configureServer(server) { server.ws.send = (message) => messages.push(message) } }, schema(),
		], server: { middlewareMode: true, ws: false, watch: { usePolling: true, interval: 30 } } })
		try {
			if (!messages.some(m => m.type === "error" && m.err.message.includes("hero") && m.err.message.includes("title"))) throw new Error("Missing schema overlay diagnostic")
			await new Promise(resolve => setTimeout(resolve, 150))
			await writeFile("src/schema.ts", 'export default {blocks: {}}')
			const deadline = Date.now() + 5000
			while (!messages.some(m => m.type === "full-reload") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
			if (!messages.some(m => m.type === "full-reload")) throw new Error("Overlay did not clear on recovery")
		} finally { await server.close() }
		await writeFile("src/schema.ts", 'export default {blocks: {hero: {name: "hero", fields: [{name: "title", type: "not-real"}]}}}')
		let failed = false
		try { await build({ root: process.cwd(), configFile: false, logLevel: "silent", plugins: [schema()] }) }
		catch (error) { if (!String(error).includes("hero")) throw error; failed = true }
		if (!failed) throw new Error("Invalid schema did not fail build")
	`
	try {
		const child = Bun.spawn([process.execPath, "--eval", script], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		})
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])
		if (code !== 0) throw new Error(stdout + stderr)
		expect(code).toBe(0)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}, 15000)
