import {Box, Text} from 'ink';
import {truncate, width} from '../lib/text.js';
import {theme} from './theme.js';

export type Suggestion = {key: string; label: string; hint?: string; badge?: string};

/** The completion list under the prompt (slash commands, room names). */
export function Suggestions({items, selected, columns}: {items: Suggestion[]; selected: number; columns: number}) {
	const labelWidth = Math.min(Math.max(...items.map(i => width(i.label))) + 4, Math.floor(columns / 2));
	return (
		<Box flexDirection="column" paddingLeft={2}>
			{items.map((s, i) => {
				const active = i === selected;
				return (
					<Box key={s.key}>
						<Box width={labelWidth} flexShrink={0}>
							<Text color={active ? theme.suggestion : theme.secondary} bold={active}>
								{truncate(s.label, labelWidth - 2)}
							</Text>
						</Box>
						<Text color={active ? theme.suggestion : theme.secondary} wrap="truncate-end">
							{s.hint ?? ''}
						</Text>
						{s.badge ? <Text color={theme.kakao}> {s.badge}</Text> : null}
					</Box>
				);
			})}
		</Box>
	);
}
