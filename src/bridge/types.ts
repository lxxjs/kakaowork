export type RoomKind = 'direct' | 'group' | 'me' | 'open';

export interface ChatRoom {
	index: number;
	name: string;
	members?: number;
	time: string;
	preview: string;
	unread: number;
	muted: boolean;
	kind: RoomKind;
}

export type MessageKind = 'text' | 'photo' | 'emoticon' | 'file' | 'system' | 'divider';

/** A downscaled photo or emoticon, captured from KakaoTalk's window by the bridge. */
export interface Thumbnail {
	w: number;
	h: number;
	/** Base64 of packed 8-bit RGB, row-major. */
	rgb: string;
	/** Base64 PNG at close to full resolution, sent when the terminal can draw real images. */
	png?: string;
}

export interface Message {
	row: number;
	kind: MessageKind;
	mine: boolean;
	sender?: string;
	text: string;
	detail?: string;
	time?: string;
	/** ISO day, e.g. "2026-09-30". On a divider, the day it opens. */
	date?: string;
	unread?: number;
	/** Photos and emoticons, when the terminal is allowed to record the screen. */
	image?: Thumbnail;
}

export type UnreadRow = Pick<Message, 'row' | 'kind' | 'mine' | 'text' | 'unread'>;

export interface Status {
	trusted: boolean;
	running: boolean;
	hidden: boolean;
	/** Screen Recording permission, which photo previews need. */
	screenCapture?: boolean;
	version?: string;
	me?: string | null;
	totalUnread?: number | null;
	openChats?: string[];
}

export type BridgeEvent =
	| {event: 'messages'; title: string; messages: Message[]}
	| {event: 'chats'; rooms: ChatRoom[]; totalUnread: number | null}
	/** The other side started or stopped typing in the watched room. */
	| {event: 'typing'; title: string; active: boolean}
	| {event: 'closed'; title: string}
	| {event: 'app'; running: boolean}
	| {event: 'exit'; code: number | null; stderr: string};

export interface Bridge {
	status(prompt?: boolean): Promise<Status>;
	chats(limit?: number): Promise<{rooms: ChatRoom[]; totalUnread: number | null}>;
	open(name: string, index?: number): Promise<{title: string; alreadyOpen: boolean}>;
	messages(title: string, limit: number, watch: boolean): Promise<{messages: Message[]; rowCount: number}>;
	/**
	 * The `count` messages before the oldest one read so far, however far back KakaoTalk keeps
	 * them. Rows already read have moved down by `shift`; `exhausted` marks the first message.
	 * Fails with `resync` when it cannot tell where it left off — read the room again then.
	 */
	older(title: string, count: number): Promise<{messages: Message[]; rowCount: number; shift: number; exhausted: boolean}>;
	/** Re-reads unread counts from row `from` to the newest one. */
	unread(title: string, from: number): Promise<{rows: UnreadRow[]}>;
	send(title: string, text: string): Promise<void>;
	watch(options: {chats?: boolean; stopRoom?: boolean}): Promise<void>;
	close(title: string): Promise<void>;
	setHidden(hidden: boolean): Promise<void>;
	/** Turns picture capture on or off (off by default), and asks for sharp PNGs. */
	configure(options: {capture?: boolean; sharp?: boolean; ask?: boolean}): Promise<void>;
	on(listener: (event: BridgeEvent) => void): () => void;
	dispose(): void;
}

export class BridgeError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = 'BridgeError';
	}
}
