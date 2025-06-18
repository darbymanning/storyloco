# Storyloco

A collection of slick Storyblok field plugins built with Svelte 5, TypeScript, and Tailwind CSS. Each plugin is designed to be lightweight, performant, and a joy to use.

## 🚀 What's Included

### Field Plugins

- **🎬 Mux Video** - Upload, manage, and configure videos with Mux integration
- **📝 Heading** - Simple heading editor with level selection (H1-H6)
- **🎨 Theme** - Color theme selector with visual previews

### Shared Components

A comprehensive UI component library built with:

- **Svelte 5** - Latest reactive framework
- **Tailwind CSS** - Utility-first styling
- **Bits UI** - Headless component primitives
- **TypeScript** - Full type safety

## 📦 Installation

```bash
# Install as a workspace dependency
npm install storyloco@workspace:*

# Or if published to npm
npm install storyloco
```

## 🎯 Usage

### Import Types

```typescript
// Import specific plugin types
import type { Video } from 'storyloco/mux'
import type { Heading } from 'storyloco/heading'

// Or import everything
import type { Video, Heading } from 'storyloco'
```

### Use Shared Components

```typescript
import { Input, Label, Switch, Skeleton } from 'storyloco/shared'
import { cn } from 'storyloco/shared/utils'
```

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

   ```svelte
   <script module lang="ts">
     export interface YourType {
       // your interface here
     }
   </script>
   ```

3. **Add to root exports** in `package.json`:

   ```json
   {
   	"exports": {
   		"./your-plugin": {
   			"types": "./packages/your-plugin/src/app.svelte",
   			"import": "./packages/your-plugin/src/app.svelte"
   		}
   	}
   }
   ```

4. **Re-export in `src/index.ts`**:
   ```typescript
   export type { YourType } from '../packages/your-plugin/src/app.svelte'
   ```

## 🎨 Shared Components

The shared package provides a comprehensive set of UI components:

### Form Components

- `Input` - Text input with proper styling
- `Label` - Accessible form labels
- `Switch` - Toggle switch component

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
- **Styling**: Tailwind CSS 4
- **Components**: Bits UI primitives
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
