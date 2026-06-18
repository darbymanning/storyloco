import ora, { type Ora } from "ora"
import { styleText } from "node:util"

type Format = Extract<Parameters<typeof styleText>[0], string>
type ColorFn = (text: string) => string
type Color = Record<Format, ColorFn>

const color = new Proxy({} as Color, {
	get(_, format: Format) {
		return (text: string) => styleText(format, text)
	},
})

export class Logger {
	static color = color

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
