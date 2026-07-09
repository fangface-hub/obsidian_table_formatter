import {
  App,
  EditorChange,
  EditorPosition,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  TableFormatterSettings,
  formatMarkdownTables,
  getBlockquotePrefix,
  looksLikeTableRow,
  parseRowLayout
} from "./tableFormatter";

export default class TableFormatterPlugin extends Plugin {
  private static readonly MODIFY_FORMAT_DELAY_MS = 1500;

  settings: TableFormatterSettings = DEFAULT_SETTINGS;
  private processingFiles = new Set<string>();
  private modifyFormatTimers = new Map<string, number>();
  private toggleRibbonEl: HTMLElement | null = null;
  private toggleStatusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    try {
      this.addSettingTab(new TableFormatterSettingTab(this.app, this));
    } catch (error) {
      console.error("Failed to add setting tab:", error);
    }

    this.addRibbonIcon("table", "Format tables in active file", () => {
      void this.formatActiveFile();
    });

    this.toggleRibbonEl = this.addRibbonIcon("power", "", () => {
      void this.toggleEditingAssist();
    });

    this.toggleStatusBarEl = this.addStatusBarItem();
    this.toggleStatusBarEl.addClass("mod-clickable");
    this.toggleStatusBarEl.addEventListener("click", () => {
      void this.toggleEditingAssist();
    });

    this.refreshToggleRibbonButton();

    this.addCommand({
      id: "format-active-markdown-tables",
      name: "Format tables in active file",
      callback: async () => {
        await this.formatActiveFile();
      }
    });

    this.addCommand({
      id: "format-all-markdown-tables",
      name: "Format tables in all files",
      callback: () => {
        this.promptFormatAllFiles();
      }
    });

    this.addCommand({
      id: "toggle-editing-assist",
      name: "Toggle auto-format and focus control while editing",
      callback: async () => {
        await this.toggleEditingAssist();
      }
    });

