import {execFile} from 'node:child_process';
import {Box, Text, useApp, useInput, usePaste, useWindowSize, type Key} from 'ink';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Bridge, BridgeEvent, ChatRoom, Message} from './bridge/types.js';
import * as ed from './lib/editor.js';
import {filterRooms} from './lib/fuzzy.js';
import {formatClock, isoDay} from './lib/time.js';
import {fillTimes, Grouper, isGroupRoom, item, type Item} from './lib/transcript.js';
import {Shortcuts, StatusLine} from './ui/Footer.js';
import {Picker} from './ui/Picker.js';
import {PromptInput} from './ui/PromptInput.js';
import {Spinner} from './ui/Spinner.js';
import {Suggestions, type Suggestion} from './ui/Suggestions.js';
import {theme} from './ui/theme.js';
import {Transcript} from './ui/Transcript.js';

export type AppProps = {
	bridge: Bridge;
	demo: boolean;
	appVersion: string;
	cwd: string;
	initialRoom?: string;
	hideOnStart: boolean;
};

type Current = {title: string; room: ChatRoom; limit: number; rowCount: number; openedByUs: boolean};
type PickerState = {query: ed.Editor; selected: number; loading: boolean};
type Busy = {label: string; since: number};

const COMMANDS = [
	{name: 'chats', args: '', desc: '채팅방 목록에서 골라 열기'},
	{name: 'open', args: '<이름>', desc: '채팅방 열기 (초성 검색 가능)'},
	{name: 'more', args: '[개수]', desc: '이전 메시지 더 불러오기'},
	{name: 'close', args: '', desc: '현재 채팅방 닫기'},
	{name: 'hide', args: '', desc: '카카오톡 창 숨김 모드 (필요할 때만 잠깐 뜸)'},
	{name: 'show', args: '', desc: '카카오톡 창 보이기 (숨김 모드 끄기)'},
	{name: 'notify', args: '[on|off]', desc: '다른 방 새 메시지 알림 켜기/끄기'},
	{name: 'status', args: '', desc: '연결 상태 보기'},
	{name: 'clear', args: '', desc: '화면 지우기'},
	{name: 'help', args: '', desc: '도움말'},
	{name: 'exit', args: '', desc: '종료'},
];

const PICKER_ROWS = 10;

type MenuItem = Suggestion & {run: 'command' | 'room'; value: string; room?: ChatRoom; needsArg?: boolean};

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sameText(a: string, b: string) {
	const norm = (s: string) => s.replace(/\r/g, '').replace(/\s+$/g, '').trim();
	return norm(a) === norm(b);
}

function mergeRooms(known: ChatRoom[], fresh: ChatRoom[]): ChatRoom[] {
	const names = new Set(fresh.map(r => r.name));
	if (fresh[0]?.index === 0) {
		const rest = known.filter(r => !names.has(r.name));
		return [...fresh, ...rest.map((r, i) => ({...r, index: fresh.length + i}))];
	}

	const byName = new Map(fresh.map(r => [r.name, r]));
	return known.map(r => byName.get(r.name) ?? r);
}

