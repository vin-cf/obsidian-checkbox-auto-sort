import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice, // optional: for small toasts
	Platform,
} from "obsidian";

import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, StateField, EditorState } from "@codemirror/state";

interface TodoistSettings {
	hideCompleted: boolean;
	hideInReadingView: boolean;
	hideInEditor: boolean;
}

const DEFAULT_SETTINGS: TodoistSettings = {
	hideCompleted: true,
	hideInReadingView: true,
	hideInEditor: true,
};

export default class TodoistStyleTasksPlugin extends Plugin {
	settings: TodoistSettings = DEFAULT_SETTINGS;
	private revealTimer: number | null = null;
	private editorExtension: any;
	private statusBtn: HTMLElement | null = null;

	async onload() {
		console.log("[checklists] loading plugin v1.0.0");
		await this.loadSettings();

		this.applyBodyClasses();

		// Reading view processor: hide completed on initial render + react to user clicks
		this.registerMarkdownPostProcessor(
			(el: HTMLElement, _ctx: MarkdownPostProcessorContext) => {
				if (!this.settings.hideInReadingView) return;
				console.log("[checklists] post-processor ran");

				const checkboxes = el.querySelectorAll<HTMLInputElement>(
					'input[type="checkbox"]',
				);
				console.log(
					"[checklists] found checkboxes:",
					checkboxes.length,
				);

				checkboxes.forEach((cb) => {
					const li = cb.closest("li");
					if (!li) return;

					const update = () => {
						const shouldHide =
							this.settings.hideCompleted &&
							this.settings.hideInReadingView &&
							cb.checked &&
							!document.body.classList.contains(
								"todoist-reveal-completed",
							);
						li.classList.toggle("todoist-hidden", shouldHide);
						if (shouldHide)
							console.log(
								"[checklists] hid <li>",
								li.textContent?.trim(),
							);
					};

					update(); // initial
					cb.addEventListener("change", update); // subsequent checks/unchecks
				});
			},
		);

		// Editor (CM6)
		this.editorExtension = this.makeEditorHider();
		this.registerEditorExtension(this.editorExtension);

		// Commands
		this.addCommand({
			id: "toggle-hide-completed",
			name: "Toggle: Hide Completed Tasks",
			callback: async () => {
				this.settings.hideCompleted = !this.settings.hideCompleted;
				await this.saveSettings();
				this.applyBodyClasses();
				this.refreshAllEditors();
				this.applyReadingViewHidingNow(); // ← sweep existing Reading Views
				// new Notice(`Hide completed: ${this.settings.hideCompleted ? "ON" : "OFF"}`, 1200);
			},
		});

		// this.addSettingTab(new TodoistSettingTab(this.app, this));
    this.mountStatusToggle(); // ✅ shows on mobile bottom bar 
	}

	onunload() {
		console.log("[checklists] unloading plugin");
		if (this.revealTimer) window.clearTimeout(this.revealTimer);
		document.body.classList.remove(
			"todoist-hide-completed",
			"todoist-reveal-completed",
		);
	}

	private mountStatusToggle() {
		// Make a button in the bottom status bar
		this.statusBtn = this.addStatusBarItem();
		this.statusBtn.addClass("todoist-status-btn");
		const sync = () => {
			this.statusBtn!.setText(
				this.settings.hideCompleted ? "Hide ✓" : "Show ✓",
			);
			this.statusBtn!.setAttr(
				"aria-pressed",
				String(this.settings.hideCompleted),
			);
		};
		sync();

		this.statusBtn.addEventListener("click", async () => {
			this.settings.hideCompleted = !this.settings.hideCompleted;
			await this.saveSettings();
			this.applyBodyClasses();
			this.refreshAllEditors();
			this.applyReadingViewHidingNow?.(); // if you added this sweep helper
			sync();
		});
	}

	private applyBodyClasses() {
		const on = this.settings.hideCompleted;
		console.log("[checklists] hideCompleted =", on);
		document.body.classList.toggle("todoist-hide-completed", on);
		console.log(
			"[checklists] body.classList ->",
			document.body.classList.value,
		);
	}

	private applyReadingViewHidingNow() {
		if (!this.settings.hideInReadingView) return;

		const previews = document.querySelectorAll<HTMLElement>(
			".markdown-preview-view",
		);
		const reveal = document.body.classList.contains(
			"todoist-reveal-completed",
		);
		const active = this.settings.hideCompleted && !reveal;

		previews.forEach((root) => {
			root.querySelectorAll<HTMLInputElement>(
				'input[type="checkbox"]',
			).forEach((cb) => {
				const li = cb.closest("li");
				if (!li) return;
				li.classList.toggle("todoist-hidden", active && cb.checked);
			});
		});

		console.log("[checklists] sweep complete (reading view)");
	}

