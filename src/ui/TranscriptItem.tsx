import {Box, Text} from 'ink';
import {useMemo, type ReactNode} from 'react';
import type {Message, Thumbnail} from '../bridge/types.js';
import {fitCells, halfBlocks, solidBlocks} from '../lib/image.js';
import {graphics, kittyPicture} from '../lib/kitty.js';
import {width} from '../lib/text.js';
import {formatDay} from '../lib/time.js';
import type {Item} from '../lib/transcript.js';
import {Banner} from './Banner.js';
import {senderColor, theme} from './theme.js';

export type Context = {columns: number; cwd: string; appVersion: string; theme: string};

function Body({message}: {message: Message}) {
	switch (message.kind) {
		case 'photo':
			return <Text color={theme.secondary}>[사진]</Text>;
		case 'emoticon':
			return <Text color={theme.secondary}>[이모티콘]</Text>;
		case 'file':
			return (
				<Text>
					<Text color={theme.secondary}>[파일] </Text>
					{message.text}
					{message.detail ? <Text color={theme.secondary}> · {message.detail}</Text> : null}
				</Text>
			);
		default:
			return <Text>{message.text}</Text>;
	}
}

/**
 * A photo or emoticon, with the time trailing its last line: a real image where the terminal
 * speaks kitty graphics (Ghostty, kitty), half-blocks everywhere else.
 */
function Picture({message, image, available, meta}: {message: Message; image: Thumbnail; available: number; meta: ReactNode}) {
	const sharp = graphics.kitty && Boolean(image.png);
	// Solid cells hold one pixel each, so they get the bigger size to keep some detail.
	const cells = fitCells(image, message.kind, available, sharp || graphics.solid);
	const lines = useMemo(
		() =>
			sharp
				? kittyPicture(image as Thumbnail & {png: string}, cells.columns, cells.rows)
				: graphics.solid
					? solidBlocks(image, cells)
					: halfBlocks(image, cells),
		[image, sharp, cells.columns, cells.rows],
	);
	return (
		<>
			{lines.map((line, i) => (
				<Text key={i} wrap="truncate">
					{line}
					{i === lines.length - 1 ? meta : null}
				</Text>
			))}
		</>
	);
}

function MessageView({item, columns}: {item: Extract<Item, {type: 'message'}>; columns: number}) {
	const m = item.message;

	if (m.kind === 'divider') {
		// A rule with the day centered on it, like KakaoTalk's date separator.
		const span = Math.max(12, Math.min(columns - 4, 56));
		const label = m.date ? ` ${formatDay(m.date)} ` : '';
		const left = Math.max(2, Math.floor((span - width(label)) / 2));
		const right = Math.max(2, span - left - width(label));
		return (
			<Box marginTop={1} paddingLeft={2}>
				<Text color={theme.secondary}>
					{'─'.repeat(left)}
					{label}
					{'─'.repeat(right)}
				</Text>
			</Box>
		);
	}

	if (m.kind === 'system') {
		return (
			<Box marginTop={1} paddingLeft={2}>
				<Text color={theme.secondary}>{m.text}</Text>
			</Box>
		);
	}

	const meta = (
		<>
			{m.unread ? <Text color={theme.kakao}> {m.unread}</Text> : null}
			{item.showTime && m.time ? <Text color={theme.secondary}> {m.time}</Text> : null}
		</>
	);

	const available = Math.max(1, columns - 2 - 12); // bullet gutter, and room for the time
	const picture = graphics.enabled && m.image ? <Picture message={m} image={m.image} available={available} meta={meta} /> : null;

	if (m.mine) {
		// Your own messages sit on a shaded band, like prompts in Claude Code's transcript.
		// Consecutive ones share the band, so a burst reads as one block.
		return (
			<Box marginTop={item.first ? 1 : 0} width={columns} backgroundColor={theme.userBackground}>
				<Box width={2} flexShrink={0}>
					<Text color={theme.secondary}>{item.first ? '❯' : ' '}</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1} flexDirection="column">
					{picture ?? (
						<Text color={theme.text}>
							<Body message={m} />
							{meta}
						</Text>
					)}
				</Box>
			</Box>
		);
	}

	// Everyone else's burst sits under one bullet, like a single Claude Code response.
	const name = m.sender ?? '…';
	return (
		<Box marginTop={item.first ? 1 : 0}>
			<Box width={2} flexShrink={0}>
				<Text color={theme.text}>{item.first ? '⏺' : ' '}</Text>
			</Box>
			<Box flexGrow={1} flexShrink={1} flexDirection="column">
				{picture ? (
					<>
						{item.first && item.group ? (
							<Text bold color={senderColor(name)}>
								{name}
							</Text>
						) : null}
						{picture}
					</>
				) : (
					<Text>
						{item.first && item.group ? (
							<Text bold color={senderColor(name)}>
								{name}{' '}
							</Text>
						) : null}
						<Body message={m} />
						{meta}
					</Text>
				)}
			</Box>
		</Box>
	);
}

