import {Box, Text, useBoxMetrics, useCursor, type DOMElement} from 'ink';
import {useRef} from 'react';
import type {ChatRoom} from '../bridge/types.js';
import type {Editor} from '../lib/editor.js';
import {pad, truncate, width} from '../lib/text.js';
import {theme} from './theme.js';

type Props = {
	rooms: ChatRoom[];
	query: Editor;
	selected: number;
	loading: boolean;
	columns: number;
	visible: number;
};

function unreadLabel(n: number) {
	return n > 999 ? '999+' : String(n);
}

/** Room switcher, styled after Claude Code's /resume picker. */
export function Picker({rooms, query, selected, loading, columns, visible}: Props) {
	const ref = useRef<DOMElement>(null);
	const metrics = useBoxMetrics(ref);
	const {setCursorPosition} = useCursor();
	const prompt = '검색: ';
	setCursorPosition(metrics.hasMeasured ? {x: 2 + width(prompt) + width(query.value.slice(0, query.cursor)), y: metrics.top + 2} : undefined);

	const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), rooms.length - visible));
	const shown = rooms.slice(start, start + visible);
	const rightWidth = 16;
	const nameWidth = Math.max(10, columns - 4 - rightWidth - 2);

	return (
		<Box ref={ref} flexDirection="column" marginTop={1}>
			<Text color={theme.border}>{'─'.repeat(Math.max(1, columns))}</Text>
			<Box paddingLeft={2} flexDirection="column">
				<Text>
					<Text bold color={theme.accent}>채팅방 선택</Text>
					<Text color={theme.secondary}>  {loading ? '불러오는 중…' : `${rooms.length}개`}</Text>
				</Text>
				<Text>
					<Text color={theme.secondary}>{prompt}</Text>
					{query.value ? <Text>{query.value}</Text> : <Text color={theme.secondary} dimColor>이름 또는 초성 (예: ㄱㅈ)</Text>}
				</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{shown.length === 0 ? (
					<Text color={theme.secondary}>  {loading ? '' : '일치하는 채팅방이 없습니다'}</Text>
				) : (
					shown.map((room, i) => {
						const active = start + i === selected;
						const members = room.members ? ` ${room.members}` : '';
						const name = truncate(room.name, nameWidth - width(members));
						const unread = room.unread > 0 ? unreadLabel(room.unread) : '';
						return (
							<Box key={`${room.name}-${room.index}`}>
								<Text color={active ? theme.suggestion : undefined}>{active ? '❯ ' : '  '}</Text>
								<Box width={nameWidth} flexShrink={0}>
									<Text color={active ? theme.suggestion : undefined} bold={room.unread > 0}>
										{name}
									</Text>
									<Text color={theme.secondary}>{members}</Text>
								</Box>
								<Text color={theme.secondary}>{pad(truncate(room.time, 10), 11)}</Text>
								<Text color={room.muted ? theme.secondary : theme.kakao}>{unread}</Text>
							</Box>
						);
					})
				)}
			</Box>
			<Box paddingLeft={2} marginTop={1}>
				<Text color={theme.secondary}>↑↓ 이동 · ⏎ 열기 · esc 취소</Text>
			</Box>
		</Box>
	);
}
