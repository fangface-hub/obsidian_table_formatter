import {
  App,
  EditorPosition,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile
} from "obsidian";

interface TableFormatterSettings {
  paddingSpaces: number | null;
  dashCount: number | null;
}

const DEFAULT_SETTINGS: TableFormatterSettings = {
  paddingSpaces: null,
  dashCount: null
};

type ParsedTable = {
  rows: string[][];
};

export default class TableFormatterPlugin extends Plugin {
  settings: TableFormatterSettings = DEFAULT_SETTINGS;
  private processingFiles = new Set<string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TableFormatterSettingTab(this.app, this));

    this.addCommand({
      id: "format-active-markdown-tables",
      name: "Format tables in active file",
      callback: async () => {
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
    });

    this.registerEvent(this.app.vault.on("modify", (file) => {
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
        this.restoreEditorState(activeEditingView, editorState, content, formatted);
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

  private restoreEditorState(
    view: MarkdownView,
    state: ReturnType<TableFormatterPlugin["captureEditorState"]>,
    sourceContent: string,
    formattedContent: string
  ): void {
    const editor = view.editor;
    const mappedSelections = state.selections.map((selection) => ({
      anchor: this.mapEditorPosition(sourceContent, formattedContent, selection.anchor),
      head: this.mapEditorPosition(sourceContent, formattedContent, selection.head)
    }));

    editor.focus();
    editor.setSelections(mappedSelections, 0);
    editor.scrollTo(state.scroll.left, state.scroll.top);
  }

  private mapEditorPosition(sourceContent: string, formattedContent: string, position: EditorPosition): EditorPosition {
    const sourceLines = sourceContent.split(/\r?\n/);
    const formattedLines = formattedContent.split(/\r?\n/);
    const line = Math.max(0, Math.min(position.line, formattedLines.length - 1));
    const sourceLine = sourceLines[line] ?? "";
    const formattedLine = formattedLines[line] ?? "";

    if (!looksLikeTableRow(sourceLine) || !looksLikeTableRow(formattedLine)) {
      return {
        line,
        ch: Math.max(0, Math.min(position.ch, formattedLine.length))
      };
    }

    const mappedCh = this.mapTableRowCh(sourceLine, formattedLine, position.ch);
    return {
      line,
      ch: mappedCh
    };
  }

  private mapTableRowCh(sourceLine: string, formattedLine: string, sourceCh: number): number {
    const sourceLayout = parseRowLayout(sourceLine);
    const formattedLayout = parseRowLayout(formattedLine);
    if (!sourceLayout || !formattedLayout || sourceLayout.cells.length !== formattedLayout.cells.length) {
      return Math.max(0, Math.min(sourceCh, formattedLine.length));
    }

    const sourceColumn = Math.max(0, sourceCh);
    const cellIndex = sourceLayout.cells.findIndex((cell) => sourceColumn >= cell.start && sourceColumn <= cell.end);
    if (cellIndex < 0) {
      return Math.max(0, Math.min(sourceCh, formattedLine.length));
    }

    const sourceCell = sourceLayout.cells[cellIndex];
    const formattedCell = formattedLayout.cells[cellIndex];
    const offsetWithinCell = Math.max(0, Math.min(sourceColumn - sourceCell.contentStart, sourceCell.contentLength));
    return Math.max(0, Math.min(formattedCell.contentStart + Math.min(offsetWithinCell, formattedCell.contentLength), formattedLine.length));
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

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      paddingSpaces,
      dashCount
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class TableFormatterSettingTab extends PluginSettingTab {
  plugin: TableFormatterPlugin;

  constructor(app: App, plugin: TableFormatterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
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
  }
}

function formatMarkdownTables(content: string, settings: TableFormatterSettings): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let inCodeFence = false;

  let i = 0;
  while (i < lines.length) {
    if (isFenceLine(lines[i])) {
      inCodeFence = !inCodeFence;
      output.push(lines[i]);
      i += 1;
      continue;
    }

    if (inCodeFence) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    if (!isTableStart(lines, i)) {
      output.push(lines[i]);
      i += 1;
      continue;
    }

    const start = i;
    const tablePrefix = getBlockquotePrefix(lines[start]);
    let end = i + 1;
    while (end + 1 < lines.length && looksLikeTableRow(lines[end + 1])) {
      end += 1;
    }

    const blockLines = lines.slice(start, end + 1);
    const formatted = formatTableBlock(blockLines, settings, tablePrefix);
    output.push(...formatted);
    i = end + 1;
  }

  return output.join("\n");
}

function isFenceLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }

  const first = lines[index];
  const second = lines[index + 1];

  return looksLikeTableRow(first) && isDelimiterRow(second);
}

function looksLikeTableRow(line: string): boolean {
  const trimmed = stripBlockquotePrefix(line).trim();
  return trimmed.includes("|") && trimmed.length > 0;
}

function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  if (cells.length === 0) {
    return false;
  }

  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}

function splitRow(line: string): string[] {
  const trimmed = stripBlockquotePrefix(line).trim();
  let text = trimmed;

  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|")) {
    text = text.slice(0, -1);
  }

  return text.split("|").map((cell) => cell.trim());
}

