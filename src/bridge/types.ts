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

export interface Message {
	row: number;
	kind: MessageKind;
	mine: boolean;
	sender?: string;
	text: string;
	detail?: string;
	time?: string;
	unread?: number;
}

export interface Status {
	trusted: boolean;
	running: boolean;
	hidden: boolean;
	version?: string;
	me?: string | null;
	totalUnread?: number | null;
	openChats?: string[];
}

export type BridgeEvent =
	| {event: 'messages'; title: string; messages: Message[]}
	| {event: 'chats'; rooms: ChatRoom[]; totalUnread: number | null}
	| {event: 'closed'; title: string}
	| {event: 'app'; running: boolean}
	| {event: 'exit'; code: number | null; stderr: string};

export interface Bridge {
	status(prompt?: boolean): Promise<Status>;
	chats(limit?: number): Promise<{rooms: ChatRoom[]; totalUnread: number | null}>;
	open(name: string, index?: number): Promise<{title: string; alreadyOpen: boolean}>;
	messages(title: string, limit: number, watch: boolean): Promise<{messages: Message[]; rowCount: number}>;
	send(title: string, text: string): Promise<void>;
	watch(options: {chats?: boolean; stopRoom?: boolean}): Promise<void>;
	close(title: string): Promise<void>;
	setHidden(hidden: boolean): Promise<void>;
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