    // In source mode, auto-format table edits when editing assist is enabled.
    // The work is debounced so formatting runs between edit bursts instead of
    // on every autosave while typing.
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }

      this.scheduleModifyFormat(file);
    }));
  }

  onunload(): void {
    for (const timer of this.modifyFormatTimers.values()) {
      window.clearTimeout(timer);
    }
    this.modifyFormatTimers.clear();
    this.processingFiles.clear();
  }

  private scheduleModifyFormat(file: TFile): void {
    const pending = this.modifyFormatTimers.get(file.path);
    if (pending !== undefined) {
      window.clearTimeout(pending);
    }

    const timer = window.setTimeout(() => {
      this.modifyFormatTimers.delete(file.path);
      void this.formatAfterModify(file);
    }, TableFormatterPlugin.MODIFY_FORMAT_DELAY_MS);
    this.modifyFormatTimers.set(file.path, timer);
  }

  // Guards run when the debounce fires, not when the modify event arrives,
  // so a mode switch or toggle change during the delay is respected.
  private async formatAfterModify(file: TFile): Promise<void> {
    if (!this.settings.editingAssistEnabled) {
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || activeView.file?.path !== file.path) {
      return;
    }

    if (activeView.getMode() !== "source") {
      return;
    }

    if (this.isLivePreviewView(activeView)) {
      return;
    }

    await this.handleModify(file);
  }

  private async handleModify(file: TAbstractFile): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }

    await this.formatFile(file);
  }

  private async formatActiveFile(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      new Notice("No active Markdown file.");
      return;
    }

    const changed = await this.formatFile(activeFile);
    if (changed) {
      new Notice("Tables formatted in active file.");
      return;
    }

    new Notice("No table changes were needed.");
  }

  private promptFormatAllFiles(): void {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new Notice("No Markdown files to format.");
      return;
    }

    new ConfirmFormatAllModal(this.app, files.length, () => {
      void this.formatAllFiles();
    }).open();
  }

  private async formatAllFiles(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new Notice("No Markdown files to format.");
      return;
    }

    let changed = 0;
    let failed = 0;
    for (const file of files) {
      try {
        if (await this.formatFile(file)) {
          changed += 1;
        }
      } catch (error) {
        failed += 1;
        console.error("table-formatter: failed to format", file.path, error);
      }
    }

    const base = `Formatted tables in ${changed} of ${files.length} files.`;
    new Notice(failed > 0 ? `${base} ${failed} could not be processed.` : base);
  }

  private async formatFile(file: TFile): Promise<boolean> {
    if (this.processingFiles.has(file.path)) {
      return false;
    }

    try {
      this.processingFiles.add(file.path);

      // Prefer editing the open buffer: Obsidian then sees a normal edit
      // instead of an external disk change, so there is no "modified
      // externally" popup and the metadata cache stays valid.
      const activeEditingView = this.getActiveEditingView(file);
      if (activeEditingView) {
        return this.formatThroughEditor(activeEditingView);
      }

      const content = await this.app.vault.cachedRead(file);
      const formatted = formatMarkdownTables(content, this.settings);
      if (formatted === content) {
        return false;
      }

      await this.app.vault.process(file, () => formatted);
    } catch (error) {
      console.error("table-formatter-on-save: failed to format table", error);
      new Notice("Table formatting failed. Check console for details.");
      return false;
    } finally {
      this.processingFiles.delete(file.path);
    }

    return true;
  }

  private formatThroughEditor(view: MarkdownView): boolean {
    const editor = view.editor;
    const content = editor.getValue();
    const formatted = formatMarkdownTables(content, this.settings);

    if (formatted === content) {
      return false;
    }

    const selections = editor.listSelections().map((selection) => ({
      anchor: selection.anchor,
      head: selection.head
    }));
    const scroll = editor.getScrollInfo();

    const sourceLines = content.split("\n");
    const formattedLines = formatted.split("\n");

    if (sourceLines.length === formattedLines.length) {
      // formatMarkdownTables emits one output line per input line, so the
      // reformat can be applied as per-line changes. Untouched lines keep
      // their positions, which keeps the visible jump to a minimum.
      const changes: EditorChange[] = [];
      for (let line = 0; line < sourceLines.length; line += 1) {
        if (sourceLines[line] !== formattedLines[line]) {
          changes.push({
            from: { line, ch: 0 },
            to: { line, ch: sourceLines[line].length },
            text: formattedLines[line]
          });
        }
      }
      editor.transaction({ changes });
    } else {
      editor.setValue(formatted);
    }

    editor.setSelections(selections.map((selection) => ({
      anchor: this.mapEditorPosition(content, formatted, selection.anchor),
      head: this.mapEditorPosition(content, formatted, selection.head)
    })), 0);
    editor.scrollTo(scroll.left, scroll.top);

    return true;
  }

  private getActiveEditingView(file: TFile): MarkdownView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || activeView.file?.path !== file.path || activeView.getMode() !== "source") {
      return null;
    }

    return activeView;
  }

  // getMode() reports "source" for both raw Source mode and Live Preview,
  // so the two must be told apart here. getState().source is true only in
  // raw Source mode. When no clear signal is available, the view is treated
  // as Live Preview so auto-formatting stays off instead of fighting the
  // renderer.
  private isLivePreviewView(view: MarkdownView): boolean {
    const state = view.getState() as { source?: unknown };
    if (typeof state.source === "boolean") {
      return !state.source;
    }

    const sourceView = view.contentEl.querySelector(".markdown-source-view");
    if (sourceView) {
      return sourceView.classList.contains("is-live-preview");
    }

    return true;
  }

  private mapEditorPosition(sourceContent: string, formattedContent: string, position: EditorPosition): EditorPosition {
    const sourceLines = sourceContent.split(/\r?\n/);
    const formattedLines = formattedContent.split(/\r?\n/);
    const line = Math.max(0, Math.min(position.line, formattedLines.length - 1));
    const sourceLine = sourceLines[line] ?? "";
    const formattedLine = formattedLines[line] ?? "";
    const fallbackCh = this.clampCursorPosition(position.ch, formattedLine.length);

    if (!looksLikeTableRow(sourceLine) || !looksLikeTableRow(formattedLine)) {
      return {
        line,
        ch: fallbackCh
      };
    }

    const mappedCh = this.mapTableRowCh(sourceLine, formattedLine, position.ch);
    return {
      line,
      ch: this.clampCursorPosition(mappedCh, formattedLine.length)
    };
  }

  private clampCursorPosition(mappedCh: number, lineLength: number): number {
    if (lineLength <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(mappedCh, lineLength));
  }

  private mapTableRowCh(sourceLine: string, formattedLine: string, sourceCh: number): number {
    const sourceNormalized = this.normalizeTableLine(sourceLine);
    const formattedNormalized = this.normalizeTableLine(formattedLine);
    const sourceLayout = parseRowLayout(sourceNormalized.text);
    const formattedLayout = parseRowLayout(formattedNormalized.text);
    if (!sourceLayout || !formattedLayout || sourceLayout.cells.length !== formattedLayout.cells.length) {
      return sourceCh;
    }

    const sourceColumn = Math.max(0, Math.min(sourceCh - sourceNormalized.rawOffset, sourceNormalized.text.length));
    const cellIndex = sourceLayout.cells.findIndex((cell) => sourceColumn >= cell.start && sourceColumn <= cell.end);
    if (cellIndex < 0) {
      return sourceCh;
    }

    const sourceCell = sourceLayout.cells[cellIndex];
    const formattedCell = formattedLayout.cells[cellIndex];
    const sourceLeadingSpaces = Math.max(0, sourceCell.contentStart - sourceCell.start);
    const sourceContentEnd = sourceCell.contentStart + sourceCell.contentLength;
    const sourceTrailingSpaces = Math.max(0, sourceCell.end - sourceContentEnd);
    const formattedLeadingSpaces = Math.max(0, formattedCell.contentStart - formattedCell.start);
    const formattedContentEnd = formattedCell.contentStart + formattedCell.contentLength;
    const formattedTrailingSpaces = Math.max(0, formattedCell.end - formattedContentEnd);

    if (sourceColumn < sourceCell.contentStart) {
      const offsetWithinLeading = Math.min(sourceColumn - sourceCell.start, sourceLeadingSpaces);
      return formattedNormalized.rawOffset + formattedCell.start + Math.min(offsetWithinLeading, formattedLeadingSpaces);
    }

    if (sourceColumn <= sourceContentEnd) {
      const offsetWithinContent = Math.min(sourceColumn - sourceCell.contentStart, sourceCell.contentLength);
      return formattedNormalized.rawOffset + formattedCell.contentStart + Math.min(offsetWithinContent, formattedCell.contentLength);
    }

    const offsetWithinTrailing = Math.min(sourceColumn - sourceContentEnd, sourceTrailingSpaces);
    return formattedNormalized.rawOffset + formattedContentEnd + Math.min(offsetWithinTrailing, formattedTrailingSpaces);
  }

  private normalizeTableLine(line: string): { text: string; rawOffset: number } {
    const prefixLength = getBlockquotePrefix(line).length;
    const withoutPrefix = line.slice(prefixLength);
    const trimStartLength = withoutPrefix.length - withoutPrefix.trimStart().length;

    return {
      text: withoutPrefix.trim(),
      rawOffset: prefixLength + trimStartLength
    };
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const loaded = (data ?? {}) as Partial<TableFormatterSettings>;

    const paddingSpaces = Number.isInteger(loaded.paddingSpaces)
      && (loaded.paddingSpaces as number) >= 0
      ? (loaded.paddingSpaces as number)
      : null;

    const dashCount = Number.isInteger(loaded.dashCount)
      && (loaded.dashCount as number) >= 1
      ? (loaded.dashCount as number)
      : null;

    const editingAssistEnabled = typeof loaded.editingAssistEnabled === "boolean"
      ? loaded.editingAssistEnabled
      : DEFAULT_SETTINGS.editingAssistEnabled;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      paddingSpaces,
      dashCount,
      editingAssistEnabled
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshToggleRibbonButton(): void {
    const enabled = this.settings.editingAssistEnabled;
    const label = enabled
      ? "Disable auto-format and focus control while editing"
      : "Enable auto-format and focus control while editing";

    if (this.toggleRibbonEl) {
      this.toggleRibbonEl.setAttribute("aria-label", label);
      this.toggleRibbonEl.classList.toggle("is-active", enabled);
    }

    if (this.toggleStatusBarEl) {
      this.toggleStatusBarEl.setAttribute("aria-label", label);
      this.toggleStatusBarEl.setText(`Table Formatter: ${enabled ? "ON" : "OFF"}`);
    }
  }

  private async toggleEditingAssist(): Promise<void> {
    this.settings.editingAssistEnabled = !this.settings.editingAssistEnabled;
    await this.saveSettings();
    this.refreshToggleRibbonButton();
    new Notice(this.settings.editingAssistEnabled
      ? "Auto-format and focus control enabled while editing."
      : "Auto-format and focus control disabled while editing.");
  }
}