function getBlockquotePrefix(line: string): string {
  const match = line.match(/^\s*(?:>\s*)+/);
  return match ? match[0] : "";
}

function stripBlockquotePrefix(line: string): string {
  const prefix = getBlockquotePrefix(line);
  if (!prefix) {
    return line;
  }

  return line.slice(prefix.length);
}

type RowLayoutCell = {
  start: number;
  end: number;
  contentStart: number;
  contentLength: number;
};

type RowLayout = {
  cells: RowLayoutCell[];
};

function parseRowLayout(line: string): RowLayout | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return null;
  }

  let body = trimmed;
  const hasLeadingPipe = body.startsWith("|");
  const hasTrailingPipe = body.endsWith("|");

  if (hasLeadingPipe) {
    body = body.slice(1);
  }
  if (hasTrailingPipe) {
    body = body.slice(0, -1);
  }

  const parts = body.split("|");
  const cells: RowLayoutCell[] = [];
  let cursor = hasLeadingPipe ? 1 : 0;

  parts.forEach((part) => {
    const leadingSpaces = part.length - part.trimStart().length;
    const content = part.trim();
    const contentStart = cursor + leadingSpaces;
    const start = cursor;
    const end = cursor + part.length;

    cells.push({
      start,
      end,
      contentStart,
      contentLength: content.length
    });

    cursor = end + 1;
  });

  return {
    cells
  };
}

function parseTable(lines: string[]): ParsedTable {
  const rows = lines.map(splitRow);

  return {
    rows
  };
}

function formatTableBlock(lines: string[], settings: TableFormatterSettings, prefix: string): string[] {
  const parsed = parseTable(lines);
  const columnCount = Math.max(...parsed.rows.map((row) => row.length));

  const normalizedRows = parsed.rows.map((row) => {
    const cloned = row.slice();
    while (cloned.length < columnCount) {
      cloned.push("");
    }
    return cloned;
  });

  const contentWidths = new Array<number>(columnCount).fill(0);
  normalizedRows.forEach((row, rowIndex) => {
    if (rowIndex === 1) {
      return;
    }
    row.forEach((cell, colIndex) => {
      contentWidths[colIndex] = Math.max(contentWidths[colIndex], cell.length);
    });
  });

  const delimiterRow = new Array<string>(columnCount).fill("").map((_, colIndex) => {
    const dashCount = settings.dashCount ?? Math.max(3, contentWidths[colIndex]);
    return buildDelimiterCell(dashCount);
  });

  const formattedRows: string[] = [];
  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    if (rowIndex === 1) {
      formattedRows.push(formatRow(delimiterRow, settings.paddingSpaces, true));
      continue;
    }

    const row = normalizedRows[rowIndex];
    formattedRows.push(formatRow(row, settings.paddingSpaces, false));
  }

  if (!prefix) {
    return formattedRows;
  }

  return formattedRows.map((row) => `${prefix}${row}`);
}

function buildDelimiterCell(dashCount: number): string {
  const dashes = "-".repeat(Math.max(1, dashCount));
  return dashes;
}

function formatRow(
  row: string[],
  paddingSpaces: number | null,
  isDelimiter: boolean
): string {
  if (paddingSpaces === null) {
    const minimal = row.map((cell) => ` ${cell.trim()} `);
    return `|${minimal.join("|")}|`;
  }

  const padded = row.map((cell) => {
    const left = " ".repeat(paddingSpaces);
    const right = " ".repeat(paddingSpaces);

    if (isDelimiter) {
      const delimiter = cell;
      return `${left}${delimiter}${right}`;
    }

    const value = cell.trim();
    return `${left}${value}${right}`;
  });

  return `|${padded.join("|")}|`;
}
