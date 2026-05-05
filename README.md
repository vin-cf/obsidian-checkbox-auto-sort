# Checkboxes: Sort Done to Bottom

![A demo of the plugin working](resources/checkbox-auto-sort.gif)

An [Obsidian](https://obsidian.md) plugin that keeps your checkboxes sorted. When you check off an item, it sinks to the bottom of the list automatically.

## How it works

The moment you tick a checkbox, the plugin reorders the surrounding list block: unchecked items stay at the top, checked items move to the bottom. A subtle divider line appears between the two groups so you can see at a glance what's done and what isn't.
- Works in Reading or Editor mode.
- Only the contiguous checkbox block containing the changed item is reordered; other lists in the note are not affected.
- Child (indented) items stay attached to their parent item.
- The plugin sorts on user edit.

## Installation

### From the Obsidian community plugin browser (recommended)

1. Open **Settings → Community plugins**
2. Turn off Safe mode if prompted
3. Click **Browse** and search for **Checkboxes: Sort done to bottom**
4. Install and enable

## Development workflow

### Prerequisites

- Node.js ≥ 16
- npm

### Setup

```bash
npm install
```

### Development (watch mode)

Run the build in watch mode — it recompiles `main.ts` to `main.js` on every save:

```bash
npm run dev
```

For the fastest feedback loop, clone the repo directly into your vault's plugin folder:

```
<vault>/.obsidian/plugins/checkbox-auto-sort/
```

After each recompile, open the **Command palette** in Obsidian and run **Reload app without saving** (or toggle the plugin off and on in Settings → Community plugins) to pick up the latest build.

### Production build

```bash
npm run build
```

This type-checks first (`tsc -noEmit`) then bundles with esbuild. The output is `main.js`.

### Linting

```bash
npx eslint main.ts
```

## How the code works

`main.ts` registers two CodeMirror 6 extensions:

| Extension | Role |
|---|---|
| `makeSorterPlugin()` | `ViewPlugin` — watches for document changes, identifies the affected checkbox block, and dispatches a transaction that sorts checked items to the end of the block |
| `makeDividerField()` | `StateField` — scans the document on every relevant change and adds a `checkbox-divider-line` CSS decoration to the first checked item in each sorted block |

A `SORTED_EFFECT` state effect acts as a re-entry guard so the sorter ignores transactions it produced itself, preventing infinite update loops.

`styles.css` draws the divider using a top border on the decorated line, themed with Obsidian's `--background-modifier-border` CSS variable so it adapts to light and dark themes automatically.
