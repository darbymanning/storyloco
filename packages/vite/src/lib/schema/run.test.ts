import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { run_cli } from "./run.js"

test.skipIf(process.platform === "win32")(
	"CLI prefers bunx, falls back when absent, and never retries an operation failure",
	async () => {
		const root = await mkdtemp(path.join(tmpdir(), "storyloco-run-"))
		const log = path.join(root, "args.log")
		const options = { cwd: root, env: { PATH: root, STORYLOCO_RUN_LOG: log } }
		const record = '#!/bin/sh\nprintf "%s\\n" "$0" "$@" > "$STORYLOCO_RUN_LOG"\n'
		const failure = (code: number | null) => `CLI failed: ${code}`

		try {
			await writeFile(path.join(root, "bunx"), record, { mode: 0o755 })
			await writeFile(path.join(root, "npx"), record, { mode: 0o755 })

			await run_cli(["storyblok@4.25.0", "schema", "path with spaces"], options, failure)
			let lines = (await readFile(log, "utf8")).trim().split("\n")
			expect(lines).toEqual([
				path.join(root, "bunx"),
				"storyblok@4.25.0",
				"schema",
				"path with spaces",
			])

			await rm(path.join(root, "bunx"))
			await run_cli(["storyblok@4.25.0", "schema"], options, failure)
			lines = (await readFile(log, "utf8")).trim().split("\n")
			expect(lines).toEqual([path.join(root, "npx"), "--yes", "storyblok@4.25.0", "schema"])

			await writeFile(path.join(root, "bunx"), record + "exit 1\n", { mode: 0o755 })
			await expect(run_cli(["schema", "diff"], options, failure)).rejects.toThrow("CLI failed: 1")
			expect((await readFile(log, "utf8")).split("\n")[0]).toBe(path.join(root, "bunx"))
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	}
)