class TableFormatterSettingTab extends PluginSettingTab {
  plugin: TableFormatterPlugin;

  constructor(app: App, plugin: TableFormatterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    try {
      const { containerEl } = this;
      containerEl.empty();

      new Setting(containerEl)
        .setName("Padding spaces")
        .setDesc("Set the number of spaces around each cell. Leave blank for auto (single space).")
        .addText((text) => {
          text
            .setPlaceholder("blank or 0+")
            .setValue(this.plugin.settings.paddingSpaces === null ? "" : String(this.plugin.settings.paddingSpaces))
            .onChange(async (value) => {
              const trimmed = value.trim();
              if (trimmed === "") {
                this.plugin.settings.paddingSpaces = null;
                await this.plugin.saveSettings();
                return;
              }

              const parsed = Number(trimmed);
              if (!Number.isInteger(parsed) || parsed < 0) {
                new Notice("Padding spaces must be an integer >= 0 or blank.");
                text.setValue(this.plugin.settings.paddingSpaces === null ? "" : String(this.plugin.settings.paddingSpaces));
                return;
              }

              this.plugin.settings.paddingSpaces = parsed;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Table border dash count")
        .setDesc("Number of hyphens for each delimiter cell in the table separator row. Leave blank for auto.")
        .addText((text) => {
          text
            .setPlaceholder("blank or 1+")
            .setValue(this.plugin.settings.dashCount === null ? "" : String(this.plugin.settings.dashCount))
            .onChange(async (value) => {
              const trimmed = value.trim();
              if (trimmed === "") {
                this.plugin.settings.dashCount = null;
                await this.plugin.saveSettings();
                return;
              }

              const parsed = Number(trimmed);
              if (!Number.isInteger(parsed) || parsed < 1) {
                new Notice("Dash count must be an integer >= 1 or blank.");
                text.setValue(this.plugin.settings.dashCount === null ? "" : String(this.plugin.settings.dashCount));
                return;
              }

              this.plugin.settings.dashCount = parsed;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Enable auto-format and focus control while editing")
        .setDesc("Controls modify-triggered table formatting and focus/selection restoration in Source mode.")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.editingAssistEnabled)
            .onChange(async (value) => {
              this.plugin.settings.editingAssistEnabled = value;
              await this.plugin.saveSettings();
              this.plugin.refreshToggleRibbonButton();
            });
        });
    } catch (error) {
      console.error("Error displaying settings:", error);
    }
  }
}

class ConfirmFormatAllModal extends Modal {
  private readonly fileCount: number;
  private readonly onConfirm: () => void;

  constructor(app: App, fileCount: number, onConfirm: () => void) {
    super(app);
    this.fileCount = fileCount;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Format tables in all files" });
    contentEl.createEl("p", {
      text: `This rewrites Markdown tables in ${this.fileCount} files across the vault. It cannot be undone in one step, so make sure your vault is backed up or under version control.`
    });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });

    const confirmButton = buttons.createEl("button", { text: "Format all files", cls: "mod-cta" });
    confirmButton.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });

    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