function ToolView({item}: {item: Extract<Item, {type: 'tool'}>}) {
	const bullet = item.status === 'ok' ? theme.success : item.status === 'error' ? theme.error : theme.text;
	return (
		<Box flexDirection="column" marginTop={1}>
			<Box>
				<Box width={2} flexShrink={0}>
					<Text color={bullet}>⏺</Text>
				</Box>
				<Text bold>{item.title}</Text>
				{item.arg === undefined ? null : <Text>({item.arg})</Text>}
			</Box>
			{item.lines.map((line, i) => (
				<Box key={i}>
					<Box width={5} flexShrink={0}>
						<Text color={theme.secondary}>{i === 0 ? '  ⎿  ' : '     '}</Text>
					</Box>
					<Text color={item.status === 'error' ? theme.error : theme.secondary}>{line}</Text>
				</Box>
			))}
		</Box>
	);
}

const HELP: Array<[string, string]> = [
	['/chat [이름]', '채팅방 열기 · 이름 없이는 목록에서 고르기 (예: /chat ㄱㅈ)'],
	['/more [개수]', '이전 메시지 더 불러오기 (PgUp)'],
	['/close', '현재 채팅방 닫기'],
	['/notify [on|off]', '다른 방 새 메시지 알림'],
	['/images [on|off]', '사진·이모티콘 그림으로 보기 (기본: 끔)'],
	['/theme [claude|kakao]', '강조색 바꾸기 (Claude 주황 · 카톡 노랑)'],
	['/status', '연결 상태'],
	['/bug [내용]', '버그 신고 (GitHub 이슈 작성 화면 열기)'],
	['/clear', '화면 지우기'],
	['/exit', '종료 (Ctrl+C 두 번)'],
];

function HelpView() {
	return (
		<Box flexDirection="column" marginTop={1}>
			<Box>
				<Box width={2} flexShrink={0}>
					<Text color={theme.accent}>✻</Text>
				</Box>
				<Text bold>KakaoWork</Text>
				<Text color={theme.secondary}> — 터미널에서 쓰는 카카오톡</Text>
			</Box>
			<Box paddingLeft={2} marginTop={1} flexDirection="column">
				{HELP.map(([cmd, desc]) => (
					<Box key={cmd}>
						<Box width={20} flexShrink={0}>
							<Text color={theme.suggestion}>{cmd}</Text>
						</Box>
						<Text color={theme.secondary}>{desc}</Text>
					</Box>
				))}
				<Box marginTop={1}>
					<Text color={theme.secondary}>메시지는 그냥 입력하고 ⏎ · 줄바꿈은 \⏎ 또는 ⌥⏎ · 입력창이 비었을 때 ? 로 단축키 보기</Text>
				</Box>
			</Box>
		</Box>
	);
}

export function TranscriptItem({item, context}: {item: Item; context: Context}) {
	switch (item.type) {
		case 'banner':
			return (
				<Banner
					me={item.me}
					version={item.version}
					appVersion={context.appVersion}
					totalUnread={item.totalUnread}
					recent={item.recent}
					cwd={context.cwd}
					columns={context.columns}
					demo={item.demo}
				/>
			);
		case 'message':
			return <MessageView item={item} columns={context.columns} />;
		case 'tool':
			return <ToolView item={item} />;
		case 'notice':
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Box width={2} flexShrink={0}>
							<Text color={theme.kakao}>⏺</Text>
						</Box>
						<Text bold>{item.room}</Text>
						<Text color={theme.secondary}> · 새 메시지 </Text>
						<Text color={theme.kakao}>{item.count}</Text>
					</Box>
					<Box>
						<Box width={5} flexShrink={0}>
							<Text color={theme.secondary}>{'  ⎿  '}</Text>
						</Box>
						<Text color={theme.secondary} wrap="truncate-end">
							{item.preview}
						</Text>
					</Box>
				</Box>
			);
		case 'text': {
			const color = item.tone === 'error' ? theme.error : item.tone === 'warning' ? theme.warning : theme.secondary;
			return (
				<Box marginTop={1}>
					<Text color={color}>{item.text}</Text>
				</Box>
			);
		}
		case 'prompt':
			return (
				<Box marginTop={1} width={context.columns} backgroundColor={theme.userBackground}>
					<Box width={2} flexShrink={0}>
						<Text color={theme.secondary}>❯</Text>
					</Box>
					<Text color={theme.text}>{item.text}</Text>
				</Box>
			);
		case 'help':
			return <HelpView />;
	}
}
