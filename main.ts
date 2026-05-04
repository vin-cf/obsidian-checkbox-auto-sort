import { Plugin } from "obsidian";
import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import {
	StateEffect,
	StateField,
	RangeSetBuilder,
	EditorState,
} from "@codemirror/state";

const SORTED_EFFECT = StateEffect.define<null>();

const CHECKBOX_RE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]/;
const CHECKED_RE  = /^\s*(?:[-*]|\d+\.)\s+\[[xX]\]/;

export default class CheckboxSortPlugin extends Plugin {
	async onload() {
		this.registerEditorExtension([makeSorterPlugin(), makeDividerField()]);
	}
	onunload() {}
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

function makeDividerField() {
	const dividerDeco = Decoration.line({ attributes: { class: "checkbox-divider-line" } });

	function buildDividers(state: EditorState): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const doc = state.doc;
		let prevWasCheckbox = false;
		let prevChecked     = false;

		for (let i = 1; i <= doc.lines; i++) {
			const line      = doc.line(i);
			const isCheckbox = CHECKBOX_RE.test(line.text);
			const isChecked  = isCheckbox && CHECKED_RE.test(line.text);

			if (isCheckbox) {
				// First checked line after at least one unchecked line in the same block
				if (isChecked && !prevChecked && prevWasCheckbox) {
					builder.add(line.from, line.from, dividerDeco);
				}
				prevChecked     = isChecked;
				prevWasCheckbox = true;
			} else {
				prevWasCheckbox = false;
				prevChecked     = false;
			}
		}
		return builder.finish();
	}

	return StateField.define<DecorationSet>({
		create: (state) => buildDividers(state),
		update: (decos, tr) => {
			if (tr.docChanged || tr.effects.some(e => e.is(SORTED_EFFECT))) {
				return buildDividers(tr.state);
			}
			return decos;
		},
		provide: f => EditorView.decorations.from(f),
	});
}
