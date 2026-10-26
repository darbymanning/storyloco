import { sequence } from "@sveltejs/kit/hooks"
import { editor } from "./lib/editor/server.js"
import { version } from "./lib/hooks.js"
import { handle_redirects } from "./lib/redirects/handle.js"

export const handle = sequence(editor, version, handle_redirects)
