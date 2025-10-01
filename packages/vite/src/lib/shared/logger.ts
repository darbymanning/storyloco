import ora, { type Ora } from "ora"
import chalk from "chalk"

export class Logger {
	static color = chalk

	private readonly name: string
	private readonly spinner: Ora

	constructor(name: string) {
		this.name = name
		this.spinner = ora({ prefixText: Logger.color.yellow(`[${this.name}]`) })
	}

	info(message: string) {
		this.spinner.info(message)
	}

	start(message: string) {
		this.spinner.start(message)
	}

	succeed(message: string) {
		this.spinner.succeed(message)
	}

	fail(message: string) {
		this.spinner.fail(message)
	}

	warn(message: string) {
		this.spinner.warn(message)
	}
}
