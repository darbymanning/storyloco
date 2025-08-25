/**
 * @param {string} key
 * @param {{
 *   type: 'custom',
 *   pos: number,
 *   field_type: string,
 *   options: Array<Record<string, unknown>>,
 *   id: string
 * }} field
 */
export default (key, { field_type }) => ({ [key]: [`StoryblokCustomPlugins${field_type}`] })
