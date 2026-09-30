import {Box, Text} from 'ink';
import {pad, width} from '../lib/text.js';
import {theme} from './theme.js';

type Props = {
	columns: number;
	hint?: string;
	room?: {name: string; members?: number};
	totalUnread?: number | null;
	hidden: boolean;
	notify: boolean;
	demo: boolean;
};

export function Footer({columns, hint, room, totalUnread, hidden, notify, demo}: Props) {
	return (
		<Box width={columns} justifyContent="space-between" paddingX={2}>
			<Text color={theme.secondary}>{hint ?? '? for shortcuts'}</Text>
			<Text>
				{demo ? <Text color={theme.warning}>demo · </Text> : null}
				{hidden ? <Text color={theme.secondary}>카톡 숨김 · </Text> : null}
				{notify ? null : <Text color={theme.secondary}>알림 끔 · </Text>}
				{room ? (
					<Text color={theme.accent}>
						⏺ {room.name}
						{room.members ? <Text color={theme.secondary}> · {room.members}명</Text> : null}
					</Text>
				) : (
					<Text color={theme.secondary}>채팅방 없음</Text>
				)}
				{totalUnread ? <Text color={theme.kakao}> · 안 읽음 {totalUnread}</Text> : null}
			</Text>
		</Box>
	);
}

const SHORTCUTS: Array<[string, string]> = [
	['/', '명령어'],
	['⏎', '보내기'],
	['ctrl+c ×2', '종료'],
	['/chats', '채팅방 전환'],
	['\\⏎ · ⌥⏎', '줄바꿈'],
	['esc', '취소'],
	['tab', '자동완성'],
	['↑ ↓', '입력 기록'],
	['pgup', '이전 메시지'],
];

export function Shortcuts({columns}: {columns: number}) {
	const cell = Math.max(20, Math.floor((columns - 4) / 3));
	const rows = [SHORTCUTS.slice(0, 3), SHORTCUTS.slice(3, 6), SHORTCUTS.slice(6, 9)];
	return (
		<Box flexDirection="column" paddingX={2}>
			{rows.map((row, i) => (
				<Text key={i}>
					{row.map(([key, label]) => (
						<Text key={key}>
							<Text>{key}</Text>
							<Text color={theme.secondary}>{pad(' ' + label, cell - width(key))}</Text>
						</Text>
					))}
				</Text>
			))}
		</Box>
	);
}
