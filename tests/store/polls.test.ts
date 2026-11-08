import { expect, test } from "bun:test";

import { toMessage } from "../../src/store/reducers/messages";
import { buildPollView, nextPollVote } from "../../src/store/reducers/polls";
import { reduce } from "../../src/store/reduce";
import { emptyState } from "../../src/store/store";
import type { ApiPoll, AppState } from "../../src/store/types";

const CH = "100000000000000002";
const MSG = "100000000000000100";
const ME = "100000000000000010";
const OTHER = "100000000000000011";
const NOW = Date.parse("2026-11-07T12:00:00Z");

function poll(extra: Partial<ApiPoll> = {}): ApiPoll {
  return {
    question: { text: "¿Pizza o empanadas?" },
    answers: [
      { answer_id: 1, poll_media: { text: "Pizza", emoji: { id: null, name: "🍕" } } },
      { answer_id: 2, poll_media: { text: "Empanadas", emoji: { id: "100000000000000500", name: "empa" } } },
      { answer_id: 3, poll_media: { text: "Las dos" } },
    ],
    expiry: "2026-11-07T15:00:00Z",
    allow_multiselect: false,
    results: {
      is_finalized: false,
      answer_counts: [
        { id: 1, count: 3, me_voted: false },
        { id: 2, count: 1, me_voted: true },
      ],
    },
    ...extra,
  };
}

function stateWith(p: ApiPoll | undefined, extra: Record<string, unknown> = {}): AppState {
  let s: AppState = { ...emptyState(), me: { id: ME, username: "user1" } };
  s = reduce(s, {
    type: "gw",
    t: "MESSAGE_CREATE",
    d: { id: MSG, channel_id: CH, author: { id: OTHER }, content: "", ...(p ? { poll: p } : {}), ...extra },
  });
  return s;
}

const rawPoll = (s: ReturnType<typeof stateWith>): ApiPoll => (s.messages[CH]!.byId[MSG] as any).poll;

test("poll view: counts, percent, my vote, emoji and total; missing answers count as 0", () => {
  const view = buildPollView(poll(), NOW);
  expect(view.question).toBe("¿Pizza o empanadas?");
  expect(view.total).toBe(4);
  expect(view.answers.map((a) => [a.id, a.emoji, a.text, a.count, a.percent, a.meVoted])).toEqual([
    [1, "🍕", "Pizza", 3, 75, false],
    [2, ":empa:", "Empanadas", 1, 25, true],
    [3, null, "Las dos", 0, 0, false],
  ]);
  expect(view.ended).toBe(false);
});

test("poll view: no results means zero votes and 0 %; expired or finalized means ended", () => {
  const empty = buildPollView(poll({ results: undefined }), NOW);
  expect(empty.total).toBe(0);
  expect(empty.answers.every((a) => a.percent === 0 && a.count === 0)).toBe(true);
  expect(buildPollView(poll({ expiry: "2026-11-07T11:59:00Z" }), NOW).ended).toBe(true);
  expect(buildPollView(poll({ results: { is_finalized: true, answer_counts: [] } }), NOW).ended).toBe(true);
});

test("next vote: single replaces, repeating removes; multiselect toggles", () => {
  const single = buildPollView(poll(), NOW);
  expect(nextPollVote(single, 1)).toEqual([1]);
  expect(nextPollVote(single, 2)).toEqual([]);

  const multi = buildPollView(
    poll({ allow_multiselect: true, results: { is_finalized: false, answer_counts: [{ id: 1, count: 1, me_voted: true }, { id: 3, count: 1, me_voted: true }] } }),
    NOW,
  );
  expect(nextPollVote(multi, 2)).toEqual([1, 2, 3]);
  expect(nextPollVote(multi, 3)).toEqual([1]);
});

test("MESSAGE_POLL_VOTE_ADD / REMOVE update counts; me_voted only follows my own votes", () => {
  let s = stateWith(poll());
  const vote = (t: string, user: string, answer: number) =>
    (s = reduce(s, { type: "gw", t, d: { user_id: user, channel_id: CH, message_id: MSG, guild_id: "100000000000000001", answer_id: answer } }));

  vote("MESSAGE_POLL_VOTE_ADD", OTHER, 3);
  vote("MESSAGE_POLL_VOTE_ADD", ME, 1);
  vote("MESSAGE_POLL_VOTE_REMOVE", ME, 2);
  vote("MESSAGE_POLL_VOTE_REMOVE", OTHER, 1);
  const view = buildPollView(rawPoll(s), NOW);
  expect(view.answers.map((a) => [a.id, a.count, a.meVoted])).toEqual([
    [1, 3, true],
    [2, 0, false],
    [3, 1, false],
  ]);
  expect(view.total).toBe(4);
  expect(toMessage(s, s.messages[CH]!.byId[MSG]!).poll).toBe(rawPoll(s));
});

test("vote events: multiselect keeps several of mine; counts never go below 0; unknown messages are ignored", () => {
  let s = stateWith(poll({ allow_multiselect: true, results: undefined }));
  for (const answer of [1, 2]) {
    s = reduce(s, { type: "gw", t: "MESSAGE_POLL_VOTE_ADD", d: { user_id: ME, channel_id: CH, message_id: MSG, answer_id: answer } });
  }
  s = reduce(s, { type: "gw", t: "MESSAGE_POLL_VOTE_REMOVE", d: { user_id: OTHER, channel_id: CH, message_id: MSG, answer_id: 3 } });
  const view = buildPollView(rawPoll(s), NOW);
  expect(view.answers.filter((a) => a.meVoted).map((a) => a.id)).toEqual([1, 2]);
  expect(view.answers.find((a) => a.id === 3)!.count).toBe(0);

  const before = s;
  s = reduce(s, { type: "gw", t: "MESSAGE_POLL_VOTE_ADD", d: { user_id: ME, channel_id: CH, message_id: "100000000000000999", answer_id: 1 } });
  expect(s).toBe(before);
});

test("MESSAGE_UPDATE keeps poll and stickers; new results replace, missing results keep the old ones", () => {
  let s = stateWith(poll(), { sticker_items: [{ id: "100000000000000700", name: "wave", format_type: 1 }] });
  s = reduce(s, { type: "gw", t: "MESSAGE_UPDATE", d: { id: MSG, channel_id: CH, content: "editado" } });
  let message = toMessage(s, s.messages[CH]!.byId[MSG]!);
  expect(message.poll?.question?.text).toBe("¿Pizza o empanadas?");
  expect(message.stickers).toEqual([{ id: "100000000000000700", name: "wave", formatType: 1 }]);

  s = reduce(s, { type: "gw", t: "MESSAGE_UPDATE", d: { id: MSG, channel_id: CH, poll: { ...poll(), results: undefined } } });
  expect(buildPollView(rawPoll(s), NOW).total).toBe(4);

  s = reduce(s, {
    type: "gw",
    t: "MESSAGE_UPDATE",
    d: { id: MSG, channel_id: CH, poll: poll({ results: { is_finalized: true, answer_counts: [{ id: 3, count: 7, me_voted: false }] } }) },
  });
  const final = buildPollView(rawPoll(s), NOW);
  expect(final.ended).toBe(true);
  expect(final.answers.map((a) => a.count)).toEqual([0, 0, 7]);
  message = toMessage(s, s.messages[CH]!.byId[MSG]!);
  expect(message.stickers).toHaveLength(1);
});

test("messages without poll or stickers get null and []", () => {
  const s = stateWith(undefined);
  const message = toMessage(s, s.messages[CH]!.byId[MSG]!);
  expect(message.poll).toBeNull();
  expect(message.stickers).toEqual([]);
});
