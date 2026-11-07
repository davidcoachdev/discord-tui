import type { KeyEvent, PasteEvent } from "@opentui/core";
import { useKeyboard, usePaste, useTerminalDimensions, type JSX } from "@opentui/solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

import type { Actions } from "../actions";
import { COMMON_EMOJI } from "../emoji/common";
import { parseMarkdown, plainText } from "../markdown/parse";
import {
  selectChannelList,
  selectMessages,
  selectNextUnread,
  selectVisibleChannelList,
  selectVoiceParticipants,
} from "../store/selectors";
import type { Store } from "../store/store";
import type { PendingAttachment } from "../store/types";
import { readClipboardImage, readClipboardText } from "../uploads/clipboard";
import { readAttachmentFromPath } from "../uploads/file";
import { listAudioDevices } from "../voice/devices";
import { startCapture, startPlayback } from "../voice/audio-io";
import { ChannelList } from "./components/ChannelList";
import { Composer, MentionPopup } from "./components/Composer";
import { GuildList } from "./components/GuildList";
import { HelpOverlay } from "./components/HelpOverlay";
import { MemberList } from "./components/MemberList";
import { MessageView } from "./components/MessageView";
import type { MessageAction } from "./components/MessageItem";
import { Button } from "./components/Button";
import { Notices } from "./components/Notices";
import { QuickSwitcher } from "./components/QuickSwitcher";
import { StatusBar, VoiceBar } from "./components/StatusBar";
import { validateOutgoing } from "./composer-state";
import { displayName, truncate } from "./format";
import { rankSwitcherItems } from "./fuzzy";
import {
  applyPick,
  mentionCandidates,
  mentionQueryAt,
  serializeComposer,
  shiftMentions,
  type PickedMention,
} from "./mentions";
import { SettingsScreen, type SettingsDeps } from "./screens/SettingsScreen";
import { useSelector } from "./store-bridge";
import { useTheme } from "./theme";

function isOpenable(kind: string): boolean {
  return kind === "text" || kind === "dm" || kind === "group_dm";
}

const defaultSettingsDeps: SettingsDeps = { listAudioDevices, startCapture, startPlayback };

export interface AppDeps {
  readClipboardImage: typeof readClipboardImage;
  readClipboardText: typeof readClipboardText;
  readAttachmentFromPath: typeof readAttachmentFromPath;
}

const defaultAppDeps: AppDeps = { readClipboardImage, readClipboardText, readAttachmentFromPath };