export function App({bridge, demo, appVersion, cwd, initialRoom, hideOnStart}: AppProps) {
	const {exit} = useApp();
	const {columns, rows} = useWindowSize();

	const [items, setItems] = useState<Item[]>([]);
	const [scroll, setScrollState] = useState(0);
	const [unseen, setUnseen] = useState(0);
	const [editor, setEditor] = useState<ed.Editor>(ed.emptyEditor);
	const [busy, setBusy] = useState<Busy | null>(null);
	const [picker, setPicker] = useState<PickerState | null>(null);
	const [rooms, setRoomsState] = useState<ChatRoom[]>([]);
	const [current, setCurrentState] = useState<Current | null>(null);
	const [totalUnread, setTotalUnread] = useState<number | null>(null);
	const [hidden, setHidden] = useState(false);
	const [notify, setNotifyState] = useState(true);
	const [menuIndex, setMenuIndex] = useState(0);
	const [showShortcuts, setShowShortcuts] = useState(false);
	const [hint, setHint] = useState<string | undefined>();

	// Mirrors of state for async code (bridge events, awaited calls).
	const roomsRef = useRef<ChatRoom[]>([]);
	const currentRef = useRef<Current | null>(null);
	const notifyRef = useRef(true);
	const grouper = useRef(new Grouper(false));
	const pendingSends = useRef<string[]>([]);
	const history = useRef<string[]>([]);
	const historyIndex = useRef<number | null>(null);
	const draft = useRef('');
	const token = useRef(0);
	const exitTimer = useRef<NodeJS.Timeout | null>(null);
	const seeded = useRef(false);

	// ── transcript scrolling ─────────────────────────────────────────────────
	// `scroll` counts lines up from the bottom (0 = following new messages).
	const scrollRef = useRef(0);
	const metrics = useRef({content: 0, viewport: 0});
	// What the next change in content height means for the view.
	const layoutChange = useRef<'append' | 'prepend' | 'reset'>('append');

	const setScroll = (value: number) => {
		const clamped = Math.max(0, Math.min(value, metrics.current.content - metrics.current.viewport));
		scrollRef.current = clamped;
		setScrollState(clamped);
		if (clamped === 0) setUnseen(0);
	};

	const onMetrics = useCallback((content: number, viewport: number) => {
		const grew = content - metrics.current.content;
		metrics.current = {content, viewport};
		const change = layoutChange.current;
		layoutChange.current = 'append';
		let next = scrollRef.current;
		if (change === 'reset') next = 0;
		// Reading back while new lines arrive below: move with them so the view holds still.
		else if (change === 'append' && next > 0 && grew > 0) next += grew;
		// Older history loaded above keeps the same distance from the bottom, so nothing to do.
		const clamped = Math.max(0, Math.min(next, content - viewport));
		scrollRef.current = clamped;
		setScrollState(clamped);
		if (clamped === 0) setUnseen(0);
	}, []);

	const replaceTranscript = (next: Item[], keepPosition = false) => {
		layoutChange.current = keepPosition ? 'prepend' : 'reset';
		if (!keepPosition) setScroll(0);
		setItems(next);
	};

	const push = (...next: Item[]) => {
		// Anything other than a message (a notice, a tool line) ends the current bubble block.
		if (next.at(-1)?.type !== 'message') grouper.current.reset();
		if (scrollRef.current > 0) setUnseen(n => n + next.filter(i => i.type === 'message' || i.type === 'notice').length);
		setItems(prev => [...prev, ...next]);
	};
	const setRooms = (list: ChatRoom[]) => {
		roomsRef.current = list;
		setRoomsState(list);
	};

	const setCurrent = (value: Current | null) => {
		currentRef.current = value;
		setCurrentState(value);
	};

	const begin = (label: string) => {
		const id = ++token.current;
		setBusy({label, since: Date.now()});
		return id;
	};

	const finish = (id: number) => {
		if (token.current === id) setBusy(null);
	};

	const stale = (id: number) => token.current !== id;

	const fail = (title: string, arg: string | undefined, error: unknown) => {
		push(item({type: 'tool', title, arg, status: 'error', lines: errorText(error).split('\n')}));
	};

	// ── bridge events ────────────────────────────────────────────────────────

	const onEvent = (event: BridgeEvent) => {
		switch (event.event) {
			case 'messages': {
				const cur = currentRef.current;
				if (!cur || event.title !== cur.title) return;
				const out: Item[] = [];
				for (const raw of event.messages) {
					const m: Message = {...raw};
					if (m.mine) {
						const i = pendingSends.current.findIndex(t => sameText(t, m.text));
						if (i >= 0) {
							// Already shown when it was typed.
							pendingSends.current.splice(i, 1);
							continue;
						}
					}

					m.time ??= formatClock(new Date());
					// A separator that appears while watching opens today.
					if (m.kind === 'divider') m.date ??= isoDay(new Date());
					if (!m.mine && !m.sender && cur.room.kind === 'direct') m.sender = cur.room.name;
					out.push(grouper.current.next(m));
				}

				if (out.length > 0) push(...out);
				break;
			}

			case 'chats': {
				const cur = currentRef.current;
				const before = new Map(roomsRef.current.map(r => [r.name, r]));
				const notices: Item[] = [];
				if (seeded.current && notifyRef.current) {
					for (const r of event.rooms) {
						if (r.name === cur?.title || r.muted) continue;
						const prev = before.get(r.name);
						const grew = prev ? r.unread > prev.unread : r.index === 0 && r.unread > 0;
						if (grew) notices.push(item({type: 'notice', room: r.name, count: r.unread, preview: r.preview}));
					}
				}

				setRooms(mergeRooms(roomsRef.current, event.rooms));
				setTotalUnread(event.totalUnread);
				if (notices.length > 0) push(...notices);
				break;
			}

			case 'closed': {
				if (currentRef.current?.title !== event.title) return;
				setCurrent(null);
				push(item({type: 'text', tone: 'warning', text: `카카오톡에서 '${event.title}' 채팅창이 닫혔습니다 · /open 으로 다시 열 수 있어요`}));
				break;
			}

			case 'app': {
				push(
					event.running
						? item({type: 'text', text: '카카오톡이 다시 실행되었습니다'})
						: item({type: 'tool', title: 'KakaoTalk', status: 'error', lines: ['카카오톡이 종료되었습니다']}),
				);
				if (!event.running) setCurrent(null);
				break;
			}

			case 'exit': {
				const detail = event.stderr.trim().split('\n').slice(-3);
				push(item({type: 'tool', title: 'Bridge', status: 'error', lines: [`브리지 프로세스가 종료되었습니다 (code ${event.code})`, ...detail]}));
				break;
			}
		}
	};

	const onEventRef = useRef(onEvent);
	onEventRef.current = onEvent;

	// ── actions ──────────────────────────────────────────────────────────────

	const boot = async () => {
		const id = begin('카카오톡에 연결하는 중');
		try {
			let status = await bridge.status(true);
			if (!status.running) {
				push(item({type: 'text', text: '카카오톡이 꺼져 있어서 실행합니다…'}));
				execFile('open', ['-g', '-b', 'com.kakao.KakaoTalkMac'], () => {});
				for (let i = 0; i < 30 && !status.running; i++) {
					await sleep(1000);
					status = await bridge.status();
				}

				if (status.running) await sleep(2500);
				status = await bridge.status();
			}

			if (!status.trusted) {
				push(
					item({
						type: 'tool',
						title: 'Accessibility',
						status: 'error',
						lines: [
							'터미널 앱에 손쉬운 사용 권한이 필요합니다.',
							'시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용 에서',
							'지금 쓰는 터미널(Terminal, iTerm, Ghostty 등)을 켜고 kakaowork 를 다시 실행하세요.',
						],
					}),
				);
				execFile('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'], () => {});
				return;
			}

			if (!status.running) {
				push(item({type: 'tool', title: 'KakaoTalk', status: 'error', lines: ['카카오톡을 실행하고 로그인한 뒤 다시 시작해 주세요.']}));
				return;
			}

			let list: ChatRoom[] = [];
			try {
				const result = await bridge.chats(40);
				list = result.rooms;
				setTotalUnread(result.totalUnread);
			} catch (error) {
				fail('ListChats', undefined, error);
			}

			setRooms(list);
			seeded.current = true;
			const unread = list.filter(r => r.unread > 0 && !r.muted);
			push(
				item({
					type: 'banner',
					me: status.me,
					version: status.version,
					totalUnread: status.totalUnread,
					recent: (unread.length > 0 ? unread : list).slice(0, 3),
					demo,
				}),
			);
			setHidden(status.hidden);
			await bridge.watch({chats: true});
			if (hideOnStart) {
				await bridge.setHidden(true);
				setHidden(true);
			}
		} catch (error) {
			fail('Connect', undefined, error);
			return;
		} finally {
			finish(id);
		}

		if (initialRoom) await openRoom(initialRoom);
	};

	const showRoom = (next: Current, messages: Message[], keepPosition = false) => {
		setCurrent(next);
		grouper.current = new Grouper(isGroupRoom(next.room));
		pendingSends.current = [];
		// In loaded history every real date separator has a date; one without is some other
		// text-less button (the top-of-history one), so leave it out.
		const named = messages
			.filter(m => m.kind !== 'divider' || m.date)
			.map(m => (!m.mine && !m.sender && next.room.kind === 'direct' ? {...m, sender: next.room.name} : m));
		const who = next.room.kind === 'me' ? '나와의 채팅' : next.room.members ? `${next.room.members}명` : '1:1 채팅';
		const header = item({
			type: 'tool',
			title: 'Open',
			arg: next.room.name,
			status: 'ok',
			lines: [`${who} · 메시지 ${messages.length}개 · 이전 메시지는 /more (PgUp)`],
		});
		const body = fillTimes(named).map(m => grouper.current.next(m));
		setRooms(roomsRef.current.map(r => (r.name === next.room.name ? {...r, unread: 0} : r)));
		replaceTranscript([header, ...body], keepPosition);
	};

	const enterRoom = async (room: ChatRoom, limit = 40) => {
		const previous = currentRef.current;
		const id = begin(`${room.name} 여는 중`);
		try {
			const opened = await bridge.open(room.name, room.index);
			if (stale(id)) return;
			const result = await bridge.messages(opened.title, limit, true);
			if (stale(id)) return;
			// A KakaoTalk window left open keeps marking new messages as read, so close the one we opened.
			if (previous && previous.title !== opened.title && previous.openedByUs) void bridge.close(previous.title).catch(() => {});
			const openedByUs = previous?.title === opened.title ? previous.openedByUs : !opened.alreadyOpen;
			showRoom({title: opened.title, room: {...room, unread: 0}, limit, rowCount: result.rowCount, openedByUs}, result.messages);
		} catch (error) {
			if (!stale(id)) fail('Open', room.name, error);
		} finally {
			finish(id);
		}
	};

	const openRoom = async (query: string) => {
		const self = ['나', 'me', '나와의 채팅'].includes(query);
		const find = (list: ChatRoom[]) =>
			list.find(r => r.name === query) ?? (self ? list.find(r => r.kind === 'me') : undefined) ?? filterRooms(list, query)[0];
		let room = find(roomsRef.current);
		if (!room) {
			const id = begin('채팅방 찾는 중');
			try {
				const result = await bridge.chats(200);
				setRooms(mergeRooms(roomsRef.current, result.rooms));
				room = find(result.rooms);
			} catch (error) {
				fail('Open', query, error);
				return;
			} finally {
				finish(id);
			}
		}

		if (!room) {
			push(item({type: 'tool', title: 'Open', arg: query, status: 'error', lines: ['일치하는 채팅방이 없습니다 · /chats 로 목록을 확인하세요']}));
			return;
		}

		await enterRoom(room);
	};

	const loadMore = async (count: number) => {
		const cur = currentRef.current;
		if (!cur) {
			push(item({type: 'text', tone: 'warning', text: '열린 채팅방이 없습니다'}));
			return;
		}

		const id = begin('이전 메시지 불러오는 중');
		try {
			const limit = cur.limit + count;
			const result = await bridge.messages(cur.title, limit, true);
			if (stale(id)) return;
			showRoom({...cur, limit, rowCount: result.rowCount}, result.messages, true);
			if (result.messages.length < limit) {
				push(item({type: 'text', text: '카카오톡 창에 불러온 메시지를 모두 가져왔습니다'}));
			}
		} catch (error) {
			if (!stale(id)) fail('More', String(count), error);
		} finally {
			finish(id);
		}
	};

	const send = async (text: string) => {
		const cur = currentRef.current;
		if (!cur) {
			push(item({type: 'text', tone: 'warning', text: '열린 채팅방이 없습니다 · /chats 로 채팅방을 먼저 여세요'}));
			return;
		}

		pendingSends.current.push(text);
		push(grouper.current.next({row: -1, kind: 'text', mine: true, text, time: formatClock(new Date())}));
		try {
			await bridge.send(cur.title, text);
		} catch (error) {
			const i = pendingSends.current.indexOf(text);
			if (i >= 0) pendingSends.current.splice(i, 1);
			fail('Send', undefined, error);
		}
	};

	const openPicker = async () => {
		setPicker({query: ed.emptyEditor, selected: 0, loading: true});
		try {
			const result = await bridge.chats(100);
			setRooms(mergeRooms(roomsRef.current, result.rooms));
			setTotalUnread(result.totalUnread);
		} catch (error) {
			fail('ListChats', undefined, error);
		} finally {
			setPicker(p => p && {...p, loading: false});
		}
	};

	const quit = async () => {
		const cur = currentRef.current;
		if (cur?.openedByUs) await Promise.race([bridge.close(cur.title).catch(() => {}), sleep(1000)]);
		exit();
	};

	const runCommand = async (line: string) => {
		const [, name = '', rest = ''] = /^\/(\S*)\s*([\s\S]*)$/.exec(line) ?? [];
		const arg = rest.trim();
		const echo = () => push(item({type: 'prompt', text: line}));
		switch (name) {
			case 'chats':
			case 'c':
				await openPicker();
				break;
			case 'open':
			case 'o':
				if (arg) await openRoom(arg);
				else await openPicker();
				break;
			case 'more':
				await loadMore(Number.parseInt(arg, 10) || 40);
				break;
			case 'close': {
				echo();
				const cur = currentRef.current;
				if (!cur) {
					push(item({type: 'text', tone: 'warning', text: '열린 채팅방이 없습니다'}));
					break;
				}

				try {
					await bridge.watch({stopRoom: true});
					await bridge.close(cur.title);
					setCurrent(null);
					push(item({type: 'tool', title: 'Close', arg: cur.title, status: 'ok', lines: ['채팅창을 닫았습니다']}));
				} catch (error) {
					fail('Close', cur.title, error);
				}

				break;
			}

			case 'hide':
			case 'show': {
				echo();
				try {
					await bridge.setHidden(name === 'hide');
					setHidden(name === 'hide');
					push(item({type: 'tool', title: name === 'hide' ? 'Hide' : 'Show', arg: 'KakaoTalk', status: 'ok', lines: name === 'hide' ? ['카카오톡 창을 숨겼습니다 · 메시지는 계속 주고받아요', '방을 열 때만 잠깐 떴다가 다시 숨고, 포커스는 터미널로 돌아옵니다'] : ['카카오톡 창을 보이게 했습니다 · /hide 로 다시 숨김 모드']}));
				} catch (error) {
					fail(name === 'hide' ? 'Hide' : 'Show', 'KakaoTalk', error);
				}

				break;
			}

			case 'notify': {
				echo();
				const on = arg === 'on' ? true : arg === 'off' ? false : !notifyRef.current;
				notifyRef.current = on;
				setNotifyState(on);
				push(item({type: 'tool', title: 'Notify', arg: on ? 'on' : 'off', status: 'ok', lines: [on ? '다른 채팅방의 새 메시지를 알려드려요' : '다른 채팅방 알림을 껐습니다']}));
				break;
			}

			case 'status': {
				echo();
				try {
					const s = await bridge.status();
					const cur = currentRef.current;
					push(
						item({
							type: 'tool',
							title: 'Status',
							status: 'info',
							lines: [
								`KakaoTalk ${s.version ?? '?'} · ${s.running ? '실행 중' : '꺼짐'}${s.hidden ? ' · 숨김' : ''}`,
								`손쉬운 사용 권한 · ${s.trusted ? '허용됨' : '필요함'}`,
								`내 프로필 · ${s.me ?? '알 수 없음'}`,
								`안 읽은 메시지 · ${s.totalUnread ?? '?'}`,
								`열린 채팅창 · ${s.openChats?.length ? s.openChats.join(', ') : '없음'}`,
								`현재 채팅방 · ${cur?.title ?? '없음'}`,
							],
						}),
					);
				} catch (error) {
					fail('Status', undefined, error);
				}

				break;
			}

			case 'clear':
				grouper.current.reset();
				replaceTranscript([]);
				break;
			case 'help':
			case '?':
				echo();
				push(item({type: 'help'}));
				break;
			case 'exit':
			case 'quit':
			case 'q':
				await quit();
				break;
			default:
				echo();
				push(item({type: 'text', tone: 'error', text: `알 수 없는 명령어: /${name} · /help 로 목록을 볼 수 있어요`}));
		}
	};

	const submit = (text: string) => {
		if (!text.trim()) return;
		setScroll(0);
		history.current.push(text);
		historyIndex.current = null;
		setEditor(ed.emptyEditor);
		setShowShortcuts(false);
		// "//" escapes a message that really starts with a slash.
		if (text.startsWith('/') && !text.startsWith('//')) void runCommand(text.trim());
		else void send(text.startsWith('//') ? text.slice(1) : text);
	};

	useEffect(() => {
		const off = bridge.on(event => onEventRef.current(event));
		void boot();
		return () => {
			off();
		};
	}, []);

	// ── derived UI state ─────────────────────────────────────────────────────

	const pickerRooms = useMemo(() => (picker ? filterRooms(rooms, picker.query.value) : []), [rooms, picker?.query.value]);

	const menu: MenuItem[] = useMemo(() => {
		if (picker || !editor.value.startsWith('/') || editor.value.startsWith('//')) return [];
		const openArg = /^\/(?:open|o)\s+([\s\S]*)$/.exec(editor.value);
		if (openArg) {
			return filterRooms(rooms, openArg[1])
				.slice(0, 6)
				.map(r => ({
					key: `room:${r.name}:${r.index}`,
					label: r.name,
					hint: [r.members ? `${r.members}명` : '', r.time].filter(Boolean).join(' · '),
					badge: r.unread > 0 && !r.muted ? String(r.unread) : undefined,
					run: 'room' as const,
					value: `/open ${r.name}`,
					room: r,
				}));
		}

		if (/\s/.test(editor.value)) return [];
		const query = editor.value.slice(1).toLowerCase();
		return COMMANDS.filter(c => c.name.startsWith(query)).map(c => ({
			key: c.name,
			label: `/${c.name}${c.args ? ' ' + c.args : ''}`,
			hint: c.desc,
			run: 'command' as const,
			value: `/${c.name}`,
			needsArg: c.args.startsWith('<'),
		}));
	}, [editor.value, rooms, picker]);

	useEffect(() => setMenuIndex(0), [editor.value]);
	const selectedMenu = Math.min(menuIndex, Math.max(0, menu.length - 1));

	// ── keyboard ─────────────────────────────────────────────────────────────

	const edit = (next: ed.Editor) => {
		historyIndex.current = null;
		setEditor(next);
	};

	const editKeys = (input: string, key: Key, value: ed.Editor): ed.Editor | null => {
		if (key.backspace) return key.meta ? ed.deleteWordBack(value) : ed.backspace(value);
		if (key.delete) return ed.deleteForward(value);
		if (key.leftArrow) return key.meta || key.ctrl ? ed.wordLeft(value) : ed.left(value);
		if (key.rightArrow) return key.meta || key.ctrl ? ed.wordRight(value) : ed.right(value);
		if (key.home) return ed.home(value);
		if (key.end) return ed.end(value);
		if (key.ctrl) {
			switch (input) {
				case 'a':
					return ed.home(value);
				case 'e':
					return ed.end(value);
				case 'b':
					return ed.left(value);
				case 'f':
					return ed.right(value);
				case 'u':
					return ed.killToLineStart(value);
				case 'k':
					return ed.killToLineEnd(value);
				case 'w':
					return ed.deleteWordBack(value);
				case 'h':
					return ed.backspace(value);
				case 'd':
					return ed.deleteForward(value);
				default:
					return null;
			}
		}

		if (key.meta) {
			if (input === 'b') return ed.wordLeft(value);
			if (input === 'f') return ed.wordRight(value);
			return null;
		}

		if (input && !key.escape && !key.tab && !key.return) return ed.insert(value, input);
		return null;
	};

	const onCtrlC = () => {
		if (picker) return setPicker(null);
		if (editor.value) return setEditor(ed.emptyEditor);
		if (exitTimer.current) {
			void quit();
			return;
		}

		setHint('Press Ctrl-C again to exit');
		exitTimer.current = setTimeout(() => {
			exitTimer.current = null;
			setHint(undefined);
		}, 1500);
	};

	const pickerKeys = (input: string, key: Key) => {
		if (!picker) return;
		if (key.escape) return setPicker(null);
		if (key.upArrow) return setPicker({...picker, selected: Math.max(0, picker.selected - 1)});
		if (key.downArrow) return setPicker({...picker, selected: Math.min(pickerRooms.length - 1, picker.selected + 1)});
		if (key.pageUp) return setPicker({...picker, selected: Math.max(0, picker.selected - PICKER_ROWS)});
		if (key.pageDown) return setPicker({...picker, selected: Math.min(pickerRooms.length - 1, picker.selected + PICKER_ROWS)});
		if (key.return) {
			const room = pickerRooms[picker.selected];
			setPicker(null);
			if (room) void enterRoom(room);
			return;
		}

		const next = editKeys(input, key, picker.query);
		if (next) setPicker({...picker, query: next, selected: 0});
	};

	useInput((input, key) => {
		const mouse = /^\[<(\d+);\d+;\d+[Mm]$/.exec(input);
		if (mouse) {
			// Wheel events scroll the conversation; clicks are ignored.
			const button = Number(mouse[1]) & ~(4 | 8 | 16);
			if (button === 64) setScroll(scrollRef.current + 3);
			if (button === 65) setScroll(scrollRef.current - 3);
			return;
		}

		if (key.ctrl && input === 'c') return onCtrlC();
		if (picker) return pickerKeys(input, key);

		if (key.escape) {
			if (busy) {
				token.current++;
				setBusy(null);
				push(item({type: 'text', tone: 'error', text: '  ⎿  Interrupted by user'}));
			} else if (showShortcuts) {
				setShowShortcuts(false);
			} else if (menu.length > 0 || editor.value) {
				setEditor(ed.emptyEditor);
			}

			return;
		}

		if (key.ctrl && input === 'd' && !editor.value) return onCtrlC();
		if (key.ctrl && input === 'l') {
			setScroll(0);
			return;
		}

		if (menu.length > 0) {
			const chosen = menu[selectedMenu];
			if (key.upArrow) return setMenuIndex((selectedMenu - 1 + menu.length) % menu.length);
			if (key.downArrow) return setMenuIndex((selectedMenu + 1) % menu.length);
			if (key.tab) return edit(ed.fromText(chosen.run === 'room' ? chosen.value : chosen.value + (chosen.needsArg ? ' ' : '')));
			if (key.return && !key.meta) {
				if (chosen.run === 'room' && chosen.room) {
					history.current.push(chosen.value);
					setEditor(ed.emptyEditor);
					void enterRoom(chosen.room);
					return;
				}

				const typed = editor.value.trim();
				const hasArgs = /\s/.test(typed);
				return submit(hasArgs ? typed : chosen.value);
			}
		}

		if (key.return) {
			const before = editor.value.slice(0, editor.cursor);
			if (key.meta || key.shift) return edit(ed.insert(editor, '\n'));
			if (before.endsWith('\\')) return edit(ed.insert(ed.backspace(editor), '\n'));
			return submit(editor.value);
		}

		if (input === '\n') return edit(ed.insert(editor, '\n'));

		if (input === '?' && !editor.value && !key.ctrl && !key.meta) {
			setShowShortcuts(s => !s);
			return;
		}

		const page = Math.max(1, metrics.current.viewport - 2);
		if (key.pageUp) {
			// Past the top of what is loaded, fetch older history.
			if (scrollRef.current >= metrics.current.content - metrics.current.viewport && currentRef.current) void loadMore(40);
			else setScroll(scrollRef.current + page);
			return;
		}

		if (key.pageDown) return setScroll(scrollRef.current - page);
		if (key.shift && (key.upArrow || key.downArrow)) return setScroll(scrollRef.current + (key.upArrow ? 3 : -3));

		if (key.upArrow || key.downArrow) {
			const moved = ed.vertical(editor, key.upArrow ? -1 : 1);
			if (moved) return setEditor(moved);
			const list = history.current;
			if (list.length === 0) return;
			if (key.upArrow) {
				if (historyIndex.current === null) {
					draft.current = editor.value;
					historyIndex.current = list.length;
				}

				if (historyIndex.current > 0) {
					historyIndex.current -= 1;
					setEditor(ed.fromText(list[historyIndex.current]));
				}
			} else if (historyIndex.current !== null) {
				historyIndex.current += 1;
				if (historyIndex.current >= list.length) {
					historyIndex.current = null;
					setEditor(ed.fromText(draft.current));
				} else {
					setEditor(ed.fromText(list[historyIndex.current]));
				}
			}

			return;
		}

		const next = editKeys(input, key, editor);
		if (next) {
			setShowShortcuts(false);
			edit(next);
		}
	});

	usePaste(text => {
		if (picker) setPicker({...picker, query: ed.insert(picker.query, text.replace(/\n/g, ' ')), selected: 0});
		else edit(ed.insert(editor, text));
	});

	// ── render ───────────────────────────────────────────────────────────────

	const context = useMemo(() => ({columns, cwd, appVersion}), [columns, cwd, appVersion]);
	const placeholder = current
		? `${current.room.name}에게 메시지 보내기`
		: rooms.length > 0
			? 'Try "/chats" 또는 "/open 이름"'
			: '카카오톡에 연결하는 중…';

	// The conversation takes whatever the prompt area leaves. One row short of the screen on
	// purpose: a frame that fills the screen makes Ink wipe the terminal (scrollback included)
	// on exit, and quitting should leave the terminal exactly as it was.
	return (
		<Box flexDirection="column" width={columns} height={Math.max(1, rows - 1)}>
			<Transcript items={items} context={context} scroll={scroll} onMetrics={onMetrics} />
			{scroll > 0 ? (
				<Box paddingX={2} justifyContent="space-between" width={columns}>
					<Text color={theme.secondary}>↑ 이전 대화를 보는 중 · PgDn·휠로 내려가기</Text>
					{unseen > 0 ? <Text color={theme.kakao}>새 메시지 {unseen}개 ↓</Text> : null}
				</Box>
			) : null}
			{busy ? <Spinner label={busy.label} since={busy.since} /> : null}
			{picker ? (
				<Picker rooms={pickerRooms} query={picker.query} selected={picker.selected} loading={picker.loading} columns={columns} visible={PICKER_ROWS} />
			) : (
				<PromptInput editor={editor} placeholder={placeholder} columns={columns} focused />
			)}
			{picker ? null : menu.length > 0 ? (
				<Suggestions items={menu} selected={selectedMenu} columns={columns} />
			) : showShortcuts ? (
				<Shortcuts columns={columns} />
			) : (
				<StatusLine
					columns={columns}
					hint={hint}
					room={current?.room}
					totalUnread={totalUnread}
					hidden={hidden}
					notify={notify}
					demo={demo}
				/>
			)}
		</Box>
	);
}
