"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TableFormatterPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// tableFormatter.ts
var DEFAULT_SETTINGS = {
  paddingSpaces: null,
  dashCount: null,
  editingAssistEnabled: true
};
function formatMarkdownTables(content, settings) {
  const lines = content.split(/\r?\n/);
  const output = [];
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
function isFenceLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}
function isTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }
  const first = lines[index];
  const second = lines[index + 1];
  return looksLikeTableRow(first) && isDelimiterRow(second);
}
function looksLikeTableRow(line) {
  const trimmed = stripBlockquotePrefix(line).trim();
  return trimmed.includes("|") && trimmed.length > 0;
}
function isDelimiterRow(line) {
  const cells = splitRow(line);
  if (cells.length === 0) {
    return false;
  }
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}
function splitRow(line) {
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
function getBlockquotePrefix(line) {
  const match = line.match(/^\s*(?:>\s*)+/);
  return match ? match[0] : "";
}
function stripBlockquotePrefix(line) {
  const prefix = getBlockquotePrefix(line);
  if (!prefix) {
    return line;
  }
  return line.slice(prefix.length);
}
function parseRowLayout(line) {
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
  const cells = [];
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
function parseTable(lines) {
  const rows = lines.map(splitRow);
  return {
    rows
  };
}
function formatTableBlock(lines, settings, prefix) {
  const parsed = parseTable(lines);
  const columnCount = Math.max(...parsed.rows.map((row) => row.length));
  const normalizedRows = parsed.rows.map((row) => {
    const cloned = row.slice();
    while (cloned.length < columnCount) {
      cloned.push("");
    }
    return cloned;
  });
  const contentWidths = new Array(columnCount).fill(0);
  normalizedRows.forEach((row, rowIndex) => {
    if (rowIndex === 1) {
      return;
    }
    row.forEach((cell, colIndex) => {
      contentWidths[colIndex] = Math.max(contentWidths[colIndex], cell.length);
    });
  });
  const originalDelimiterCells = normalizedRows[1] ?? [];
  const delimiterRow = new Array(columnCount).fill("").map((_, colIndex) => {
    const dashCount = settings.dashCount ?? Math.max(3, contentWidths[colIndex]);
    const alignment = detectColumnAlignment(originalDelimiterCells[colIndex] ?? "");
    return buildDelimiterCell(dashCount, alignment);
  });
  const formattedRows = [];
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
function detectColumnAlignment(cell) {
  const trimmed = cell.trim();
  const hasLeadingColon = trimmed.startsWith(":");
  const hasTrailingColon = trimmed.endsWith(":");
  if (hasLeadingColon && hasTrailingColon) {
    return "center";
  }
  if (hasLeadingColon) {
    return "left";
  }
  if (hasTrailingColon) {
    return "right";
  }
  return "none";
}
function buildDelimiterCell(dashCount, alignment) {
  const dashes = "-".repeat(Math.max(1, dashCount));
  const leadingColon = alignment === "left" || alignment === "center" ? ":" : "";
  const trailingColon = alignment === "right" || alignment === "center" ? ":" : "";
  return `${leadingColon}${dashes}${trailingColon}`;
}
function formatRow(row, paddingSpaces, isDelimiter) {
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

// main.ts
var TableFormatterPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.processingFiles = /* @__PURE__ */ new Set();
    this.toggleRibbonEl = null;
    this.toggleStatusBarEl = null;
  }
  async onload() {
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
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
        return;
      }
      const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (!activeView || activeView.file?.path !== file.path) {
        return;
      }
      if (activeView.getMode() !== "source") {
        return;
      }
      if (!this.settings.editingAssistEnabled) {
        return;
      }
      if (this.isLivePreviewView(activeView)) {
        return;
      }
      void this.handleModify(file);
    }));
  }
  onunload() {
    this.processingFiles.clear();
  }
  async handleModify(file) {
    if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
      return;
    }
    await this.formatFile(file);
  }
  async formatActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!(activeFile instanceof import_obsidian.TFile) || activeFile.extension !== "md") {
      new import_obsidian.Notice("No active Markdown file.");
      return;
    }
    const changed = await this.formatFile(activeFile);
    if (changed) {
      new import_obsidian.Notice("Tables formatted in active file.");
      return;
    }
    new import_obsidian.Notice("No table changes were needed.");
  }
  promptFormatAllFiles() {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new import_obsidian.Notice("No Markdown files to format.");
      return;
    }
    new ConfirmFormatAllModal(this.app, files.length, () => {
      void this.formatAllFiles();
    }).open();
  }
  async formatAllFiles() {
    const files = this.app.vault.getMarkdownFiles();
    if (files.length === 0) {
      new import_obsidian.Notice("No Markdown files to format.");
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
    new import_obsidian.Notice(failed > 0 ? `${base} ${failed} could not be processed.` : base);
  }
  async formatFile(file) {
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
      new import_obsidian.Notice("Table formatting failed. Check console for details.");
      return false;
    } finally {
      this.processingFiles.delete(file.path);
    }
    return true;
  }
  getActiveEditingView(file) {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!activeView || activeView.file?.path !== file.path || activeView.getMode() !== "source") {
      return null;
    }
    return activeView;
  }
  isLivePreviewView(view) {
    const editorWithCodeMirror = view.editor;
    const readStateField = editorWithCodeMirror.cm?.state?.field;
    if (typeof readStateField !== "function") {
      return false;
    }
    try {
      return readStateField(import_obsidian.livePreviewState, false) !== void 0;
    } catch {
      return false;
    }
  }
  captureEditorState(view) {
    const editor = view.editor;
    return {
      selections: editor.listSelections().map((selection) => ({
        anchor: selection.anchor,
        head: selection.head
      })),
      scroll: editor.getScrollInfo()
    };
  }
  async restoreEditorState(view, state, sourceContent, formattedContent) {
    await this.waitForEditorFlush();
    if (view.file?.path === void 0 || view.getMode() !== "source") {
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
  async waitForEditorFlush() {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  selectionsMatch(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((selection, index) => {
      const target = right[index];
      return selection.anchor.line === target.anchor.line && selection.anchor.ch === target.anchor.ch && selection.head.line === target.head.line && selection.head.ch === target.head.ch;
    });
  }
  mapEditorPosition(sourceContent, formattedContent, position) {
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
  clampCursorPosition(mappedCh, lineLength) {
    if (lineLength <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(mappedCh, lineLength));
  }
  mapTableRowCh(sourceLine, formattedLine, sourceCh) {
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
  normalizeTableLine(line) {
    const prefixLength = getBlockquotePrefix(line).length;
    const withoutPrefix = line.slice(prefixLength);
    const trimStartLength = withoutPrefix.length - withoutPrefix.trimStart().length;
    return {
      text: withoutPrefix.trim(),
      rawOffset: prefixLength + trimStartLength
    };
  }
  async loadSettings() {
    const data = await this.loadData();
    const loaded = data ?? {};
    const paddingSpaces = Number.isInteger(loaded.paddingSpaces) && loaded.paddingSpaces >= 0 ? loaded.paddingSpaces : null;
    const dashCount = Number.isInteger(loaded.dashCount) && loaded.dashCount >= 1 ? loaded.dashCount : null;
    const editingAssistEnabled = typeof loaded.editingAssistEnabled === "boolean" ? loaded.editingAssistEnabled : DEFAULT_SETTINGS.editingAssistEnabled;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      paddingSpaces,
      dashCount,
      editingAssistEnabled
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  refreshToggleRibbonButton() {
    const enabled = this.settings.editingAssistEnabled;
    const label = enabled ? "Disable auto-format and focus control while editing" : "Enable auto-format and focus control while editing";
    if (this.toggleRibbonEl) {
      this.toggleRibbonEl.setAttribute("aria-label", label);
      this.toggleRibbonEl.classList.toggle("is-active", enabled);
    }
    if (this.toggleStatusBarEl) {
      this.toggleStatusBarEl.setAttribute("aria-label", label);
      this.toggleStatusBarEl.setText(`Table Formatter: ${enabled ? "ON" : "OFF"}`);
    }
  }
  async toggleEditingAssist() {
    this.settings.editingAssistEnabled = !this.settings.editingAssistEnabled;
    await this.saveSettings();
    this.refreshToggleRibbonButton();
    new import_obsidian.Notice(this.settings.editingAssistEnabled ? "Auto-format and focus control enabled while editing." : "Auto-format and focus control disabled while editing.");
  }
};
var TableFormatterSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    try {
      const { containerEl } = this;
      containerEl.empty();
      new import_obsidian.Setting(containerEl).setName("Padding spaces").setDesc("Set the number of spaces around each cell. Leave blank for auto (single space).").addText((text) => {
        text.setPlaceholder("blank or 0+").setValue(this.plugin.settings.paddingSpaces === null ? "" : String(this.plugin.settings.paddingSpaces)).onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            this.plugin.settings.paddingSpaces = null;
            await this.plugin.saveSettings();
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isInteger(parsed) || parsed < 0) {
            new import_obsidian.Notice("Padding spaces must be an integer >= 0 or blank.");
            text.setValue(this.plugin.settings.paddingSpaces === null ? "" : String(this.plugin.settings.paddingSpaces));
            return;
          }
          this.plugin.settings.paddingSpaces = parsed;
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian.Setting(containerEl).setName("Table border dash count").setDesc("Number of hyphens for each delimiter cell in the table separator row. Leave blank for auto.").addText((text) => {
        text.setPlaceholder("blank or 1+").setValue(this.plugin.settings.dashCount === null ? "" : String(this.plugin.settings.dashCount)).onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            this.plugin.settings.dashCount = null;
            await this.plugin.saveSettings();
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isInteger(parsed) || parsed < 1) {
            new import_obsidian.Notice("Dash count must be an integer >= 1 or blank.");
            text.setValue(this.plugin.settings.dashCount === null ? "" : String(this.plugin.settings.dashCount));
            return;
          }
          this.plugin.settings.dashCount = parsed;
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian.Setting(containerEl).setName("Enable auto-format and focus control while editing").setDesc("Controls modify-triggered table formatting and focus/selection restoration in Source mode.").addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.editingAssistEnabled).onChange(async (value) => {
          this.plugin.settings.editingAssistEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.refreshToggleRibbonButton();
        });
      });
    } catch (error) {
      console.error("Error displaying settings:", error);
    }
  }
};
var ConfirmFormatAllModal = class extends import_obsidian.Modal {
  constructor(app, fileCount, onConfirm) {
    super(app);
    this.fileCount = fileCount;
    this.onConfirm = onConfirm;
  }
  onOpen() {
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
  onClose() {
    this.contentEl.empty();
  }
};
