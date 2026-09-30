import {formatClock, isoDay} from '../lib/time.js';
import {BridgeError, type Bridge, type BridgeEvent, type ChatRoom, type Message} from './types.js';

type DemoRoom = ChatRoom & {log: Message[]; open: boolean};

const replies = ['ㅋㅋㅋㅋ 좋아', '오 진짜?', '잠깐만 확인해볼게', '👍', '그래그래 이따 봐', '헐 대박', '나도 그렇게 생각함'];

function msg(kind: Message['kind'], text: string, mine: boolean, sender?: string, time?: string, extra: Partial<Message> = {}): Message {
	return {row: 0, kind, text, mine, sender, time, ...extra};
}

function seed(): DemoRoom[] {
	const rooms: DemoRoom[] = [
		{
			index: 0, name: '민지', time: '오후 3:28', preview: '7시 어때?', unread: 2, muted: false, kind: 'direct', open: false,
			log: [
				msg('divider', '', false, undefined, undefined, {date: isoDay(new Date())}),
				msg('text', '오늘 저녁 뭐 먹을래?', true, undefined, '오후 3:20'),
				msg('text', '음 글쎄', false, '민지'),
				msg('text', '파스타 어때', false, '민지', '오후 3:25'),
				msg('photo', '사진', false, '민지', '오후 3:26'),
				msg('text', '좋아 몇 시?', true, undefined, '오후 3:27'),
				msg('text', '7시 어때?', false, '민지', '오후 3:28'),
			],
		},
		{
			index: 1, name: '개발팀', members: 5, time: '오후 3:10', preview: 'PR 리뷰 부탁드려요', unread: 3, muted: false, kind: 'group', open: false,
			log: [
				msg('text', '배포 끝났습니다 🎉', false, '김팀장', '오후 2:40'),
				msg('text', '수고하셨습니다!', true, undefined, '오후 2:41'),
				msg('file', 'release-notes.pdf', false, '박개발', '오후 2:55', {detail: '유효기간 ~ 2026.10.30 · 용량 1.2MB'}),
				msg('text', 'PR 리뷰 부탁드려요', false, '이디자인', '오후 3:10'),
			],
		},
		{
			index: 2, name: '가족', members: 4, time: '오후 1:02', preview: '저녁 먹고 와?', unread: 0, muted: false, kind: 'group', open: false,
			log: [
				msg('text', '저녁 먹고 와?', false, '엄마', '오후 1:02'),
				msg('emoticon', '이모티콘', false, '아빠', '오후 1:03'),
			],
		},
		{
			index: 3, name: '나', time: '어제', preview: '장보기: 우유, 계란', unread: 0, muted: false, kind: 'me', open: false,
			log: [msg('text', '장보기: 우유, 계란', true, undefined, '오후 8:12')],
		},
		{
			index: 4, name: '맥북 유저 모임', members: 1204, time: '9월 28일', preview: 'M5 써보신 분?', unread: 300, muted: true, kind: 'open', open: false,
			log: [msg('text', 'M5 써보신 분?', false, '익명의 라이언', '오후 11:40')],
		},
	];
	return rooms;
}

/** In-memory stand-in for KakaoTalk, for trying the UI without the real app. */
export class DemoBridge implements Bridge {
	private readonly rooms = seed();
	private readonly listeners = new Set<(event: BridgeEvent) => void>();
	private readonly timers: NodeJS.Timeout[] = [];
	private watching?: string;
	private watchChats = false;

	constructor() {
		this.timers.push(setInterval(() => this.ambient(), Number(process.env.KAKAOWORK_DEMO_AMBIENT_MS ?? 20_000)));
	}

	async status() {
		return {trusted: true, running: true, hidden: false, version: 'demo', me: '나', totalUnread: this.total(), openChats: []};
	}

	async chats(limit = 30) {
		await delay(250);
		return {rooms: this.sorted().slice(0, limit).map(strip), totalUnread: this.total()};
	}

	async open(name: string) {
		const room = this.find(name);
		await delay(400);
		const alreadyOpen = room.open;
		room.open = true;
		room.unread = 0;
		this.chatsChanged();
		return {title: room.name, alreadyOpen};
	}

	async messages(title: string, limit: number, watch: boolean) {
		const room = this.find(title);
		await delay(300);
		if (watch) this.watching = title;
		const log = room.log.map((m, row) => ({...m, row}));
		return {messages: log.slice(-limit), rowCount: log.length};
	}

	async send(title: string, text: string) {
		const room = this.find(title);
		await delay(120);
		this.append(room, msg('text', text, true, undefined, formatClock(new Date())));
		if (room.kind === 'me') return;
		const others = [...new Set(room.log.filter(m => !m.mine && m.sender).map(m => m.sender!))];
		const who = room.kind === 'direct' || others.length === 0 ? room.name : others[Math.floor(Math.random() * others.length)];
		const timer = setTimeout(() => {
			this.append(room, msg('text', replies[Math.floor(Math.random() * replies.length)], false, who, formatClock(new Date())));
		}, 1200 + Math.random() * 1500);
		this.timers.push(timer);
	}

	async watch(options: {chats?: boolean; stopRoom?: boolean}) {
		if (options.chats !== undefined) this.watchChats = options.chats;
		if (options.stopRoom) this.watching = undefined;
	}

	async close(title: string) {
		this.find(title).open = false;
		if (this.watching === title) this.watching = undefined;
	}

	async setHidden() {}

	on(listener: (event: BridgeEvent) => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose() {
		for (const t of this.timers) clearTimeout(t);
	}

	private find(name: string) {
		const room = this.rooms.find(r => r.name === name);
		if (!room) throw new BridgeError('not_found', `'${name}' 채팅방을 찾을 수 없습니다`);
		return room;
	}

	private append(room: DemoRoom, message: Message) {
		room.log.push(message);
		room.preview = message.text;
		room.time = message.time ?? room.time;
		room.index = -1;
		if (this.watching === room.name) {
			this.emit({event: 'messages', title: room.name, messages: [{...message, row: room.log.length - 1}]});
		} else if (!message.mine) {
			room.unread += 1;
		}

		this.chatsChanged();
	}

	private ambient() {
		const room = this.rooms.find(r => r.name === '가족')!;
		const lines = ['다들 뭐해~', '주말에 시간 되니?', '사진 봤어?'];
		this.append(room, msg('text', lines[Math.floor(Math.random() * lines.length)], false, '엄마', formatClock(new Date())));
	}

	private sorted() {
		const list = [...this.rooms].sort((a, b) => a.index - b.index);
		list.forEach((r, i) => (r.index = i));
		return list;
	}

	private total() {
		return this.rooms.reduce((sum, r) => sum + r.unread, 0);
	}

	private chatsChanged() {
		if (this.watchChats) this.emit({event: 'chats', rooms: this.sorted().slice(0, 8).map(strip), totalUnread: this.total()});
	}

	private emit(event: BridgeEvent) {
		for (const listener of this.listeners) listener(event);
	}
}

function strip({log: _log, open: _open, ...room}: DemoRoom): ChatRoom {
	return room;
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
