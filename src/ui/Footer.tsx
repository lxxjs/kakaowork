import {Box, Text} from 'ink';
import {Fragment, type ReactNode} from 'react';
import type {ChatRoom} from '../bridge/types.js';
import {theme} from './theme.js';

type Props = {
	columns: number;
	hint?: string;
	room?: ChatRoom;
	totalUnread?: number | null;
	hidden: boolean;
	notify: boolean;
	demo: boolean;
};

function roomLabel(room: ChatRoom): string {
	switch (room.kind) {
		case 'me':
			return '나와의 채팅';
		case 'direct':
			return '1:1 채팅';
		case 'open':
			return room.members ? `오픈채팅 ${room.members}명` : '오픈채팅';
		default:
			return room.members ? `멤버 ${room.members}명` : '단체 채팅';
	}
}

/**
 * The line under the prompt, drawn like a Claude Code status line: colored segments
 * split by a dim bar, two columns in from the edge.
 */
export function StatusLine({columns, hint, room, totalUnread, hidden, notify, demo}: Props) {
	const segments: ReactNode[] = [];
	if (room) {
		segments.push(<Text color="cyan">{room.name}</Text>, <Text color="blue">{roomLabel(room)}</Text>);
	} else {
		segments.push(<Text dimColor>채팅방 없음</Text>);
	}

	if (totalUnread) {
		segments.push(
			<Text>
				<Text dimColor>안 읽음 </Text>
				<Text color="yellow">{totalUnread}</Text>
			</Text>,
		);
	}

	if (!hidden) segments.push(<Text color="magenta">카톡 창 표시 중</Text>);
	if (!notify) segments.push(<Text dimColor>알림 끔</Text>);
	if (demo) segments.push(<Text color="yellow">demo</Text>);

	return (
		<Box width={columns} justifyContent="space-between" paddingX={2}>
			<Text wrap="truncate-end">
				{segments.map((segment, i) => (
					<Fragment key={i}>
						{i > 0 ? <Text dimColor> | </Text> : null}
						{segment}
					</Fragment>
				))}
			</Text>
			{hint ? <Text color={theme.secondary}>{hint}</Text> : null}
		</Box>
	);
}
