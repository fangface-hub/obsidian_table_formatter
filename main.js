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
var DEFAULT_SETTINGS = {
  paddingSpaces: null,
  dashCount: null
};
var TableFormatterPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
    this.processingFiles = /* @__PURE__ */ new Set();
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new TableFormatterSettingTab(this.app, this));
    this.addCommand({
      id: "format-active-markdown-tables",
      name: "Format tables in active file",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!(activeFile instanceof import_obsidian.TFile) || activeFile.extension !== "md") {
          new import_obsidian.Notice("No active Markdown file.");
          return;
        }
        const changed = await this.formatFile(activeFile, false);
        if (changed) {
          new import_obsidian.Notice("Tables formatted in active file.");
          return;
        }
        new import_obsidian.Notice("No table changes were needed.");
      }
    });
    this.registerEvent(this.app.vault.on("modify", (file) => {
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
    await this.formatFile(file, true);
  }
  async formatFile(file, skipIfEditing) {
    if (this.processingFiles.has(file.path)) {
      return false;
    }
    const activeEditingView = this.getActiveEditingView(file);
    if (skipIfEditing && activeEditingView?.editor.hasFocus()) {
      return false;
    }
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
  restoreEditorState(view, state, sourceContent, formattedContent) {
    const editor = view.editor;
    const mappedSelections = state.selections.map((selection) => ({
      anchor: this.mapEditorPosition(sourceContent, formattedContent, selection.anchor),
      head: this.mapEditorPosition(sourceContent, formattedContent, selection.head)
    }));
    editor.focus();
    editor.setSelections(mappedSelections, 0);
    editor.scrollTo(state.scroll.left, state.scroll.top);
  }
  mapEditorPosition(sourceContent, formattedContent, position) {
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
  mapTableRowCh(sourceLine, formattedLine, sourceCh) {
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
  async loadSettings() {
    const data = await this.loadData();
    const loaded = data ?? {};
    const paddingSpaces = Number.isInteger(loaded.paddingSpaces) && loaded.paddingSpaces >= 0 ? loaded.paddingSpaces : null;
    const dashCount = Number.isInteger(loaded.dashCount) && loaded.dashCount >= 1 ? loaded.dashCount : null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      paddingSpaces,
      dashCount
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var TableFormatterSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
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
  }
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
    let end = i + 1;
    while (end + 1 < lines.length && looksLikeTableRow(lines[end + 1])) {
      end += 1;
    }
    const blockLines = lines.slice(start, end + 1);
    const formatted = formatTableBlock(blockLines, settings);
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
  const trimmed = line.trim();
  return trimmed.includes("|") && !trimmed.startsWith(">") && trimmed.length > 0;
}
function isDelimiterRow(line) {
  const cells = splitRow(line);
  if (cells.length === 0) {
    return false;
  }
  return cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()));
}
function splitRow(line) {
  const trimmed = line.trim();
  let text = trimmed;
  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|")) {
    text = text.slice(0, -1);
  }
  return text.split("|").map((cell) => cell.trim());
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
function formatTableBlock(lines, settings) {
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
  const delimiterRow = new Array(columnCount).fill("").map((_, colIndex) => {
    const dashCount = settings.dashCount ?? Math.max(3, contentWidths[colIndex]);
    return buildDelimiterCell(dashCount);
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
  return formattedRows;
}
function buildDelimiterCell(dashCount) {
  const dashes = "-".repeat(Math.max(1, dashCount));
  return dashes;
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
