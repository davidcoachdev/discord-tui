import { expect, test } from "bun:test";

import { replaceMentions, serializeComposer } from "../../src/ui/mentions";
import {
  clampCursor,
  lineDown,
  lineEnd,
  lineStart,
  lineUp,
  nextGrapheme,
  prevGrapheme,
  ruboutStart,
  splice,
  wordLeft,
  wordRight,
} from "../../src/ui/text-edit";

test("graphemes: an emoji, a flag and an accent are one step each", () => {
  const text = "a👍🏽b🇦🇷e\u0301";
  // "e" + acento combinado (dos code units) también es un grafema.
  const steps: number[] = [];
  for (let at = 0; at < text.length; at = nextGrapheme(text, at)) steps.push(at);
  expect(steps).toEqual([0, 1, 5, 6, 10]);
  expect(nextGrapheme(text, 10)).toBe(text.length);
  expect(prevGrapheme(text, text.length)).toBe(10);
  expect(prevGrapheme(text, 5)).toBe(1);
  expect(prevGrapheme(text, 0)).toBe(0);
  expect(nextGrapheme(text, text.length)).toBe(text.length);
  expect(clampCursor(text, 3)).toBe(1);
  expect(clampCursor(text, 99)).toBe(text.length);
});

test("splice inserts and deletes at the cursor", () => {
  expect(splice("hola mundo", 4, 4, ",")).toEqual({ text: "hola, mundo", cursor: 5 });
  expect(splice("hola mundo", 4, 10, "")).toEqual({ text: "hola", cursor: 4 });
  expect(splice("ab", 0, 0, "x")).toEqual({ text: "xab", cursor: 1 });
});

test("word motions skip separators and stop at word edges", () => {
  const text = "hola,  mundo 😀 feliz";
  expect(wordLeft(text, text.length)).toBe(16);
  expect(wordLeft(text, 16)).toBe(7);
  expect(wordLeft(text, 7)).toBe(0);
  expect(wordLeft(text, 0)).toBe(0);
  expect(wordRight(text, 0)).toBe(4);
  expect(wordRight(text, 4)).toBe(12);
  expect(wordRight(text, 12)).toBe(text.length);
  expect(wordLeft("canción ñandú", 13)).toBe(8);
});

test("rubout (Ctrl-w) deletes the previous whitespace-delimited word", () => {
  expect(ruboutStart("hola mundo  ", 12)).toBe(5);
  expect(ruboutStart("hola mundo", 4)).toBe(0);
  expect(ruboutStart("a b.c", 5)).toBe(2);
  expect(ruboutStart("", 0)).toBe(0);
});

test("line start/end and up/down keep the column", () => {
  const text = "primera\nab\ntercera línea";
  expect(lineStart(text, 3)).toBe(0);
  expect(lineEnd(text, 3)).toBe(7);
  expect(lineStart(text, 9)).toBe(8);
  expect(lineEnd(text, 9)).toBe(10);
  expect(lineStart(text, 8)).toBe(8);
  expect(lineEnd(text, text.length)).toBe(text.length);
  // columna 5 de la primera → la segunda tiene 2, queda al final; ↓ otra vez vuelve a la columna 2.
  expect(lineDown(text, 5)).toBe(10);
  expect(lineDown(text, 10)).toBe(13);
  expect(lineUp(text, 13)).toBe(10);
  expect(lineUp(text, 10)).toBe(2);
  expect(lineUp(text, 2)).toBe(0);
  expect(lineDown(text, 13)).toBe(text.length);
});

test("up/down count columns in graphemes", () => {
  const text = "😀😀x\nabc";
  expect(lineDown(text, 4)).toBe(8); // después de dos emojis = columna 2
  expect(lineUp(text, 8)).toBe(4);
});

test("replaceMentions shifts later mentions and drops edited ones", () => {
  const mentions = [{ start: 5, end: 9, userId: "7" }];
  // "hola @Gon " → insertar al principio
  expect(replaceMentions(mentions, 0, 0, 2)).toEqual([{ start: 7, end: 11, userId: "7" }]);
  // borrar a través de la mención la descarta
  expect(replaceMentions(mentions, 3, 7, 0)).toEqual([]);
  // reemplazar algo después no la toca
  expect(replaceMentions(mentions, 9, 10, 3)).toEqual(mentions);
  const text = "ya hola @Gon ";
  expect(serializeComposer(text, replaceMentions(mentions, 0, 0, 3))).toBe("ya hola <@7> ");
});
