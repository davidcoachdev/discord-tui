import { expect, test } from "bun:test";

import { parseMarkdown, plainText } from "../../src/markdown/parse";

test("bold, italic, underline, strike, spoiler", () => {
  expect(parseMarkdown("**a** *b* __c__ ~~d~~ ||e||").filter((n) => n.type !== "text").map((n) => n.type)).toEqual([
    "bold",
    "italic",
    "underline",
    "strike",
    "spoiler",
  ]);
});

test("underscore italic and bold italic", () => {
  expect(parseMarkdown("_a_")).toEqual([{ type: "italic", children: [{ type: "text", text: "a" }] }]);
  expect(parseMarkdown("***x***")).toEqual([
    { type: "bold", children: [{ type: "italic", children: [{ type: "text", text: "x" }] }] },
  ]);
});

test("snake_case words are not italic", () => {
  expect(parseMarkdown("mi_var_x")).toEqual([{ type: "text", text: "mi_var_x" }]);
});

test("nested markup inside bold", () => {
  expect(parseMarkdown("**a ~~b~~ c**")).toEqual([
    {
      type: "bold",
      children: [
        { type: "text", text: "a " },
        { type: "strike", children: [{ type: "text", text: "b" }] },
        { type: "text", text: " c" },
      ],
    },
  ]);
});

test("inline code and code blocks do not parse markup inside", () => {
  expect(parseMarkdown("`**x**`")).toEqual([{ type: "code", text: "**x**" }]);
  expect(parseMarkdown("``a ` b``")).toEqual([{ type: "code", text: "a ` b" }]);
  expect(parseMarkdown("```ts\nconst a = 1\n```")).toEqual([{ type: "codeblock", lang: "ts", text: "const a = 1" }]);
  expect(parseMarkdown("```\n**x**\n```")).toEqual([{ type: "codeblock", lang: null, text: "**x**" }]);
});

test("mentions, custom emoji and timestamps", () => {
  expect(parseMarkdown("<@1> <#2> <@&3> <:kek:4> <a:dance:5> <t:1700000000:R>").filter((n) => n.type !== "text")).toEqual([
    { type: "mention", kind: "user", id: "1" },
    { type: "mention", kind: "channel", id: "2" },
    { type: "mention", kind: "role", id: "3" },
    { type: "emoji", name: "kek", id: "4", animated: false },
    { type: "emoji", name: "dance", id: "5", animated: true },
    { type: "timestamp", unix: 1700000000, style: "R" },
  ]);
});

test("nick mentions, everyone, here and plain timestamps", () => {
  expect(parseMarkdown("<@!9> @everyone @here <t:5>").filter((n) => n.type !== "text")).toEqual([
    { type: "mention", kind: "user", id: "9" },
    { type: "mention", kind: "everyone", id: null },
    { type: "mention", kind: "here", id: null },
    { type: "timestamp", unix: 5, style: null },
  ]);
});

test("quotes, masked links and escaped markup", () => {
  expect(parseMarkdown("> hola")[0]).toMatchObject({ type: "quote" });
  expect(parseMarkdown("[doc](https://x.dev)")).toEqual([{ type: "link", url: "https://x.dev", label: "doc" }]);
  expect(parseMarkdown("\\*no\\*")).toEqual([{ type: "text", text: "*no*" }]);
});

test("quote lines end at the newline, >>> quotes the rest", () => {
  expect(parseMarkdown("> a\nb")).toEqual([
    { type: "quote", children: [{ type: "text", text: "a" }] },
    { type: "text", text: "\nb" },
  ]);
  expect(parseMarkdown("x\n>>> a\nb")).toEqual([
    { type: "text", text: "x\n" },
    { type: "quote", children: [{ type: "text", text: "a\nb" }] },
  ]);
});

test("bare urls become links", () => {
  expect(parseMarkdown("mirá https://x.dev/a?b=1.")).toEqual([
    { type: "text", text: "mirá " },
    { type: "link", url: "https://x.dev/a?b=1", label: null },
    { type: "text", text: "." },
  ]);
});

test("unclosed markers stay as text", () => {
  expect(parseMarkdown("**abierto")).toEqual([{ type: "text", text: "**abierto" }]);
  expect(parseMarkdown("`abierto")).toEqual([{ type: "text", text: "`abierto" }]);
  expect(parseMarkdown("<@abc>")).toEqual([{ type: "text", text: "<@abc>" }]);
});

test("newlines stay inside text nodes", () => {
  expect(parseMarkdown("a\nb")).toEqual([{ type: "text", text: "a\nb" }]);
});

test("never throws on random input", () => {
  const alphabet = "*_~|`<>@#&:!t[]()\\\n ahttps:/0123456789";
  for (let round = 0; round < 2000; round += 1) {
    let src = "";
    const length = Math.floor(Math.random() * 60);
    for (let i = 0; i < length; i += 1) src += alphabet[Math.floor(Math.random() * alphabet.length)];
    expect(() => plainText(parseMarkdown(src))).not.toThrow();
  }
});

test("plainText resolves mentions and flattens markup", () => {
  const nodes = parseMarkdown("**hola** <@1> <#2> <@&3> <@4> <:kek:5> [doc](https://x.dev) https://y.dev");
  expect(plainText(nodes, { user: (id) => (id === "1" ? "gon" : undefined as unknown as string), channel: () => "general", role: () => "mods" })).toBe(
    "hola @gon #general @mods @usuario :kek: doc https://y.dev",
  );
  expect(plainText(parseMarkdown("<@1> <#2> <@&3>"))).toBe("@usuario #canal @rol");
});

test("plainText formats timestamps", () => {
  const unix = Math.floor(Date.now() / 1000) - 120;
  expect(plainText(parseMarkdown(`<t:${unix}:R>`))).toBe("hace 2 min");
  expect(plainText(parseMarkdown("<t:1700000000>"))).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
});
