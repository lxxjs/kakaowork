import type {ChatRoom, Message} from '../bridge/types.js';

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
 * Folds consecutive bubbles from one sender into a single block, the way Claude Code
 * shows one response under one bullet. Times are shown when the minute changes.
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
		const first = s === undefined || s !== this.who;
		const showTime = Boolean(message.time) && (first || message.time !== this.time);
		this.who = s;
		this.time = s === undefined ? undefined : message.time ?? this.time;
		return item({type: 'message', message, first, showTime, group: this.group});
	}
}

export function isGroupRoom(room?: ChatRoom): boolean {
	return room?.kind === 'group' || room?.kind === 'open';
}
