# uiloco-hubspot-form

Storyblok field plugin: pick a HubSpot form from the portal's form list and
store `{ id, name, portal }` as the field value.

Forms are listed by moxy (`https://moxy.uilo.co/api/hubspot/forms`), which
holds the space's HubSpot connection, so no HubSpot token reaches the browser
or Storyblok. The **HubSpot Forms** space plugin (moxy `/apps/hubspot`)
connects the space to HubSpot, by signing in or with a private app token, and
fills in this field's option for you.

## Options

| Option                   | Value                                              |
| ------------------------ | -------------------------------------------------- |
| `MOXY_HUBSPOT_SECRET_ID` | Set by the HubSpot Forms space plugin; don't edit. |

## Value

`portal` is the HubSpot portal id, for rendering and submitting the form
through HubSpot's public embed and submission endpoints. Values saved before
0.2.0 don't have it.

## Development

```sh
bun dev
```