	private refreshAllEditors() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const mv = leaf.view as MarkdownView;
			const cm = (mv?.editor as any)?.cm as EditorView | undefined;
			if (cm) {
				cm.dispatch({ changes: { from: 0, to: 0, insert: "" } }); // no-op change triggers rebuild
				(cm as any).requestMeasure?.(() => {});
			}
		});
	}

	private makeEditorHider() {
		const plugin = this;
		const hideLineDeco = Decoration.line({
			attributes: { class: "todoist-hide-line" },
		});

		function buildDecorations(state: EditorState): DecorationSet {
			const builder = new RangeSetBuilder<Decoration>();

			const cssOn =
				document.body.classList.contains("todoist-hide-completed") &&
				!document.body.classList.contains("todoist-reveal-completed");

			if (
				!(
					plugin.settings.hideCompleted &&
					plugin.settings.hideInEditor &&
					cssOn
				)
			) {
				// console.log("[checklists] CM6: hiding OFF");
				return builder.finish();
			}

			// Support -, *, and ordered lists like "1. [x] ..."
			const re = /^\s*(?:[-*]|\d+\.)\s+\[(x|X)\]\s.*$/;
			// Count hits while developing:
			// let hits = 0;

			for (let i = 1; i <= state.doc.lines; i++) {
				const line = state.doc.line(i);
				if (re.test(line.text)) {
					// hits++;
					builder.add(line.from, line.from, hideLineDeco);
				}
			}
			// console.log("[checklists] CM6 hidden line count:", hits);
			return builder.finish();
		}

		const field = StateField.define<DecorationSet>({
			create(state) {
				return buildDecorations(state);
			},
			update(deco, tr) {
				if (tr.docChanged) return buildDecorations(tr.state);
				if (tr.selection) return buildDecorations(tr.state);
				// @ts-ignore optional in some builds
				if (tr.reconfigured) return buildDecorations(tr.state);
				return deco;
			},
			provide: (f) => EditorView.decorations.from(f),
		});

		const pokeOnViewUpdate = ViewPlugin.fromClass(
			class {
				constructor(public view: EditorView) {}
				update(_u: ViewUpdate) {
					// no-op; refreshAllEditors() forces rebuilds when needed
				}
			},
		);

		return [field, pokeOnViewUpdate];
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// class TodoistSettingTab extends PluginSettingTab {
//   plugin: TodoistStyleTasksPlugin;

//   constructor(app: App, plugin: TodoistStyleTasksPlugin) {
//     super(app, plugin);
//     this.plugin = plugin;
//   }

//   display(): void {
//     const { containerEl } = this;
//     containerEl.empty();
//     containerEl.createEl("h2", { text: "Todoist-style Tasks" });

//     new Setting(containerEl)
//       .setName("Hide completed tasks")
//       .setDesc("Master toggle for hiding completed tasks everywhere.")
//       .addToggle((t) =>
//         t.setValue(this.plugin.settings.hideCompleted).onChange(async (v) => {
//           this.plugin.settings.hideCompleted = v;
//           await this.plugin.saveSettings();
//           this.plugin.applyBodyClasses();
//           this.plugin.refreshAllEditors();
//           this.plugin.applyReadingViewHidingNow();
//         })
//       );

//     new Setting(containerEl)
//       .setName("Hide in Reading View")
//       .setDesc("Hide checked tasks in Reading View.")
//       .addToggle((t) =>
//         t.setValue(this.plugin.settings.hideInReadingView).onChange(async (v) => {
//           this.plugin.settings.hideInReadingView = v;
//           await this.plugin.saveSettings();
//           this.plugin.applyReadingViewHidingNow();
//         })
//       );

//     new Setting(containerEl)
//       .setName("Hide in Editor (Live Preview / Source)")
//       .setDesc("Hide checked tasks while editing.")
//       .addToggle((t) =>
//         t.setValue(this.plugin.settings.hideInEditor).onChange(async (v) => {
//           this.plugin.settings.hideInEditor = v;
//           await this.plugin.saveSettings();
//           this.plugin.refreshAllEditors();
//         })
//       );
//   }
// }
