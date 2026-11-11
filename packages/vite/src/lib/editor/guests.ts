/*
 * Who a guest is to everyone else until they say: a name and a face made up from their id, so
 * three of them on a page are three you can tell apart rather than "Guest" three times. The same
 * id is the same one on every screen, with nothing kept anywhere.
 *
 * The face is a small arcade character printed in two tones, as a magazine's spot illustration
 * is: paper and one ink, both from the person's own colour, on ground that's a screen of dots.
 */

const MOODS = [
	"Curious",
	"Mellow",
	"Nimble",
	"Plucky",
	"Dapper",
	"Breezy",
	"Sunny",
	"Jolly",
	"Zesty",
	"Cosmic",
	"Gentle",
	"Witty",
	"Snug",
	"Brisk",
	"Merry",
	"Bold",
]

/**
 * Who's pictured: little arcade characters of the editor's own, each ten squares by ten, `#` a
 * square of ink. Their eyes and mouths are gaps, which the paper shows through
 */
const SPRITES: Record<string, Array<string>> = {
	Ghost: [
		"..######..",
		".########.",
		"##########",
		"##.##.####",
		"##.##.####",
		"##########",
		"##########",
		"##########",
		"##########",
		"#.##..##.#",
	],
	Slime: [
		"..........",
		"...####...",
		"..######..",
		".########.",
		".##.##.##.",
		".##.##.##.",
		"##########",
		"##########",
		"##########",
		".########.",
	],
	Robot: [
		"....##....",
		"....##....",
		".########.",
		".##.##.##.",
		".##.##.##.",
		".########.",
		".##....##.",
		".########.",
		"..##..##..",
		"..##..##..",
	],
	Alien: [
		"...####...",
		"..######..",
		".########.",
		".###..###.",
		".###..###.",
		".########.",
		"..######..",
		".#.#..#.#.",
		"#..#..#..#",
		"#.#....#.#",
	],
	Bat: [
		"..........",
		"#...##...#",
		"##.####.##",
		"##########",
		"###.##.###",
		"##########",
		".########.",
		".##.##.##.",
		".#..##..#.",
		"..........",
	],
	Cat: [
		"#........#",
		"##......##",
		"###....###",
		"##########",
		"##.####.##",
		"##.####.##",
		"##########",
		"####..####",
		".########.",
		"..######..",
	],
	Skull: [
		"..######..",
		".########.",
		"##########",
		"##..##..##",
		"##..##..##",
		"##########",
		".###..###.",
		"..######..",
		"..#.##.#..",
		"..#.##.#..",
	],
	Mushroom: [
		"...####...",
		"..######..",
		".##.##.##.",
		"##########",
		"##########",
		"##########",
		"..######..",
		"..#.##.#..",
		"..######..",
		"...####...",
	],
	Rocket: [
		"....##....",
		"...####...",
		"...####...",
		"..##..##..",
		"..##..##..",
		"..######..",
		".########.",
		"##.####.##",
		"#...##...#",
		"...#..#...",
	],
	Frog: [
		".##....##.",
		"####..####",
		"#.##..##.#",
		"##########",
		"##########",
		"#........#",
		"##########",
		".########.",
		"##.#..#.##",
		"#........#",
	],
}
const SCENES = Object.entries(SPRITES)

/** A sprite's squares as one path, a run of them along a row at a time */
const pixels = (rows: Array<string>) =>
	rows
		.flatMap((row, y) =>
			[...row.matchAll(/#+/g)].map(
				(run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`
			)
		)
		.join("")

const hash_of = (id: string | number) =>
	[...String(id)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7)

/**
 * The name and face for a guest with this id: always the same for the same id. The face is the
 * inside of an `<svg viewBox="0 0 32 32">`, its ink `currentColor` and its paper left to whatever
 * it's put on
 */
export function persona(id: string | number) {
	const hash = hash_of(id)
	const [scene, rows] = SCENES[hash % SCENES.length]
	// from other bits of it than the sprite's, so the two don't go round together
	const mood = MOODS[(hash >>> 8) % MOODS.length]
	// two faces on a page each need a screen of their own: one's dots are in its own ink
	const key = `storyloco-dots-${hash.toString(36)}`
	// facing the other way for half of them, so two alike are less alike
	const flip = (hash >>> 16) & 1 ? "matrix(-2 0 0 2 26 5.5)" : "matrix(2 0 0 2 6 5.5)"
	// on plain paper, so its eyes are clean, standing on ground printed as a screen of dots
	const art =
		`<defs><pattern id="${key}" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="1.2" cy="1.2" r=".8" fill="currentColor"/></pattern></defs>` +
		`<path d="M0 23h32v9H0z" fill="url(#${key})"/>` +
		// and a ring of the same dots behind its head, clear of its face
		`<circle cx="16" cy="14" r="13.5" fill="none" stroke="url(#${key})" stroke-width="3.2" opacity=".55"/>` +
		`<path d="${pixels(rows)}" transform="${flip}" fill="currentColor" shape-rendering="crispEdges"/>`
	return { name: `${mood} ${scene}`, art }
}
