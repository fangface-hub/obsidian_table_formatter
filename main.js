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
  editingAssistEnabled: true,
  modifyFormatDelaySeconds: 3
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
function isEscapedPipe(text, index) {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}
function splitRowIntoParts(text) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "|" && !isEscapedPipe(text, i)) {
      parts.push({
        text: text.slice(start, i),
        start,
        end: i
      });
      start = i + 1;
    }
  }
  parts.push({
    text: text.slice(start),
    start,
    end: text.length
  });
  return parts;
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
  return splitRowIntoParts(text).map((cell) => cell.text.trim());
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
  const parts = splitRowIntoParts(body);
  const cells = [];
  parts.forEach((part) => {
    const leadingSpaces = part.text.length - part.text.trimStart().length;
    const content = part.text.trim();
    const contentStart = part.start + leadingSpaces;
    const start = part.start;
    const end = part.end;
    cells.push({
      start,
      end,
      contentStart,
      contentLength: content.length
    });
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
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
var TableFormatterPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.processingFiles = /* @__PURE__ */ new Set();
    this.modifyFormatTimers = /* @__PURE__ */ new Map();
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
      this.scheduleModifyFormat(file);
    }));
  }
  onunload() {
    for (const timer of this.modifyFormatTimers.values()) {
      window.clearTimeout(timer);
    }
    this.modifyFormatTimers.clear();
    this.processingFiles.clear();
  }
  scheduleModifyFormat(file) {
    const pending = this.modifyFormatTimers.get(file.path);
    if (pending !== void 0) {
      window.clearTimeout(pending);
    }
    const timer = window.setTimeout(() => {
      this.modifyFormatTimers.delete(file.path);
      void this.formatAfterModify(file);
    }, this.settings.modifyFormatDelaySeconds * 1e3);
    this.modifyFormatTimers.set(file.path, timer);
  }
  // Guards run when the debounce fires, not when the modify event arrives,
  // so a mode switch or toggle change during the delay is respected.
  async formatAfterModify(file) {
    if (!this.settings.editingAssistEnabled) {
      return;
    }
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!activeView || activeView.file?.path !== file.path) {
      return;
    }
    if (activeView.getMode() !== "source") {
      return;
    }
    await this.handleModify(file);
  }
  async handleModify(file) {
    if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") {
      return;
    }
    await this.formatFile(file, true);
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
  async formatFile(file, protectSelections = false) {
    if (this.processingFiles.has(file.path)) {
      return false;
    }
    try {
      this.processingFiles.add(file.path);
      const activeEditingView = this.getActiveEditingView(file);
      if (activeEditingView) {
        return this.formatThroughEditor(activeEditingView, protectSelections);
      }
      const content = await this.app.vault.cachedRead(file);
      const formatted = formatMarkdownTables(content, this.settings);
      if (formatted === content) {
        return false;
      }
      await this.app.vault.process(file, () => formatted);
    } catch (error) {
      console.error("table-formatter-on-save: failed to format table", error);
      new import_obsidian.Notice("Table formatting failed. Check console for details.");
      return false;
    } finally {
      this.processingFiles.delete(file.path);
    }
    return true;
  }
  formatThroughEditor(view, protectSelections) {
    const editor = view.editor;
    const content = editor.getValue();
    const formatted = formatMarkdownTables(content, this.settings);
    if (formatted === content) {
      return false;
    }
    const sourceLines = content.split("\n");
    const formattedLines = formatted.split("\n");
    if (sourceLines.length !== formattedLines.length) {
      editor.setValue(formatted);
      return true;
    }
    const selections = editor.listSelections().map((selection) => ({
      anchor: selection.anchor,
      head: selection.head
    }));
    const scroll = editor.getScrollInfo();
    const protectedLines = protectSelections ? this.tableLinesTouchedBySelections(selections, sourceLines) : /* @__PURE__ */ new Set();
    const changes = [];
    let deferred = false;
    for (let line = 0; line < sourceLines.length; line += 1) {
      if (sourceLines[line] === formattedLines[line]) {
        continue;
      }
      if (protectedLines.has(line)) {
        deferred = true;
        continue;
      }
      changes.push({
        from: { line, ch: 0 },
        to: { line, ch: sourceLines[line].length },
        text: formattedLines[line]
      });
    }
    if (changes.length > 0) {
      editor.transaction({ changes });
      if (protectSelections) {
        editor.scrollTo(scroll.left, scroll.top);
      } else {
        editor.setSelections(selections.map((selection) => ({
          anchor: this.mapEditorPosition(content, formatted, selection.anchor),
          head: this.mapEditorPosition(content, formatted, selection.head)
        })), 0);
        editor.scrollTo(scroll.left, scroll.top);
      }
    }
    if (deferred && view.file) {
      this.scheduleModifyFormat(view.file);
    }
    return changes.length > 0;
  }
  // Returns the indexes of all lines belonging to a table block that a
  // selection touches. Blocks are found by expanding from the selection
  // over contiguous table-looking lines.
  tableLinesTouchedBySelections(selections, sourceLines) {
    const protectedLines = /* @__PURE__ */ new Set();
    for (const selection of selections) {
      const first = Math.min(selection.anchor.line, selection.head.line);
      const last = Math.max(selection.anchor.line, selection.head.line);
      let start = first;
      if (looksLikeTableRow(sourceLines[start] ?? "")) {
        while (start > 0 && looksLikeTableRow(sourceLines[start - 1])) {
          start -= 1;
        }
      }
      let end = last;
      if (looksLikeTableRow(sourceLines[end] ?? "")) {
        while (end + 1 < sourceLines.length && looksLikeTableRow(sourceLines[end + 1])) {
          end += 1;
        }
      }
      for (let line = start; line <= end; line += 1) {
        protectedLines.add(line);
      }
    }
    return protectedLines;
  }
  getActiveEditingView(file) {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!activeView || activeView.file?.path !== file.path || activeView.getMode() !== "source") {
      return null;
    }
    return activeView;
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
    const loaded = isRecord(data) ? data : {};
    const paddingSpaces = Number.isInteger(loaded.paddingSpaces) && loaded.paddingSpaces >= 0 ? loaded.paddingSpaces : null;
    const dashCount = Number.isInteger(loaded.dashCount) && loaded.dashCount >= 1 ? loaded.dashCount : null;
    const editingAssistEnabled = typeof loaded.editingAssistEnabled === "boolean" ? loaded.editingAssistEnabled : DEFAULT_SETTINGS.editingAssistEnabled;
    const modifyFormatDelaySeconds = Number.isInteger(loaded.modifyFormatDelaySeconds) && loaded.modifyFormatDelaySeconds >= 1 ? loaded.modifyFormatDelaySeconds : DEFAULT_SETTINGS.modifyFormatDelaySeconds;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      paddingSpaces,
      dashCount,
      editingAssistEnabled,
      modifyFormatDelaySeconds
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
      new import_obsidian.Setting(containerEl).setName("Auto-format delay").setDesc("Seconds to wait after the last change before tables are auto-formatted. Longer values interfere less while typing.").addText((text) => {
        text.setPlaceholder(String(DEFAULT_SETTINGS.modifyFormatDelaySeconds)).setValue(String(this.plugin.settings.modifyFormatDelaySeconds)).onChange(async (value) => {
          const trimmed = value.trim();
          if (trimmed === "") {
            this.plugin.settings.modifyFormatDelaySeconds = DEFAULT_SETTINGS.modifyFormatDelaySeconds;
            await this.plugin.saveSettings();
            return;
          }
          const parsed = Number(trimmed);
          if (!Number.isInteger(parsed) || parsed < 1) {
            new import_obsidian.Notice("Auto-format delay must be an integer >= 1 or blank.");
            text.setValue(String(this.plugin.settings.modifyFormatDelaySeconds));
            return;
          }
          this.plugin.settings.modifyFormatDelaySeconds = parsed;
          await this.plugin.saveSettings();
        });
      });
      new import_obsidian.Setting(containerEl).setName("Enable auto-format and focus control while editing").setDesc("Controls modify-triggered table formatting while editing in Live Preview or Source mode.").addToggle((toggle) => {
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
