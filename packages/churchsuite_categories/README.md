# uiloco-churchsuite-categories

Storyblok field plugin: pick any number of ChurchSuite calendar categories and
store their ids as the field value.

The ChurchSuite API needs a key, so the plugin doesn't call it. It reads the
categories from an `endpoint` your site serves, which holds the key
server-side. Category names already show on every public event, so the
endpoint can be public.

## Options

| Option     | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `endpoint` | URL returning the categories, e.g. `https://example.church/api/churchsuite/categories` |

The endpoint answers `GET` with `Array<{ id: number, name: string, colour?: string }>`
and `Access-Control-Allow-Origin: *`, since the plugin runs on Storyblok's origin.

## Value

`Array<number>` of category ids (type `ChurchsuiteCategories` from
`storyloco/churchsuite_categories`). An empty array means none were chosen.
Values saved by the legacy `churchsuite-event-categories` plugin have the same
shape and load as they are.

## Development

```sh
bun dev
```
