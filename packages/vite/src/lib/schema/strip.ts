/** Positions on a node, as Svelte's parser gives them */
interface Node {
	type: string
	start: number
	end: number
	[key: string]: unknown
}

interface Specifier extends Node {
	local: { name: string }
}

/** Blank `[start, end)`, keeping newlines, so every other position in the file stays where it was */
const blank = (source: string, start: number, end: number) =>
	source.slice(0, start) + source.slice(start, end).replace(/[^\n]/g, " ") + source.slice(end)

/** Directives whose name is a value in scope: `use:tooltip`, `transition:fade`, `animate:flip` */
const NAMED = new Set(["UseDirective", "TransitionDirective", "AnimateDirective"])

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"])

/** The names a pattern binds: `a`, `{ a, b: c }`, `[a, ...b]`, `a = 1` */
function bound(pattern: unknown, names: Set<string>) {
	const node = pattern as Node | null
	if (!node) return
	if (node.type === "Identifier") names.add(node.name as string)
	else if (node.type === "AssignmentPattern") bound(node.left, names)
	else if (node.type === "RestElement") bound(node.argument, names)
	else if (node.type === "ArrayPattern")
		for (const element of node.elements as Array<unknown>) bound(element, names)
	else if (node.type === "ObjectPattern")
		for (const property of node.properties as Array<Node>)
			bound(property.type === "RestElement" ? property : property.value, names)
}

/** What a function's parameters, or a block's own declarations, bind inside it */
function declared(node: Node): Set<string> {
	const names = new Set<string>()
	if (FUNCTIONS.has(node.type)) {
		for (const param of node.params as Array<unknown>) bound(param, names)
		return names
	}
	for (const statement of (node.body as Array<Node>) ?? []) {
		if (statement.type === "VariableDeclaration")
			for (const declarator of statement.declarations as Array<Node>) bound(declarator.id, names)
		if (statement.type === "FunctionDeclaration" && statement.id) bound(statement.id, names)
	}
	return names
}

/**
 * The names a component's scripts and markup use at runtime, outside `skip`, from the scope the
 * imports are in: not a type, a property's name, a binding, anything in a string or the styles,
 * or a name a function or block in the scripts declares for itself. `$store` counts as `store`,
 * and `<Card>` as `Card`. Anything less certain counts as a use, which only ever keeps an import.
 */
function names_used(root: unknown, skip: Array<Node>): Set<string> {
	const used = new Set<string>()
	const skipped = (node: Node) => skip.some((s) => node.start >= s.start && node.end <= s.end)

	function walk(value: unknown, shadowed: Set<string>, parent?: Node, key?: string) {
		if (!value || typeof value !== "object") return
		if (Array.isArray(value)) {
			for (const item of value) walk(item, shadowed, parent, key)
			return
		}
		const node = value as Node
		let scope = shadowed
		if (typeof node.type === "string") {
			if (node.type === "ImportDeclaration") return
			// a type is skipped, but `x as T`, `x!` and `x satisfies T` hold runtime code in `expression`
			if (node.type.startsWith("TS")) {
				walk(node.expression, shadowed, node, "expression")
				return
			}
			if (typeof node.start === "number" && skipped(node)) return
			if (node.type === "Identifier") {
				const property = parent?.type === "MemberExpression" && key === "property"
				const key_name =
					(parent?.type === "Property" || parent?.type === "PropertyDefinition") && key === "key"
				const name = node.name as string
				if (!((property || key_name) && !parent?.computed) && !shadowed.has(name)) {
					used.add(name)
					if (name.startsWith("$")) used.add(name.slice(1))
				}
			}
			if (node.type === "Component" || NAMED.has(node.type))
				used.add(String(node.name).split(".")[0])
			// a function's parameters and a nested block's declarations hide an import of that name
			if (FUNCTIONS.has(node.type) || (node.type === "BlockStatement" && parent))
				scope = new Set([...shadowed, ...declared(node)])
			// `{#each items as text}` hides it in the block, though not in `items`
			if (node.type === "EachBlock") {
				walk(node.expression, shadowed, node, "expression")
				const inner = new Set(shadowed)
				bound(node.context, inner)
				if (typeof node.index === "string") inner.add(node.index)
				for (const [k, child] of Object.entries(node))
					if (!["expression", "parent", "metadata"].includes(k)) walk(child, inner, node, k)
				return
			}
		}
		const next = typeof node.type === "string" ? node : parent
		for (const [k, child] of Object.entries(node))
			if (k !== "parent" && k !== "metadata") walk(child, scope, next, k)
	}

	const { fragment, instance, module } = root as Record<string, unknown>
	for (const part of [fragment, instance, module]) walk(part, new Set())
	return used
}

/**
 * A block component without the `export const schema` of its `<script module>`, and without the
 * imports only that used, or null when it has none to take out.
 *
 * Only the schema entry reads that export; in the app it would ship `@storyblok/schema` and its
 * validators to every visitor. Text is blanked rather than removed, so the component's source map
 * and error positions stay its own. A component that uses `schema` itself, other than in a type,
 * keeps it.
 */
export async function strip_schema(source: string): Promise<string | null> {
	if (!/<script\b[^>]*\bmodule\b/.test(source) || !/\bexport\s+const\s+schema\b/.test(source))
		return null

	const { parse } = await import("svelte/compiler")
	const root = parse(source, { modern: true })
	const body = (root.module?.content as unknown as { body: Array<Node> } | undefined)?.body ?? []

	const declaration = body.find((node) => {
		const declared = node.declaration as Node | null | undefined
		const declarations = declared?.declarations as
			| Array<{ id: Node & { name?: string } }>
			| undefined
		return (
			node.type === "ExportNamedDeclaration" &&
			declared?.type === "VariableDeclaration" &&
			declarations?.length === 1 &&
			declarations[0].id.name === "schema"
		)
	})
	if (!declaration) return null

	const used = names_used(root, [declaration])
	if (used.has("schema")) return null

	// An import only the schema used goes too, or the bundle keeps what it pulls in
	let stripped = blank(source, declaration.start, declaration.end)
	for (const node of body.filter((node) => node.type === "ImportDeclaration")) {
		const specifiers = node.specifiers as Array<Specifier>
		if (!specifiers.length || node.importKind === "type") continue
		const unused = specifiers.filter(
			(specifier) => specifier.importKind !== "type" && !used.has(specifier.local.name)
		)
		if (!unused.length) continue
		if (unused.length === specifiers.length) {
			stripped = blank(stripped, node.start, node.end)
			continue
		}
		for (const specifier of unused) {
			// its comma too, so `{ a, b }` becomes `{ a,   }`, which still parses
			const comma = stripped.slice(specifier.end).match(/^\s*,/)
			stripped = blank(stripped, specifier.start, specifier.end + (comma?.[0].length ?? 0))
		}
	}

	return stripped
}
