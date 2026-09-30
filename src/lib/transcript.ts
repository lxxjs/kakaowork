import type {ChatRoom, Message} from '../bridge/types.js';

export type ToolStatus = 'ok' | 'error' | 'info';

export type Item =
	| {id: number; type: 'banner'; me?: string | null; version?: string; totalUnread?: number | null; recent: ChatRoom[]; demo: boolean}
	| {id: number; type: 'message'; message: Message; header: boolean; showTime: boolean; group: boolean}
	| {id: number; type: 'tool'; title: string; arg?: string; lines: string[]; status: ToolStatus}
	| {id: number; type: 'notice'; room: string; count: number; preview: string}
	| {id: number; type: 'text'; text: string; tone?: 'dim' | 'error' | 'warning'}
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

/** Tracks the previous bubble so consecutive ones from the same sender collapse under one header. */
export class Grouper {
	private who?: string;
	private time?: string;

	constructor(private readonly group: boolean) {}

	reset() {
		this.who = undefined;
		this.time = undefined;
	}

	next(message: Message): Item {
		const s = speaker(message);
		const sameSpeaker = s !== undefined && s === this.who;
		const sameTime = !message.time || message.time === this.time;
		const header = !message.mine && !(sameSpeaker && sameTime);
		const showTime = Boolean(message.time) && !(sameSpeaker && sameTime);
		this.who = s;
		if (message.time) this.time = message.time;
		if (s === undefined) this.time = undefined;
		return item({type: 'message', message, header, showTime, group: this.group});
	}
}

export function isGroupRoom(room?: ChatRoom): boolean {
	return room?.kind === 'group' || room?.kind === 'open';
}
