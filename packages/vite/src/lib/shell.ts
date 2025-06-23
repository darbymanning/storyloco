import { exec } from "child_process"
import { promisify } from "util"

const exec_async = promisify(exec)
type ShellResult = {
	success: boolean
	stdout: string
	stderr: string
}

type ShellRunner = {
	run(): Promise<ShellResult>
	quiet(): ShellRunner
	nothrow(): ShellRunner
	then: Promise<ShellResult>["then"]
	catch: Promise<ShellResult>["catch"]
}

export function $(strings: TemplateStringsArray, ...values: unknown[]): ShellRunner

export function $(strings: TemplateStringsArray, ...values: unknown[]) {
	const cmd = strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "")

	const options = {
		quiet: false,
		nothrow: false,
	}

	const runner = {
		async run() {
			try {
				const { stdout, stderr } = await exec_async(cmd)
				if (!options.quiet) {
					if (stdout) process.stdout.write(stdout)
					if (stderr) process.stderr.write(stderr)
				}
				return { success: true, stdout, stderr }
			} catch (err: unknown) {
				const error = err as ShellResult
				if (!options.quiet) {
					if (error.stdout) process.stdout.write(error.stdout)
					if (error.stderr) process.stderr.write(error.stderr)
				}
				if (options.nothrow) return { success: false, stdout: error.stdout, stderr: error.stderr }
				throw err
			}
		},
		quiet() {
			options.quiet = true
			return this
		},
		nothrow() {
			options.nothrow = true
			return this
		},
		then(onFulfilled: (value: ShellResult) => void, onRejected: (reason: unknown) => void) {
			return this.run().then(onFulfilled, onRejected)
		},
		catch(onRejected: (reason: unknown) => void) {
			return this.run().catch(onRejected)
		},
	}

	return runner
}
