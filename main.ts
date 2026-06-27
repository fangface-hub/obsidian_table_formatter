import {
  App,
  EditorPosition,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  livePreviewState
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
  settings: TableFormatterSettings = DEFAULT_SETTINGS;
  private processingFiles = new Set<string>();
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
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }

      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView || activeView.file?.path !== file.path) {
        return;
      }

      if (activeView.getMode() !== "source") {
        return;
      }

      if (!this.settings.editingAssistEnabled) {
        return;
      }

      // Guard against forced focus behavior in Live Preview.
      if (this.isLivePreviewView(activeView)) {
        return;
      }

      void this.handleModify(file);
    }));
  }

  onunload(): void {
    this.processingFiles.clear();
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

    const activeEditingView = this.getActiveEditingView(file);
    const editorState = activeEditingView ? this.captureEditorState(activeEditingView) : null;
    const content = await this.app.vault.cachedRead(file);
    const formatted = formatMarkdownTables(content, this.settings);

    if (formatted === content) {
      return false;
    }

    try {
      this.processingFiles.add(file.path);
      await this.app.vault.process(file, () => formatted);
      if (activeEditingView && editorState) {
        await this.restoreEditorState(activeEditingView, editorState, content, formatted);
      }
    } catch (error) {
      console.error("table-formatter-on-save: failed to format table", error);
      new Notice("Table formatting failed. Check console for details.");
      return false;
    } finally {
      this.processingFiles.delete(file.path);
    }

    return true;
  }

  private getActiveEditingView(file: TFile): MarkdownView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || activeView.file?.path !== file.path || activeView.getMode() !== "source") {
      return null;
    }

    return activeView;
  }

  private isLivePreviewView(view: MarkdownView): boolean {
    const editorWithCodeMirror = view.editor as unknown as {
      cm?: {
        state?: {
          field?: (plugin: unknown, require?: boolean) => unknown;
        };
      };
    };

    const readStateField = editorWithCodeMirror.cm?.state?.field;
    if (typeof readStateField !== "function") {
      return false;
    }

    try {
      return readStateField(livePreviewState, false) !== undefined;
    } catch {
      return false;
    }
  }

  private captureEditorState(view: MarkdownView) {
    const editor = view.editor;
    return {
      selections: editor.listSelections().map((selection) => ({
        anchor: selection.anchor,
        head: selection.head
      })),
      scroll: editor.getScrollInfo()
    };
  }

  private async restoreEditorState(
    view: MarkdownView,
    state: ReturnType<TableFormatterPlugin["captureEditorState"]>,
    sourceContent: string,
    formattedContent: string
  ): Promise<void> {
    await this.waitForEditorFlush();

    if (view.file?.path === undefined || view.getMode() !== "source") {
      return;
    }

    if (!this.settings.editingAssistEnabled || this.isLivePreviewView(view)) {
      return;
    }

    const editor = view.editor;
    const mappedSelections = state.selections.map((selection) => ({
      anchor: this.mapEditorPosition(sourceContent, formattedContent, selection.anchor),
      head: this.mapEditorPosition(sourceContent, formattedContent, selection.head)
    }));
    const currentSelections = editor.listSelections().map((selection) => ({
      anchor: selection.anchor,
      head: selection.head
    }));

    if (this.selectionsMatch(currentSelections, mappedSelections)) {
      return;
    }

    editor.focus();
    editor.setSelections(mappedSelections, 0);
    editor.scrollTo(state.scroll.left, state.scroll.top);
  }

  private async waitForEditorFlush(): Promise<void> {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  }

  private selectionsMatch(
    left: Array<{ anchor: EditorPosition; head: EditorPosition }>,
    right: Array<{ anchor: EditorPosition; head: EditorPosition }>
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((selection, index) => {
      const target = right[index];
      return selection.anchor.line === target.anchor.line
        && selection.anchor.ch === target.anchor.ch
        && selection.head.line === target.head.line
        && selection.head.ch === target.head.ch;
    });
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