export function App(props: {
  store: Store;
  actions: Actions;
  onQuit: () => void;
  settingsDeps?: SettingsDeps;
  deps?: Partial<AppDeps>;
  onActivity?(): void;
  images?: boolean;
}): JSX.Element {
  const deps = (): AppDeps => ({ ...defaultAppDeps, ...props.deps });
  const theme = useTheme(props.store);
  const dims = useTerminalDimensions();
  const focus = useSelector(props.store, (state) => state.ui.focus);
  const membersVisible = useSelector(props.store, (state) => state.ui.membersVisible);
  const inGuild = useSelector(props.store, (state) => {
    const channelId = state.ui.selectedChannelId;
    return channelId !== null && state.channels[channelId]?.guildId != null;
  });
  const inlineImages = useSelector(props.store, (state) => state.settings.inlineImages);
  const textChannel = useSelector(props.store, (state) => {
    const id = state.ui.selectedChannelId;
    const type = id === null ? undefined : state.channels[id]?.type;
    return id !== null && type !== 2 && type !== 4;
  });

  const [insert, setInsert] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);
  const [hint, setHint] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [drafts, setDrafts] = createSignal<Record<string, string>>({});
  const [mentions, setMentions] = createSignal<Record<string, PickedMention[]>>({});
  const [attachments, setAttachments] = createSignal<Record<string, PendingAttachment[]>>({});
  const [attachPrompt, setAttachPrompt] = createSignal<string | null>(null);
  const [mentionIndex, setMentionIndex] = createSignal(0);
  const [mentionClosed, setMentionClosed] = createSignal(false);
  const [lastD, setLastD] = createSignal(0);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerQuery, setPickerQuery] = createSignal("");
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [pendingG, setPendingG] = createSignal(false);
  const [helpOpen, setHelpOpen] = createSignal(false);
  const [switcherOpen, setSwitcherOpen] = createSignal(false);
  const [switcherQuery, setSwitcherQuery] = createSignal("");
  const [switcherIndex, setSwitcherIndex] = createSignal(0);
  const [participant, setParticipant] = createSignal<string | null>(null);

  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  function flash(text: string): void {
    setHint(text);
    if (hintTimer !== null) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => setHint(null), 4_000);
  }
  onCleanup(() => {
    if (hintTimer !== null) clearTimeout(hintTimer);
  });

  const channelId = (): string | null => props.store.getState().ui.selectedChannelId;
  const currentText = (): string => {
    const id = channelId();
    return id === null ? "" : drafts()[id] ?? "";
  };
  const currentMentions = (): PickedMention[] => {
    const id = channelId();
    return id === null ? [] : mentions()[id] ?? [];
  };
  const currentAttachments = (): PendingAttachment[] => {
    const id = channelId();
    return id === null ? [] : attachments()[id] ?? [];
  };
  const isTextChannel = (): boolean => {
    const id = channelId();
    const type = id === null ? undefined : props.store.getState().channels[id]?.type;
    return id !== null && type !== 2 && type !== 4;
  };

  function setText(text: string, picked: PickedMention[] = currentMentions()): void {
    const id = channelId();
    if (id === null) return;
    setDrafts((previous) => ({ ...previous, [id]: text }));
    setMentions((previous) => ({ ...previous, [id]: picked }));
  }

  function insertText(chunk: string): void {
    const id = channelId();
    if (id === null || chunk.length === 0) return;
    const before = currentText();
    setText(before + chunk, shiftMentions(currentMentions(), before.length, chunk.length));
    setMentionClosed(false);
    setMentionIndex(0);
    props.actions.keystroke?.(id, before + chunk);
  }

  function backspace(): void {
    const before = currentText();
    if (before.length === 0) return;
    const cut = [...before].slice(0, -1).join("");
    const removed = before.length - cut.length;
    setText(cut, shiftMentions(currentMentions(), cut.length, -removed));
    setMentionIndex(0);
  }

  function addAttachment(file: PendingAttachment): void {
    const id = channelId();
    if (id === null) return;
    setAttachments((previous) => ({ ...previous, [id]: [...(previous[id] ?? []), file] }));
  }

  const mentionState = () => {
    const id = channelId();
    if (!insert() || id === null || mentionClosed()) return null;
    const text = currentText();
    const query = mentionQueryAt(text, text.length);
    if (query === null) return null;
    const candidates = mentionCandidates(props.store.getState(), id, query.query);
    if (candidates.length === 0) return null;
    return { ...query, candidates };
  };

  function pickMention(index: number = mentionIndex()): boolean {
    const popup = mentionState();
    if (!popup) return false;
    const candidate = popup.candidates[Math.min(index, popup.candidates.length - 1)];
    if (!candidate) return false;
    const text = currentText();
    const next = applyPick(text, popup.start, text.length, candidate.label, candidate.userId, currentMentions());
    setText(next.text, next.mentions);
    setMentionIndex(0);
    return true;
  }

  function switcherItems() {
    return rankSwitcherItems(props.store.getState(), switcherQuery());
  }

  function openFromSwitcher(): void {
    const item = switcherItems()[switcherIndex()];
    setSwitcherOpen(false);
    setSwitcherQuery("");
    setSwitcherIndex(0);
    if (!item) return;
    goToChannel(item.channelId);
  }

  function goToChannel(id: string): void {
    const state = props.store.getState();
    const channel = state.channels[id];
    if (!channel) return;
    props.store.dispatch({ type: "ui/selectGuild", id: channel.guildId ?? "@dms" });
    props.store.dispatch({ type: "ui/selectChannel", id });
    setSelectedId(null);
    if (channel.type === 2) {
      props.actions.focus("channels");
      flash("canal de voz: v para entrar");
      return;
    }
    void props.actions.openChannel(id).catch(() => {});
    props.actions.focus("messages");
  }

  function moveGuild(delta: number): void {
    const state = props.store.getState();
    const ids = ["@dms", ...state.guildOrder];
    const index = Math.max(0, ids.indexOf(state.ui.selectedGuildId ?? "@dms"));
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) props.actions.selectGuild(next);
  }

  function jumpGuild(toEnd: boolean): void {
    const state = props.store.getState();
    const ids = ["@dms", ...state.guildOrder];
    const next = toEnd ? ids.at(-1) : ids[0];
    if (next !== undefined) props.actions.selectGuild(next);
  }

  function channelRows() {
    const state = props.store.getState();
    if (state.ui.selectedGuildId === null) return [];
    return selectVisibleChannelList(state, state.ui.selectedGuildId).filter((row) => row.kind !== "category");
  }

  function participantsOf(channelId: string | null): string[] {
    const state = props.store.getState();
    const channel = channelId ? state.channels[channelId] : undefined;
    if (!channel || channel.type !== 2 || channel.guildId === null) return [];
    return selectVoiceParticipants(state, channel.guildId, channel.id).map((p) => p.userId);
  }

  /** j/k en la lista de canales; en un canal de voz recorre también sus participantes (para el volumen). */
  function moveChannel(delta: number): void {
    const rows = channelRows();
    if (rows.length === 0) return;
    const current = props.store.getState().ui.selectedChannelId;
    const users = participantsOf(current);
    const at = participant() === null ? -1 : users.indexOf(participant()!);
    if (delta > 0 && at + 1 < users.length) return void setParticipant(users[at + 1]!);
    if (delta < 0 && at > 0) return void setParticipant(users[at - 1]!);
    if (delta < 0 && at === 0) return void setParticipant(null);
    setParticipant(null);
    const index = rows.findIndex((row) => row.id === current);
    const next = rows[Math.min(rows.length - 1, Math.max(0, (index === -1 ? -1 : index) + delta))] ?? rows[0];
    if (!next) return;
    props.store.dispatch({ type: "ui/selectChannel", id: next.id });
    if (delta < 0) {
      const previousUsers = participantsOf(next.id);
      if (previousUsers.length > 0 && next.id !== current) setParticipant(previousUsers.at(-1)!);
    }
  }

  function nudgeVolume(delta: number, target: string | null = participant()): void {
    const userId = target;
    const state = props.store.getState();
    if (userId === null || userId === state.me?.id) return;
    const current = state.settings.userVolumes[userId] ?? 100;
    const next = Math.max(0, Math.min(200, current + delta));
    props.store.dispatch({ type: "settings/set", patch: { userVolumes: { ...state.settings.userVolumes, [userId]: next } } });
    flash(`volumen de ${displayName(state, userId, state.channels[state.ui.selectedChannelId ?? ""]?.guildId ?? null)}: ${next} %`);
  }

  function jumpChannel(toEnd: boolean): void {
    const rows = channelRows();
    const next = toEnd ? rows.at(-1) : rows[0];
    if (next) props.store.dispatch({ type: "ui/selectChannel", id: next.id });
  }

  function messageIds(): string[] {
    const id = channelId();
    return id === null ? [] : selectMessages(props.store.getState(), id).map((message) => message.id);
  }

  function moveMessage(delta: number): void {
    const id = channelId();
    if (id === null) return;
    const ids = messageIds();
    if (ids.length === 0) return;
    const current = selectedId();
    if (current === null) {
      if (delta < 0) setSelectedId(ids.at(-1)!);
      return;
    }
    const index = ids.indexOf(current);
    if (index <= 0 && delta < 0) {
      void props.actions.loadOlder(id).catch(() => {});
      return;
    }
    const nextIndex = index + delta;
    if (nextIndex >= ids.length) {
      setSelectedId(null);
      return;
    }
    const next = ids[Math.max(0, nextIndex)];
    if (next) setSelectedId(next);
  }

  function focusChannels(): void {
    props.actions.focus("channels");
    const state = props.store.getState();
    if (state.ui.selectedGuildId === null || state.ui.selectedChannelId !== null) return;
    const first = selectChannelList(state, state.ui.selectedGuildId).find((row) => isOpenable(row.kind));
    if (first) props.store.dispatch({ type: "ui/selectChannel", id: first.id });
  }

  function openSelected(): void {
    const state = props.store.getState();
    if (state.ui.focus === "guilds") {
      focusChannels();
      return;
    }
    const id = state.ui.selectedChannelId;
    if (id === null) return;
    if (state.channels[id]?.type === 2) {
      if (state.ui.focus === "channels") void props.actions.voice?.toggleVoice(id);
      return;
    }
    setSelectedId(null);
    void props.actions.openChannel(id).catch(() => {});
    props.actions.focus("messages");
  }

  function closeComposer(): void {
    setReplyTo(null);
    setEditing(null);
    setInsert(false);
    setMentionClosed(false);
  }

  function clearComposer(): void {
    const id = channelId();
    if (id !== null) {
      setDrafts((previous) => ({ ...previous, [id]: "" }));
      setMentions((previous) => ({ ...previous, [id]: [] }));
      setAttachments((previous) => ({ ...previous, [id]: [] }));
    }
    closeComposer();
    setHint(null);
  }

  async function submitComposer(): Promise<void> {
    const id = channelId();
    if (id === null) return;
    const text = currentText();
    const files = currentAttachments();
    const validation = validateOutgoing(text, files.length);
    if (!validation.ok) {
      if (validation.reason === "too_long") flash("el mensaje pasa de 2000 caracteres");
      return;
    }
    const content = serializeComposer(text, currentMentions());

    if (editing() !== null) {
      const editId = editing()!;
      try {
        await props.actions.edit(id, editId, content);
      } catch {
        flash("no se pudo editar");
        return;
      }
      clearComposer();
      return;
    }

    const reply = replyTo();
    const opts: { replyTo?: string; attachments?: PendingAttachment[] } = {};
    if (reply !== null) opts.replyTo = reply;
    if (files.length > 0) opts.attachments = files;
    clearComposer();
    setSelectedId(null);
    await props.actions.send(id, content, opts);
  }

  function retryFirstFailed(): void {
    const id = channelId();
    if (id === null) return;
    const failed = Object.values(props.store.getState().outbox).find(
      (item) => item.channelId === id && item.state === "failed",
    );
    if (failed) void props.actions.retry(failed.nonce);
    else flash("no hay envíos fallidos");
  }

  function selectedMessage(): any | undefined {
    const id = channelId();
    if (id === null || selectedId() === null) return undefined;
    return props.store.getState().messages[id]?.byId[selectedId()!];
  }

  function startEdit(): void {
    const id = channelId();
    if (id === null) return;
    if (selectedId() === null) {
      flash("seleccioná un mensaje con k");
      return;
    }
    const message = selectedMessage();
    if (!message || message.author?.id !== props.store.getState().me?.id) {
      flash("solo podés editar o borrar tus mensajes");
      return;
    }
    setEditing(selectedId());
    setReplyTo(null);
    setText(String(message.content ?? ""), []);
    setInsert(true);
  }

  function requestDelete(): void {
    if (selectedId() === null) {
      flash("seleccioná un mensaje con k");
      return;
    }
    const now = Date.now();
    if (now - lastD() < 500) {
      const message = selectedMessage();
      if (!message || message.author?.id !== props.store.getState().me?.id) {
        flash("solo podés editar o borrar tus mensajes");
        setLastD(0);
        return;
      }
      setConfirmDelete(selectedId());
      setLastD(0);
      return;
    }
    setLastD(now);
  }

  function startReply(): void {
    const id = channelId();
    if (id === null || !isTextChannel()) return;
    const target = selectedId() ?? selectMessages(props.store.getState(), id).at(-1)?.id ?? null;
    if (target === null) return;
    setEditing(null);
    setReplyTo(target);
    setInsert(true);
  }

  function pickerMatches() {
    const query = pickerQuery().toLowerCase();
    const state = props.store.getState();
    const id = channelId();
    const guildId = id ? state.channels[id]?.guildId ?? null : null;
    const custom = guildId
      ? (state.guilds[guildId]?.emojis ?? [])
          .filter((emoji) => emoji.name.toLowerCase().includes(query))
          .map((emoji) => ({ name: emoji.name, char: `:${emoji.name}:`, id: emoji.id as string | null }))
      : [];
    const common = COMMON_EMOJI.filter((emoji) => emoji.name.includes(query) || emoji.char === pickerQuery()).map(
      (emoji) => ({ ...emoji, id: null as string | null }),
    );
    return [...common, ...custom];
  }

  function togglePickedReaction(index = 0): void {
    const id = channelId();
    const target = selectedId() ?? (id ? selectMessages(props.store.getState(), id).at(-1)?.id ?? null : null);
    if (id === null || target === null) {
      flash("seleccioná un mensaje");
      return;
    }
    const match = pickerMatches()[index];
    if (match) {
      const emoji = match.id ? { id: match.id, name: match.name } : { id: null, name: match.char };
      void props.actions.toggleReaction(id, target, emoji).catch(() => {});
    }
    setPickerOpen(false);
    setPickerQuery("");
  }

  async function pasteFromClipboard(): Promise<void> {
    const image = await deps().readClipboardImage();
    if (image) {
      addAttachment({ filename: image.filename, mime: image.mime, bytes: image.bytes });
      setInsert(true);
      return;
    }
    const text = await deps().readClipboardText();
    if (text) {
      setInsert(true);
      insertText(text);
    } else flash("el portapapeles está vacío");
  }

  async function finishAttachPrompt(): Promise<void> {
    const path = attachPrompt() ?? "";
    setAttachPrompt(null);
    if (path.trim().length === 0) return;
    try {
      addAttachment(await deps().readAttachmentFromPath(path));
      setHint(null);
      setInsert(true);
    } catch (error) {
      flash(`no se pudo adjuntar: ${error instanceof Error ? error.message : "error"}`);
    }
  }

  /** Barra de acciones de un mensaje (click): igual que r / e / dd / +. */
  function messageAction(action: MessageAction, messageId: string): void {
    setSelectedId(messageId);
    props.actions.focus("messages");
    if (action === "reply") return startReply();
    if (action === "edit") return startEdit();
    if (action === "react") {
      setPickerOpen(true);
      setPickerQuery("");
      return;
    }
    const message = selectedMessage();
    if (!message || message.author?.id !== props.store.getState().me?.id) {
      flash("solo podés editar o borrar tus mensajes");
      return;
    }
    setConfirmDelete(messageId);
  }

  function confirmDeleteNow(yes: boolean): void {
    const id = channelId();
    const messageId = confirmDelete();
    if (yes && id !== null && messageId !== null) void props.actions.remove(id, messageId).catch(() => {});
    setConfirmDelete(null);
    if (yes) setSelectedId(null);
  }

  /** Click en un miembro: lo menciona en el composer (sale como <@id> al mandar). */
  function mentionMember(userId: string): void {
    const state = props.store.getState();
    const id = channelId();
    if (id === null || !isTextChannel()) return;
    const label = displayName(state, userId, state.channels[id]?.guildId ?? null);
    const before = currentText();
    const glue = before.length === 0 || before.endsWith(" ") ? "" : " ";
    const start = before.length + glue.length;
    const text = `${before}${glue}@${label} `;
    setText(text, [...currentMentions(), { start, end: start + label.length + 1, userId }]);
    setInsert(true);
  }

  function startComposer(): void {
    if (!isTextChannel()) {
      flash("abrí un canal de texto para escribir");
      return;
    }
    setInsert(true);
    props.actions.focus("messages");
  }

  function printable(key: KeyEvent): string | null {
    if (key.ctrl || key.meta) return null;
    if (key.name === "space") return " ";
    return key.sequence.length > 0 && [...key.sequence].length === 1 && key.sequence >= " " ? key.sequence : null;
  }

  usePaste((event: PasteEvent) => {
    const text = new TextDecoder().decode(event.bytes);
    if (attachPrompt() !== null) {
      setAttachPrompt((previous) => (previous ?? "") + text.replace(/\n/g, ""));
      return;
    }
    if (switcherOpen()) {
      setSwitcherQuery((previous) => previous + text.replace(/\n/g, " "));
      return;
    }
    if (!isTextChannel()) return;
    setInsert(true);
    insertText(text);
  });

  useKeyboard(
    (key) => {
      // Push-to-talk: solo Espacio; los release siempre llegan para no quedar transmitiendo.
      if (key.eventType === "release") {
        if (key.name === "space") props.actions.voice?.pttKey({ name: "space", eventType: "release" });
        return;
      }
      props.onActivity?.();
      if (settingsOpen()) return;

      if (helpOpen()) {
        if (key.name === "escape" || key.name === "q" || (key.name === "?" && !key.ctrl && !key.meta)) setHelpOpen(false);
        return;
      }

      if (switcherOpen()) {
        if (key.name === "escape") {
          setSwitcherOpen(false);
          setSwitcherQuery("");
          return;
        }
        if (key.name === "return") return openFromSwitcher();
        if (key.name === "down" || (key.ctrl && key.name === "n") || key.name === "tab") {
          setSwitcherIndex((i) => Math.min(Math.max(0, Math.min(switcherItems().length, 12) - 1), i + 1));
          return;
        }
        if (key.name === "up" || (key.ctrl && key.name === "p")) {
          setSwitcherIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "backspace") {
          setSwitcherQuery((q) => q.slice(0, -1));
          setSwitcherIndex(0);
          return;
        }
        const ch = printable(key);
        if (ch !== null) {
          setSwitcherQuery((q) => q + ch);
          setSwitcherIndex(0);
        }
        return;
      }

      if (key.ctrl && key.name === "k") {
        setSwitcherOpen(true);
        setSwitcherQuery("");
        setSwitcherIndex(0);
        return;
      }

      if (attachPrompt() !== null) {
        if (key.name === "escape") return void setAttachPrompt(null);
        if (key.name === "return") return void finishAttachPrompt();
        if (key.name === "backspace") return void setAttachPrompt((p) => (p ?? "").slice(0, -1));
        const ch = printable(key);
        if (ch !== null) setAttachPrompt((p) => (p ?? "") + ch);
        return;
      }

      if (pickerOpen()) {
        if (key.name === "escape") {
          setPickerOpen(false);
          setPickerQuery("");
          return;
        }
        if (key.name === "return") return togglePickedReaction();
        if (key.name === "backspace") return void setPickerQuery((previous) => previous.slice(0, -1));
        const ch = printable(key);
        if (ch !== null) setPickerQuery((previous) => previous + ch);
        return;
      }

      if (confirmDelete() !== null) {
        if (key.name === "y") return confirmDeleteNow(true);
        if (key.name === "n" || key.name === "escape") confirmDeleteNow(false);
        return;
      }

      if (insert()) {
        const popup = mentionState();
        if (key.name === "escape") {
          if (popup) {
            setMentionClosed(true);
            return;
          }
          if (editing() !== null) clearComposer();
          else closeComposer();
          return;
        }
        if (popup && (key.name === "tab" || key.name === "return")) {
          pickMention();
          return;
        }
        if (popup && (key.name === "down" || (key.ctrl && key.name === "n"))) {
          setMentionIndex((i) => Math.min(popup.candidates.length - 1, i + 1));
          return;
        }
        if (popup && (key.name === "up" || (key.ctrl && key.name === "p"))) {
          setMentionIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.name === "return") {
          if (key.shift || key.option || key.meta) insertText("\n");
          else void submitComposer();
          return;
        }
        if (key.name === "backspace") return backspace();
        if (key.ctrl && key.name === "v") return void pasteFromClipboard();
        if (key.ctrl && key.name === "u") return setText("", []);
        if (key.ctrl && key.name === "w") {
          const trimmed = currentText().replace(/\S+\s*$/, "");
          return setText(trimmed, currentMentions().filter((m) => m.end <= trimmed.length));
        }
        const ch = printable(key);
        if (ch !== null) insertText(ch);
        return;
      }

      // Push-to-talk en modo normal: el press.
      if (key.name === "space") {
        props.actions.voice?.pttKey({ name: "space", eventType: key.eventType === "repeat" || key.repeated ? "repeat" : "press", repeated: key.repeated });
        return;
      }

      const focused = props.store.getState().ui.focus;

      // Mantener apretada una tecla repite el evento: solo la navegación se repite, los toggles no.
      const navigation = ["j", "k", "up", "down", "h", "l", "left", "right", "backspace"];
      if (key.repeated && !navigation.includes(key.name)) return;

      if (pendingG()) {
        setPendingG(false);
        switch (key.name) {
          case "s":
            setSettingsOpen(true);
            return;
          case "m":
            props.actions.toggleMembers();
            return;
          case "u": {
            const next = selectNextUnread(props.store.getState(), channelId());
            if (next) goToChannel(next);
            else flash("no hay canales sin leer");
            return;
          }
          case "g":
            if (focused === "messages") {
              const id = channelId();
              const first = messageIds()[0];
              if (first) setSelectedId(first);
              if (id) void props.actions.loadOlder(id).catch(() => {});
            } else if (focused === "channels") jumpChannel(false);
            else jumpGuild(false);
            return;
          default:
            break;
        }
      }

      if (key.ctrl && key.name === "v") {
        if (isTextChannel()) void pasteFromClipboard();
        return;
      }

      switch (key.name) {
        case "g":
          if (key.shift) {
            if (focused === "messages") setSelectedId(null);
            else if (focused === "channels") jumpChannel(true);
            else jumpGuild(true);
            return;
          }
          setPendingG(true);
          return;
        case "?":
          setHelpOpen(true);
          return;
        case "q":
          props.onQuit();
          return;
        case "escape":
          setSelectedId(null);
          setHint(null);
          return;
        case "i":
          if (!isTextChannel()) {
            flash("abrí un canal de texto para escribir");
            return;
          }
          setInsert(true);
          props.actions.focus("messages");
          return;
        case "j":
        case "down":
          if (focused === "messages") moveMessage(1);
          else if (focused === "channels") moveChannel(1);
          else moveGuild(1);
          return;
        case "k":
        case "up":
          if (focused === "messages") moveMessage(-1);
          else if (focused === "channels") moveChannel(-1);
          else moveGuild(-1);
          return;
        case "h":
        case "left":
          setParticipant(null);
          if (focused === "messages") props.actions.focus("channels");
          else props.actions.focus("guilds");
          return;
        case "l":
        case "right":
          if (focused === "channels") openSelected();
          else if (focused === "guilds") focusChannels();
          return;
        case "return":
          openSelected();
          return;
        case "r":
          if (key.shift) return retryFirstFailed();
          startReply();
          return;
        case "e":
          startEdit();
          return;
        case "d":
          if (key.shift) {
            props.actions.voice?.toggleDeaf();
            return;
          }
          requestDelete();
          return;
        case "m":
          if (key.shift) props.actions.voice?.toggleInputMode();
          else props.actions.voice?.toggleMute();
          return;
        case "v": {
          const id = channelId();
          const state = props.store.getState();
          if (id !== null && state.channels[id]?.type === 2) void props.actions.voice?.toggleVoice(id);
          else if (state.voice.channelId !== null) void props.actions.voice?.leaveVoice();
          else flash("seleccioná un canal 🔊 para entrar a voz");
          return;
        }
        case "a":
          if (!isTextChannel()) return;
          setAttachPrompt("");
          return;
        case "x": {
          const id = channelId();
          if (id !== null && currentAttachments().length > 0) {
            setAttachments((previous) => ({ ...previous, [id]: (previous[id] ?? []).slice(0, -1) }));
          }
          return;
        }
        default:
          break;
      }

      if (participant() !== null && focused === "channels" && (key.sequence === "+" || key.sequence === "-")) {
        nudgeVolume(key.sequence === "+" ? 10 : -10);
        return;
      }
      if (key.sequence === "+") {
        setPickerOpen(true);
        setPickerQuery("");
        return;
      }
      if (key.sequence === "?") setHelpOpen(true);
      if (key.sequence === "R") retryFirstFailed();
      if (key.sequence === "D") props.actions.voice?.toggleDeaf();
      if (key.sequence === "M") props.actions.voice?.toggleInputMode();
      if (key.sequence === "G") {
        if (focused === "messages") setSelectedId(null);
        else if (focused === "channels") jumpChannel(true);
        else jumpGuild(true);
      }
    },
    { release: true },
  );

  onMount(() => {
    const unsubscribe = props.store.subscribe(() => {
      const state = props.store.getState();
      if (state.ui.selectedGuildId === null && state.guildOrder.length > 0) {
        props.actions.selectGuild(state.guildOrder[0]!);
      }
    });
    onCleanup(unsubscribe);
  });

  const composerContext = (): string | null => {
    const state = props.store.getState();
    const id = channelId();
    const target = replyTo() ?? editing();
    if (id === null || target === null) return null;
    const message = state.messages[id]?.byId[target];
    if (!message) return null;
    const guildId = state.channels[id]?.guildId ?? null;
    const who = displayName(state, message.author?.id ?? "", guildId);
    const text = plainText(parseMarkdown(String(message.content ?? "")));
    return editing() !== null ? `editando: ${truncate(text, 50)}` : `respondiendo a @${who}: ${truncate(text, 40)}`;
  };

  const placeholder = useSelector(props.store, (state) => {
    const id = state.ui.selectedChannelId;
    const channel = id ? state.channels[id] : undefined;
    if (!channel) return "elegí un canal";
    if (channel.type === 2) return "canal de voz · click en el canal o v para entrar";
    return channel.guildId === null ? `i para escribirle a @${channel.name}` : `i para escribir en #${channel.name}`;
  });

  const showMembers = (): boolean => membersVisible() && inGuild() && dims().width >= 110;

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={theme().bg}>
      <box flexDirection="row" flexGrow={1} width="100%">
        <GuildList store={props.store} actions={props.actions} theme={theme()} focused={focus() === "guilds"} />
        <ChannelList
          store={props.store}
          actions={props.actions}
          theme={theme()}
          focused={focus() === "channels"}
          selectedParticipant={focus() === "channels" ? participant() : null}
          onParticipant={(_channelId, userId) => setParticipant(userId)}
          onVolume={(userId, delta) => nudgeVolume(delta, userId)}
        />
        <MessageView
          store={props.store}
          theme={theme()}
          selectedId={selectedId()}
          focused={focus() === "messages"}
          images={props.images === true && inlineImages()}
          onSelect={(id) => {
            setSelectedId(id);
            props.actions.focus("messages");
          }}
          onAction={messageAction}
          onReact={(messageId, emoji) => {
            const id = channelId();
            if (id !== null) void props.actions.toggleReaction(id, messageId, emoji).catch(() => {});
          }}
          onOpen={(url) => props.actions.openUrl?.(url)}
          onLoadOlder={() => {
            const id = channelId();
            if (id !== null) void props.actions.loadOlder(id).catch(() => {});
          }}
          onFocus={() => props.actions.focus("messages")}
          onVoiceToggle={(id) => void props.actions.voice?.toggleVoice(id)}
        />
        <Show when={showMembers()}>
          <MemberList store={props.store} theme={theme()} onMember={mentionMember} />
        </Show>
      </box>
      <Show when={confirmDelete() !== null}>
        <box height={1} width="100%" paddingLeft={1} flexShrink={0} flexDirection="row" columnGap={1}>
          <text fg={theme().error}>¿Borrar este mensaje? y/n</text>
          <Button label="sí, borrar" theme={theme()} danger onPress={() => confirmDeleteNow(true)} />
          <Button label="no" theme={theme()} onPress={() => confirmDeleteNow(false)} />
        </box>
      </Show>
      <Show when={pickerOpen()}>
        <box height={1} width="100%" paddingLeft={1} flexShrink={0} flexDirection="row" columnGap={1}>
          <text fg={theme().accent} wrapMode="none" flexShrink={0}>{`reacción ❯ ${pickerQuery()}█`}</text>
          <For each={pickerMatches().slice(0, 10)}>
            {(emoji, i) => <Button label={`${emoji.char} ${emoji.name}`} theme={theme()} onPress={() => togglePickedReaction(i())} />}
          </For>
          <Button label="✕" theme={theme()} onPress={() => (setPickerOpen(false), setPickerQuery(""))} />
        </box>
      </Show>
      <Show when={hint() !== null}>
        <box height={1} width="100%" paddingLeft={1} flexShrink={0}>
          <text fg={theme().warn}>{hint()}</text>
        </box>
      </Show>
      <Show when={mentionState()}>
        {(popup: () => NonNullable<ReturnType<typeof mentionState>>) => (
          <MentionPopup candidates={popup().candidates} index={mentionIndex()} theme={theme()} onPick={(i) => pickMention(i)} />
        )}
      </Show>
      <Notices store={props.store} theme={theme()} />
      <Composer
        text={currentText()}
        insert={insert()}
        replyTo={replyTo()}
        editing={editing()}
        theme={theme()}
        placeholder={placeholder()}
        context={composerContext()}
        attachments={currentAttachments()}
        prompt={attachPrompt()}
        onClick={startComposer}
        onAttach={textChannel() ? () => setAttachPrompt("") : undefined}
        onPaste={textChannel() ? () => void pasteFromClipboard() : undefined}
        onRemoveAttachment={(index) => {
          const id = channelId();
          if (id !== null) setAttachments((previous) => ({ ...previous, [id]: (previous[id] ?? []).filter((_, i) => i !== index) }));
        }}
      />
      <VoiceBar store={props.store} theme={theme()} actions={props.actions} />
      <StatusBar
        store={props.store}
        theme={theme()}
        mode={insert() || attachPrompt() !== null ? "INSERT" : "NORMAL"}
        onHelp={() => setHelpOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onSwitcher={() => {
          setSwitcherOpen(true);
          setSwitcherQuery("");
          setSwitcherIndex(0);
        }}
      />
      <Show when={switcherOpen()}>
        <QuickSwitcher
          query={switcherQuery()}
          items={switcherItems()}
          index={switcherIndex()}
          theme={theme()}
          onPick={(i) => {
            setSwitcherIndex(i);
            openFromSwitcher();
          }}
          onClose={() => {
            setSwitcherOpen(false);
            setSwitcherQuery("");
          }}
        />
      </Show>
      <Show when={helpOpen()}>
        <HelpOverlay onClose={() => setHelpOpen(false)} theme={theme()} />
      </Show>
      <Show when={settingsOpen()}>
        <SettingsScreen
          store={props.store}
          actions={props.actions}
          deps={props.settingsDeps ?? defaultSettingsDeps}
          inVoice={props.store.getState().voice.channelId !== null}
          onClose={() => setSettingsOpen(false)}
        />
      </Show>
    </box>
  );
}
