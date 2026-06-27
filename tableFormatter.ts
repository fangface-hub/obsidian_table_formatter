export interface TableFormatterSettings {
  paddingSpaces: number | null;
  dashCount: number | null;
  editingAssistEnabled: boolean;
}

export const DEFAULT_SETTINGS: TableFormatterSettings = {
  paddingSpaces: null,
  dashCount: null,
  editingAssistEnabled: true
};

export type ColumnAlignment = "none" | "left" | "right" | "center";

type ParsedTable = {
  rows: string[][];
};

export type RowLayoutCell = {
  start: number;
  end: number;
  contentStart: number;
  contentLength: number;
};

export type RowLayout = {
  cells: RowLayoutCell[];
};

export function formatMarkdownTables(content: string, settings: TableFormatterSettings): string {
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

export function looksLikeTableRow(line: string): boolean {
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

export function getBlockquotePrefix(line: string): string {
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

export function parseRowLayout(line: string): RowLayout | null {
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

  const originalDelimiterCells = normalizedRows[1] ?? [];
  const delimiterRow = new Array<string>(columnCount).fill("").map((_, colIndex) => {
    const dashCount = settings.dashCount ?? Math.max(3, contentWidths[colIndex]);
    const alignment = detectColumnAlignment(originalDelimiterCells[colIndex] ?? "");
    return buildDelimiterCell(dashCount, alignment);
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

export function detectColumnAlignment(cell: string): ColumnAlignment {
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

function buildDelimiterCell(dashCount: number, alignment: ColumnAlignment): string {
  const dashes = "-".repeat(Math.max(1, dashCount));
  const leadingColon = alignment === "left" || alignment === "center" ? ":" : "";
  const trailingColon = alignment === "right" || alignment === "center" ? ":" : "";

  return `${leadingColon}${dashes}${trailingColon}`;
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
