import {Box, Text} from 'ink';
import type {ChatRoom} from '../bridge/types.js';
import {truncate, width} from '../lib/text.js';
import {theme} from './theme.js';

type Segment = {text: string; color?: string; background?: string; bold?: boolean; dim?: boolean};
type Line = Segment[];

// A round speech bubble with a face (eyes, a dot of a mouth, a tail at the bottom left),
// drawn with half blocks so each cell holds two pixels, like Claude Code's mascot.
// A cat: pointed ears, tall eyes, a pink nose and whiskers. Half blocks give two pixels
// per cell; the nose is a cell whose top half is fur (text color) and bottom half pink
// (background color).
function mascot(): Line[] {
	const fur = (text: string): Segment => ({text, color: theme.kakao});
	const whisker: Segment = {text: '=', color: theme.secondary};
	return [
		[fur('  █▄     ▄█  ')],
		[fur(' ▄██▀███▀██▄ ')],
		[whisker, fur('███▄█'), {text: '▀', color: theme.kakao, background: theme.blush}, fur('█▄███'), whisker],
		[fur('  ▀███████▀  ')],
	];
}

type Props = {
	me?: string | null;
	version?: string;
	appVersion: string;
	totalUnread?: number | null;
	recent: ChatRoom[];
	cwd: string;
	columns: number;
	demo: boolean;
};

function lineWidth(line: Line) {
	return line.reduce((sum, s) => sum + width(s.text), 0);
}

function fit(line: Line, columns: number, align: 'left' | 'center'): Line {
	const used = lineWidth(line);
	if (used > columns) {
		const text = line.map(s => s.text).join('');
		return [{...line[0], text: truncate(text, columns)}, {text: ' '.repeat(Math.max(0, columns - width(truncate(text, columns))))}];
	}

	if (align === 'center') {
		const left = Math.floor((columns - used) / 2);
		return [{text: ' '.repeat(left)}, ...line, {text: ' '.repeat(columns - used - left)}];
	}

	return [...line, {text: ' '.repeat(columns - used)}];
}

function Row({segments}: {segments: Line}) {
	return (
		<Text>
			{segments.map((s, i) => (
				<Text key={i} color={s.color} backgroundColor={s.background} bold={s.bold} dimColor={s.dim}>
					{s.text}
				</Text>
			))}
		</Text>
	);
}

function recentLine(room: ChatRoom): Line {
	const line: Line = [{text: room.name}];
	if (room.unread > 0) line.push({text: ` ${room.unread > 999 ? '999+' : room.unread}`, color: room.muted ? theme.secondary : theme.kakao});
	line.push({text: ` · ${room.time}`, color: theme.secondary});
	return line;
}

/** The two-column welcome box Claude Code greets you with. */
export function Banner({me, version, appVersion, totalUnread, recent, cwd, columns, demo}: Props) {
	const accent = theme.accent;
	const title = ` KakaoTalk Code v${appVersion} `;
	const home = process.env.HOME;
	const shortCwd = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
	const greeting = me ? `Welcome back ${me}!` : 'Welcome to KakaoTalk Code!';
	const total = Math.min(columns, 110);

	if (total < 64) {
		const inner = total - 4;
		const rows: Line[] = [
			[{text: '✻ ', color: theme.kakao}, {text: greeting, bold: true}],
			[],
			[{text: '  /help 도움말 · /chats 채팅방 열기', color: theme.secondary}],
			[],
			[{text: `  cwd: ${shortCwd}`, color: theme.secondary}],
		];
		return (
			<Box flexDirection="column">
				<Row segments={[{text: '╭' + '─'.repeat(total - 2) + '╮', color: accent}]} />
				{rows.map((r, i) => (
					<Row key={i} segments={[{text: '│ ', color: accent}, ...fit(r, inner, 'left'), {text: ' │', color: accent}]} />
				))}
				<Row segments={[{text: '╰' + '─'.repeat(total - 2) + '╯', color: accent}]} />
			</Box>
		);
	}

	const inner = total - 2;
	const leftWidth = Math.floor(inner * 0.45);
	const rightWidth = inner - leftWidth - 1;

	const unread = typeof totalUnread === 'number' ? ` · 안 읽음 ${totalUnread}` : '';
	const left: Line[] = [
		[],
		[{text: greeting, bold: true}],
		[],
		...mascot(),
		[],
		[{text: demo ? 'Demo mode · 가상 데이터' : `KakaoTalk ${version ?? ''}${unread}`, color: theme.secondary}],
		[{text: shortCwd, color: theme.secondary}],
	];

	const activity = recent.slice(0, 3).map(recentLine);
	const right: Line[] = [
		[{text: 'Tips for getting started', color: accent, bold: true}],
		[{text: '/chats 로 채팅방을 골라 여세요'}],
		[{text: '/open ㄱㅈ 처럼 초성으로 바로 열기'}],
		[{text: '메시지를 입력하고 ⏎ 로 보내세요'}],
		[{text: '─'.repeat(rightWidth - 2), color: accent, dim: true}],
		[{text: 'Recent activity', color: accent, bold: true}],
		...(activity.length > 0 ? activity : [[{text: 'No recent activity', color: theme.secondary}]]),
	];

	const height = Math.max(left.length, right.length);
	const leftPad = Math.max(0, Math.floor((height - left.length) / 2));
	const titleFill = Math.max(0, total - 5 - width(title));

	return (
		<Box flexDirection="column">
			<Row
				segments={[
					{text: '╭───', color: accent},
					{text: title, color: accent},
					{text: '─'.repeat(titleFill) + '╮', color: accent},
				]}
			/>
			{Array.from({length: height}, (_, i) => {
				const l = left[i - leftPad] ?? [];
				const r = right[i] ?? [];
				return (
					<Row
						key={i}
						segments={[
							{text: '│', color: accent},
							...fit(l, leftWidth, 'center'),
							{text: '│', color: accent},
							{text: ' '},
							...fit(r, rightWidth - 1, 'left'),
							{text: '│', color: accent},
						]}
					/>
				);
			})}
			<Row segments={[{text: '╰' + '─'.repeat(total - 2) + '╯', color: accent}]} />
		</Box>
	);
}

