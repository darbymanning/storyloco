# Storyloco

A collection of slick Storyblok field plugins built with Svelte 5, TypeScript, and Tailwind CSS. Each plugin is designed to be lightweight, performant, and a joy to use.

## 🚀 What's Included

### Field Plugins

- **🎬 Mux Video** - Upload, manage, and configure videos with Mux integration
- **📝 Heading** - Simple heading editor with level selection (H1-H6)
- **🎨 Theme** - Color theme selector with visual previews
- **🔗 Link** - Link editor with support for internal, external, email, and asset links
- **🏗️ Plans** - Floor plan manager with drag-and-drop sorting for types, floors, dimensions, and rooms
- **📝 Input** - Comprehensive form input field with support for all HTML input types, checkboxes, radio buttons, selects, and textareas
- **⏰ Time** - Simple time input field with step control

### Vite Plugins

- **📋 Storyblok Schema** - Automatically generate TypeScript types from your Storyblok components

### Shared Components

A comprehensive UI component library built with:

- **Svelte 5** - Latest reactive framework
- **Tailwind CSS** - Utility-first styling
- **Bits UI** - Headless component primitives
- **TypeScript** - Full type safety

## 📦 Installation

```bash
bun add storyloco
```

## 🎯 Usage

### Import Types

```typescript
// Import specific plugin types
import type { Video } from 'storyloco/mux'
import type { Heading } from 'storyloco/heading'
import type { Link } from 'storyloco/link'
import type { Input } from 'storyloco/input'

// Or import everything
import type { Video, Heading, Link, Input } from 'storyloco'
```

### Use Shared Components

```typescript
import { Input, Label, Switch, Skeleton, Select, Separator } from 'storyloco/shared'
import { cn } from 'storyloco/shared/utils'
```

### Vite Plugins

#### Storyblok Schema Plugin

Automatically generate TypeScript types from your Storyblok components during development:

```typescript
// vite.config.ts
import { storyblok_schema } from 'storyloco/vite'

export default defineConfig({
	plugins: [
		storyblok_schema({
			output_path: 'src/lib/storyblok',
			interval_ms: 60000 // regenerate every minute
		})
	]
})
```

**Options:**

- `storyblok_personal_access_token` - Your Storyblok personal access token (defaults to `STORYBLOK_PERSONAL_ACCESS_TOKEN` env var)
- `storyblok_space_id` - Your Storyblok space ID (defaults to `STORYBLOK_SPACE_ID` env var)
- `output_path` - Where to output generated files (defaults to `src/lib`)
- `interval_ms` - How often to regenerate types (defaults to 60000ms)

The plugin will:

- Pull your component schema from Storyblok
- Generate TypeScript definitions
- Format the output with Prettier
- Lock the generated file to prevent manual edits
- Regenerate automatically when components change

## 🔧 Development

### Prerequisites

- **Bun** (recommended) or Node.js 18+
- **Storyblok** account for field plugin development

### Setup

```bash
# Clone the repo
git clone <your-repo-url>
cd storyloco

# Install dependencies
bun install

# Start development
bun run dev
```

### Project Structure

```
storyloco/
├── packages/
│   ├── mux/          # Video upload & management plugin
│   ├── heading/      # Heading editor plugin
│   ├── theme/        # Theme selector plugin
│   ├── link/         # Link editor plugin
│   ├── input/        # Form input field plugin
│   └── shared/       # UI component library
├── src/
│   └── index.ts      # Type exports
└── package.json      # Root workspace config
```

### Adding New Plugins

1. **Create plugin package**:

   ```bash
   bun run add-plugin
   ```

2. **Export types** in your plugin:

   Create a `types.ts` file in your plugin package:

   ```typescript
   // packages/your-plugin/types.ts
   export interface YourType {
   	// your interface here
   }
   ```

3. **Add to root exports** in `package.json`:

   ```json
   {
   	"exports": {
   		"./your-plugin": {
   			"types": "./packages/your-plugin/types.ts",
   			"import": "./packages/your-plugin/src/app.svelte"
   		}
   	}
   }
   ```

4. **Re-export in `src/index.ts`**:
   ```typescript
   export type { YourType } from '../packages/your-plugin/types'
   ```

## 🎨 Shared Components

The shared package provides a comprehensive set of UI components:

### Form Components

- `Input` - Text input with proper styling
- `Label` - Accessible form labels
- `Switch` - Toggle switch component
- `Select` - Select component
- `Separator` - Separator component

### Display Components

- `Skeleton` - Loading skeleton component

### Utilities

- `cn()` - Class name utility (clsx + tailwind-merge)
- `setup()` - Global setup function

## 🔌 Field Plugin Development

Each plugin follows the Storyblok field plugin pattern:

```svelte
<script lang="ts">
  import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'

  interface YourData {
    // your data structure
  }

  type Plugin = FieldPluginResponse<YourData | null>

  let plugin: Plugin | null = $state(null)
  let content: YourData = $state(initial_value)

  onMount(() => {
    createFieldPlugin({
      enablePortalModal: true,
      validateContent: (c) => {
        // validation logic
        return { content: validated_content }
      },
      onUpdateState: (state) => {
        plugin = state as Plugin
      },
    })
  })
</script>
```

## 🚀 Deployment

### Deploy Individual Plugins

```bash
# From the plugin directory
cd packages/mux
bun run deploy
```

### Build Shared Package

```bash
cd packages/shared
bun run build
```

## 🛠️ Tech Stack

- **Framework**: Svelte 5 with TypeScript
- **Styling**: Tailwind CSS
- **Components**: Shadcn Svelte, Bits UI primitives
- **Build Tool**: Vite
- **Package Manager**: Bun (recommended)
- **Linting**: ESLint + Prettier

## 📄 License

MIT License - feel free to use this however you want, you absolute legend! 🎯

## 🤝 Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built with ❤️ and a lot of swearing by the Storyloco team
