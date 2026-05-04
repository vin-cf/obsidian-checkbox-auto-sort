import { Plugin, MarkdownRenderChild } from "obsidian";
import {
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import {
	StateEffect,
} from "@codemirror/state";

const SORTED_EFFECT = StateEffect.define<null>();

const CHECKBOX_RE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]/;
const CHECKED_RE  = /^\s*(?:[-*]|\d+\.)\s+\[[xX]\]/;

export default class CheckboxSortPlugin extends Plugin {
	async onload() {
		this.registerEditorExtension([makeSorterPlugin()]);
		this.registerMarkdownPostProcessor((element, context) => {
			context.addChild(new ReadingViewSorter(element));
		});
	}
	onunload() {}
}

// Handles reading mode sorting. Uses a MutationObserver because Obsidian toggles
// the is-checked class directly on the <li> after a checkbox click — it does not
// re-render the section through the post-processor pipeline.
class ReadingViewSorter extends MarkdownRenderChild {
	private observer!: MutationObserver;

	onload() {
		this.observer = new MutationObserver(() => {
			// Disconnect while we reorder DOM nodes to avoid re-triggering ourselves
			this.observer.disconnect();
			this.sort();
			this.startObserving();
		});
		this.sort();
		this.startObserving();
	}

	onunload() {
		this.observer.disconnect();
	}

	private startObserving() {
		this.observer.observe(this.containerEl, {
			attributes: true,
			attributeFilter: ['class'],
			subtree: true,
		});
	}

	private sort() {
		this.containerEl.querySelectorAll<HTMLElement>('ul.contains-task-list').forEach(list => {
			const items     = Array.from(list.children) as HTMLElement[];
			const unchecked = items.filter(li => li.classList.contains('task-list-item') && !li.classList.contains('is-checked'));
			const checked   = items.filter(li => li.classList.contains('task-list-item') &&  li.classList.contains('is-checked'));

			if (checked.length === 0 || unchecked.length === 0) return;
			for (const li of [...unchecked, ...checked]) list.appendChild(li);
		});
	}
}

function makeSorterPlugin() {
	return ViewPlugin.fromClass(
		class {
			constructor(public view: EditorView) {}

			update(update: ViewUpdate) {
				// Re-entry guard: skip updates produced by our own sort dispatch
				if (update.transactions.some(tr => tr.effects.some(e => e.is(SORTED_EFFECT)))) return;
				if (!update.docChanged) return;

				const doc = update.state.doc;

				const changedLines = new Set<number>();
				update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
					const startLine = doc.lineAt(fromB).number;
					const endLine   = doc.lineAt(toB).number;
					for (let n = startLine; n <= endLine; n++) changedLines.add(n);
				});

				for (const lineNum of changedLines) {
					const line = doc.line(lineNum);
					if (!CHECKBOX_RE.test(line.text)) continue;

					const baseIndent = line.text.match(/^(\s*)/)![1].length;

					const isBlockLine = (n: number) => {
						const t = doc.line(n).text;
						const ind = t.match(/^(\s*)/)![1].length;
						return ind >= baseIndent && (CHECKBOX_RE.test(t) || /^\s*[-*]\s/.test(t));
					};

					let blockStart = lineNum, blockEnd = lineNum;
					while (blockStart > 1         && isBlockLine(blockStart - 1)) blockStart--;
					while (blockEnd   < doc.lines && isBlockLine(blockEnd + 1))   blockEnd++;

					interface ListItem { text: string; checked: boolean; }
					const items: ListItem[] = [];
					let current: ListItem | null = null;
					for (let i = blockStart; i <= blockEnd; i++) {
						const l = doc.line(i);
						const ind = l.text.match(/^(\s*)/)![1].length;
						if (ind === baseIndent) {
							if (current) items.push(current);
							current = { text: l.text, checked: CHECKED_RE.test(l.text) };
						} else if (current) {
							current.text += '\n' + l.text;
						}
					}
					if (current) items.push(current);

					const from     = doc.line(blockStart).from;
					const to       = doc.line(blockEnd).to;
					const original = doc.sliceString(from, to);
					const sorted   = [
						...items.filter(i => !i.checked),
						...items.filter(i =>  i.checked),
					].map(i => i.text).join('\n');

					if (sorted === original) continue;

					const { view } = this;
					queueMicrotask(() => {
						view.dispatch({
							changes: [{ from, to, insert: sorted }],
							effects: SORTED_EFFECT.of(null),
						});
					});
				}
			}
		},
	);
}
