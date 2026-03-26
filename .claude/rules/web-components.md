---
paths:
  - "geniro/apps/web/src/pages/**/*.tsx"
  - "geniro/apps/web/src/components/**/*.tsx"
---

# Component Library Rules

## Mandatory: Use `src/components/ui/`

All UI must use components from `src/components/ui/`. Never create custom styled divs/spans that replicate existing primitives (Button, Badge, Card, Input, Dialog, Dropdown, Select, Tabs, etc.).

Available components include: Accordion, Alert, AlertDialog, Avatar, Badge, Breadcrumb, Button, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Command, ContextMenu, Dialog, DropdownMenu, Form, HoverCard, Input, InputOTP, Label, MdEditor, Menubar, NavigationMenu, Pagination, Popover, Progress, RadioGroup, Resizable, ScrollArea, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Switch, Tabs, Table, Textarea, Toggle, ToggleGroup, Tooltip, and domain-specific components (GraphCard, RepoCard, ProjectCard, ChatBubble, AgentAvatar, etc.).

## Component Pattern

Components use Radix UI primitives + CVA + Tailwind:

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const myVariants = cva('base-classes', {
  variants: {
    variant: { default: '...', secondary: '...' },
    size: { default: '...', sm: '...', lg: '...' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

function MyComponent({ className, variant, size, ...props }: Props & VariantProps<typeof myVariants>) {
  return <div className={cn(myVariants({ variant, size }), className)} {...props} />;
}
```

## Rules

1. **Check storybook first** (`src/pages/storybook/page.tsx`) before building any UI.
2. **If a component variant doesn't exist yet**: update the component in `src/components/ui/` first, update its storybook section, then use it in your page.
3. **Never diverge from storybook visuals**. If a page looks different from storybook, fix the page.
4. **Import path**: always `@/components/ui/<component>` (e.g., `import { Button } from '@/components/ui/button'`).
5. **`cn()` for class merging**: `import { cn } from '@/components/ui/utils'`. Use it whenever combining Tailwind classes conditionally.
