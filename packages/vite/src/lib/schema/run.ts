import spawn from "cross-spawn"

interface RunOptions {
	cwd: string
	env: NodeJS.ProcessEnv
	/** Hand the output back rather than printing it, for a scoped check to filter (push writes to stderr) */
	capture?: boolean
}

/** Fall back only when Bun is absent, never after a failed CLI operation. */
export function run_cli(
	args: string[],
	options: RunOptions,
	failure: (code: number | null, signal: string | null) => string
): Promise<string> {
	const { capture, ...spawn_options } = options
	return new Promise((resolve, reject) => {
		function start(command: "bunx" | "npx") {
			let output = ""
			const child = spawn(command, command === "npx" ? ["--yes", ...args] : args, {
				...spawn_options,
				stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
			})
			const take = (chunk: Buffer) => (output += chunk)
			child.stdout?.on("data", take)
			child.stderr?.on("data", take)

			child.on("error", (error: NodeJS.ErrnoException) => {
				if (command === "bunx" && error.code === "ENOENT") start("npx")
				else reject(error)
			})

			child.on("exit", (code, signal) => {
				if (code === 0) resolve(output)
				else {
					// a failure shows everything the CLI said, unfiltered
					if (capture) process.stderr.write(output)
					reject(new Error(failure(code, signal)))
				}
			})
		}

		start("bunx")
	})
}
