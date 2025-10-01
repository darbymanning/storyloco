import { $ } from "./shell.js"

type ExecScript = "bunx" | "npx"

export default async function x(): Promise<ExecScript> {
	// check for bun
	try {
		await $`which bun`.quiet().nothrow().run()
		return "bunx"
	} catch {
		// npm should always be available on node systems
		return "npx"
	}
}
