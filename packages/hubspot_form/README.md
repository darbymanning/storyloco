# uiloco-hubspot-form

Storyblok field plugin: pick a HubSpot form from the portal's form list and
store `{ id, name }` as the field value.

Forms are listed via a site-hosted proxy (e.g. `/api/hubspot/forms` on the
consuming site) so the real HubSpot token never reaches the browser. The
proxy authenticates callers with its own token and restricts CORS to
Storyblok origins.

## Options

| Option                | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| `HUBSPOT_PROXY_URL`   | Base URL of the proxy, e.g. `https://example.com/api/hubspot` |
| `HUBSPOT_PROXY_TOKEN` | The proxy's `HUBSPOT_PROXY_TOKEN` env value                   |

## Development

```sh
bun dev
```
