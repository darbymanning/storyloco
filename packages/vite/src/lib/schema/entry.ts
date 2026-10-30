import { stat } from "node:fs/promises"
import path from "node:path"

export const default_entry = "src/schema.ts"

/** Explicit entries must load; only an absent conventional entry falls back to the API. */
export async function resolve_entry(root: string, entry?: string | false) {
	if (entry === false) return undefined
	if (entry !== undefined) return path.resolve(root, entry)
	const candidate = path.resolve(root, default_entry)
	try {
		if (!(await stat(candidate)).isFile()) throw new Error(`${candidate} must be a schema file`)
		return candidate
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw error
	}
}
