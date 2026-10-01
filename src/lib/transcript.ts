import type {ChatRoom, Message, UnreadRow} from '../bridge/types.js';

export type ToolStatus = 'ok' | 'error' | 'info';

export type Item =
	| {id: number; type: 'banner'; me?: string | null; version?: string; totalUnread?: number | null; recent: ChatRoom[]; demo: boolean}
	| {id: number; type: 'message'; message: Message; first: boolean; showTime: boolean; group: boolean}
	| {id: number; type: 'tool'; title: string; arg?: string; lines: string[]; status: ToolStatus}
	| {id: number; type: 'notice'; room: string; count: number; preview: string}
	| {id: number; type: 'text'; text: string; tone?: 'dim' | 'error' | 'warning'}
	| {id: number; type: 'prompt'; text: string}
	| {id: number; type: 'help'};

export type NewItem = Item extends infer T ? (T extends Item ? Omit<T, 'id'> : never) : never;

let nextId = 1;
export function item(value: NewItem): Item {
	return {...value, id: nextId++} as Item;
}

function speaker(m: Message): string | undefined {
	if (m.kind === 'divider' || m.kind === 'system') return undefined;
	return m.mine ? '\u0000me' : m.sender ?? '';
}

/**
 * KakaoTalk only labels the last bubble of a same-minute run from one sender,
 * so earlier bubbles in the run inherit that label.
 */
export function fillTimes(messages: Message[]): Message[] {
	const out = messages.map(m => ({...m}));
	let time: string | undefined;
	let who: string | undefined;
	for (let i = out.length - 1; i >= 0; i--) {
		const m = out[i];
		const s = speaker(m);
		if (s === undefined) {
			time = undefined;
			who = undefined;
			continue;
		}

		if (m.time) {
			time = m.time;
			who = s;
		} else if (s === who && time) {
			m.time = time;
		} else {
			time = undefined;
			who = s;
		}
	}

	return out;
}

/**
 * Folds a sender's consecutive bubbles within one minute into a single block, the way Claude Code
 * shows one response under one bullet; a new minute starts a new block, as a new reply would.
 * Which bubbles show their time is left to `settleTimes`.
 */
export class Grouper {
	private who?: string;
	private time?: string;

	constructor(private readonly group: boolean) {}

	/** Starts a new block even for the same sender — after a notice or tool line, say. */
	reset() {
		this.who = undefined;
		this.time = undefined;
	}

	next(message: Message): Item {
		const s = speaker(message);
		const minute = Boolean(message.time && this.time && message.time !== this.time);
		const first = s === undefined || s !== this.who || minute;
		this.who = s;
		this.time = message.time ?? this.time;
		return item({type: 'message', message, first, showTime: Boolean(message.time), group: this.group});
	}
}

function sameMinute(a: Message, b: Message): boolean {
	const s = speaker(a);
	return s !== undefined && s === speaker(b) && Boolean(a.time) && a.time === b.time;
}

/**
 * Shows a time only on the last bubble one sender posts within a minute, as KakaoTalk does.
 * Items whose label changes are replaced; the rest are returned as they were.
 */
export function settleTimes(items: Item[]): Item[] {
	let next: Message | undefined;
	let changed = false;
	const out = [...items];
	for (let i = out.length - 1; i >= 0; i--) {
		const it = out[i];
		if (it.type !== 'message') continue;
		const showTime = Boolean(it.message.time) && !(next && sameMinute(it.message, next));
		if (showTime !== it.showTime) {
			out[i] = {...it, showTime};
			changed = true;
		}

		next = it.message;
	}

	return changed ? out : items;
}

function sameBubble(a: UnreadRow | undefined, b: Message): a is UnreadRow {
	return a !== undefined && a.kind === b.kind && a.mine === b.mine && a.text === b.text;
}

/**
 * Copies fresh unread counts onto messages already shown. Rows move when KakaoTalk loads
 * older history above, so the newest message is lined up by content first; matched
 * messages take the row they are on now.
 */
export function applyUnread(items: Item[], rows: UnreadRow[]): Item[] {
	const byRow = new Map(rows.map(r => [r.row, r]));
	const last = items.findLast(it => it.type === 'message' && it.message.row >= 0);
	if (!last || last.type !== 'message') return items;
	let shift = 0;
	if (!sameBubble(byRow.get(last.message.row), last.message)) {
		const match = rows.findLast(r => sameBubble(r, last.message));
		if (!match) return items;
		shift = match.row - last.message.row;
	}

	let changed = false;
	const out = items.map(it => {
		if (it.type !== 'message' || it.message.row < 0) return it;
		const r = byRow.get(it.message.row + shift);
		if (!sameBubble(r, it.message)) return it;
		const unread = r.unread || undefined;
		if (unread === (it.message.unread || undefined) && r.row === it.message.row) return it;
		changed = true;
		return {...it, message: {...it.message, row: r.row, unread}};
	});
	return changed ? out : items;
}

/** The first row whose unread count can still drop, or undefined when every message is read. */
export function firstUnreadRow(items: Item[]): number | undefined {
	for (const it of items) {
		if (it.type === 'message' && it.message.row >= 0 && it.message.unread) return it.message.row;
	}

	return undefined;
}

export function isGroupRoom(room?: ChatRoom): boolean {
	return room?.kind === 'group' || room?.kind === 'open';
}
