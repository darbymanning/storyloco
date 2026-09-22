# Currency

Amount input with a currency selector. Stores `{ currency: 'GBP', amount: 12.5, formatted: '£12.50' }`.

## Options

- `currencies` — comma separated ISO 4217 codes to offer (default `GBP,USD,EUR`)
- `default_currency` — code selected when the field is empty (falls back to `GBP`)
