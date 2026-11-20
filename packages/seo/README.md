# SEO field plugin

Title, description, Open Graph and Twitter tags, noindex, nofollow and a canonical URL, stored as
the `SEO` type from `storyloco/seo`.

## Sections

A field shows more when its schema includes a group by name. The schema helper writes the names
to the field's `include` option, comma-separated:

```ts
import { seo } from 'storyloco/schema'

seo() // the plain field
seo({ include: ['organization'] }) // options: [{ name: 'include', value: 'organization' }]
```

Each group is stored under its own optional key of the value, so a field without it is unchanged.

### `organization`

The site's schema.org Organization, for the story that holds site-wide settings. It adds a
collapsed Organisation section: legal name, founding date, description, a "not to be confused
with" sentence, profile links, brands, and legal entities with their addresses, one of them marked
as the head office. All of it is optional, and blank rows aren't saved.

Each entity has an address search that fills its address fields. It asks
[Photon](https://photon.komoot.io) (OpenStreetMap data, no key, fair use) as the editor types, so
what they type there leaves Storyblok; the fields can always be filled in by hand. Results lean
towards the country of the browser's language (`en-GB` is the UK), not where the editor is.

```ts
import type { SEO } from 'storyloco/seo'

const value: SEO = {
	organization: {
		legal_name: 'EA Technology Limited',
		founding_date: '1966-04-01',
		description: '…',
		disambiguating_description: '…',
		same_as: ['https://www.linkedin.com/company/ea-technology'],
		brands: ['VisNet', 'Fundamentals'],
		entities: [
			{
				name: 'EA Technology Limited',
				street: 'Capenhurst Technology Park, Capenhurst',
				locality: 'Chester',
				postal_code: 'CH1 6ES',
				country: 'GB',
				head_office: true,
			},
		],
	},
}
```

`organization()` builds the JSON-LD entity from it, and returns `undefined` when there is nothing
to say:

```ts
import { organization } from 'storyloco/seo'

organization(seo.organization, { origin, logo, name, url })
```

The head office's address is the organisation's own; the other entities are its
`subOrganization`s. Empty properties are left out and profile links that aren't full `http(s)`
URLs are dropped.

To try the section in the sandbox, add an option named `include` with the value `organization`.
Don't add it to `field-plugin.config.json`: deploying would turn it on for every field.

## Development

For development, run the application locally with

```shell
npm run dev
```

and open the [Sandbox](https://plugin-sandbox.storyblok.com/field-plugin/).

To build the project, run

```shell
npm run build
```

Deploy the field plugin with the CLI. Issue a [personal access token](https://app.storyblok.com/#/me/account?tab=token), rename `.env.local.example` to `.env.example`, open the file, set the value `STORYBLOK_PERSONAL_ACCESS_TOKEN`, and run

```shell
npm run deploy
```

## Manifest File for Field Plugins

The manifest file is a configuration that enhances the functionality of your field plugin. This JSON file, named `field-plugin.config.json` and located in your project's root folder, is optional but highly recommended.

The manifest file allows you to configure [options](https://www.storyblok.com/docs/plugins/field-plugins/introduction#options) for your field plugin. When developing your field plugin with the [Sandbox](https://plugin-sandbox.storyblok.com/field-plugin/), the options are applied by default. Also, the deploy command automatically applies the options in production. So, you no longer need to configure the options manually.

### Configuring a Manifest File

The options list within the file `field-plugin.config.json` should consist of key-value objects representing the essential options required for your field plugin to function correctly, along with their corresponding values. This is an example of how it should be structured:

```json
{
	"options": [
		{
			"name": "myPluginInitialValue",
			"value": 100
		}
	]
}
```

Now, you just need to access these options in your code like in the example below:

```js
console.log(data.options.myPluginInitialValue)
```

## Clean up the boilerplate

To start from a blank state, delete the following files:

- src/components/components.js

And search for comments `DELETE THIS BOILERPLATE` comments and delete the code around them.

## Continuous delivery

Set up [continuous delivery](https://www.storyblok.com/docs/plugins/field-plugins/continuous-delivery) with the CLI. Define an environmental variable `STORYBLOK_PERSONAL_ACCESS_TOKEN`, and use the `--name` and `--skipPrompts` options as such:

```shell
npm run deploy --name $NAME --skipPrompts
```
