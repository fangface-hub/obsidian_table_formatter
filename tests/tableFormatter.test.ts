import { strict as assert } from "node:assert";
import { test } from "node:test";

import { formatMarkdownTables, TableFormatterSettings } from "../tableFormatter";

const AUTO: TableFormatterSettings = {
  paddingSpaces: null,
  dashCount: null
};

function format(input: string, settings: TableFormatterSettings = AUTO): string {
  return formatMarkdownTables(input, settings);
}

test("left alignment is preserved", () => {
  const input = ["| H |", "| :- |", "| x |"].join("\n");
  const expected = ["| H |", "| :--- |", "| x |"].join("\n");
  assert.equal(format(input), expected);
});

test("right alignment is preserved", () => {
  const input = ["| H |", "| -------: |", "| x |"].join("\n");
  const expected = ["| H |", "| ---: |", "| x |"].join("\n");
  assert.equal(format(input), expected);
});

test("center alignment is preserved", () => {
  const input = ["| H |", "| :-: |", "| x |"].join("\n");
  const expected = ["| H |", "| :---: |", "| x |"].join("\n");
  assert.equal(format(input), expected);
});

test("mixed alignments in the same row are preserved independently", () => {
  const input = ["| A | B | C |", "| :- | -------: | :-: |", "| a | b | c |"].join("\n");
  const expected = ["| A | B | C |", "| :--- | ---: | :---: |", "| a | b | c |"].join("\n");
  assert.equal(format(input), expected);
});

test("no alignment markers in input means no markers in output", () => {
  const input = ["| A | B |", "| - | --------- |", "| a | b |"].join("\n");
  const expected = ["| A | B |", "| --- | --- |", "| a | b |"].join("\n");
  assert.equal(format(input), expected);
});

test("extra columns added during formatting default to no alignment", () => {
  const input = ["| A | B |", "| :- | -: |", "| a | b | c |"].join("\n");
  const expected = ["| A | B |  |", "| :--- | ---: | --- |", "| a | b | c |"].join("\n");
  assert.equal(format(input), expected);
});

test("dash count sets the number of hyphens and colons are added on top", () => {
  const settings: TableFormatterSettings = { paddingSpaces: null, dashCount: 5 };
  const input = ["| A | B | C |", "| :--- | ---: | :---: |", "| a | b | c |"].join("\n");
  const expected = ["| A | B | C |", "| :----- | -----: | :-----: |", "| a | b | c |"].join("\n");
  assert.equal(format(input, settings), expected);
});
