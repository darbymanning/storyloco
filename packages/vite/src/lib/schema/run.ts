import spawn from "cross-spawn"

interface RunOptions {
	cwd: string
	env: NodeJS.ProcessEnv
}

/** Fall back only when Bun is absent, never after a failed CLI operation. */
export function run_cli(
	args: string[],
	options: RunOptions,
	failure: (code: number | null, signal: string | null) => string
): Promise<void> {
	return new Promise((resolve, reject) => {
		function start(command: "bunx" | "npx") {
			const child = spawn(command, command === "npx" ? ["--yes", ...args] : args, {
				...options,
				stdio: "inherit",
			})

			child.on("error", (error: NodeJS.ErrnoException) => {
				if (command === "bunx" && error.code === "ENOENT") start("npx")
				else reject(error)
			})

			child.on("exit", (code, signal) => {
				if (code === 0) resolve()
				else reject(new Error(failure(code, signal)))
			})
		}

		start("bunx")
	})
}
