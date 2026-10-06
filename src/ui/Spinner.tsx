import {Box, Text} from 'ink';
import {useEffect, useState} from 'react';
import {graphemes} from '../lib/text.js';
import {theme} from './theme.js';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const CYCLE = [...FRAMES, ...[...FRAMES].reverse()];

/** Claude Code's "✻ Thinking… (3s · esc to interrupt)" line, with the moving shimmer. */
export function Spinner({label, since, hint = 'esc to interrupt'}: {label: string; since: number; hint?: string}) {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => setTick(t => t + 1), 120);
		return () => clearInterval(timer);
	}, []);

	const chars = graphemes(label + '…');
	const head = tick % (chars.length + 8);
	const seconds = Math.floor((Date.now() - since) / 1000);

	return (
		<Box marginTop={1}>
			<Box width={2} flexShrink={0}>
				<Text color={theme.accent}>{CYCLE[tick % CYCLE.length]}</Text>
			</Box>
			<Text>
				{chars.map((ch, i) => (
					<Text key={i} color={Math.abs(i - head) <= 1 ? theme.accentShimmer : theme.accent}>
						{ch}
					</Text>
				))}
			</Text>
			<Text color={theme.secondary}>
				{' '}
				({seconds}s{hint ? ` · ${hint}` : ''})
			</Text>
		</Box>
	);
}

const TYPING = [
	'답장 쓰는 중',
	'타자 치는 중',
	'말 고르는 중',
	'썼다 지웠다 하는 중',
	'생각 정리하는 중',
	'뜸 들이는 중',
	'문장 다듬는 중',
	'이모티콘 고르는 중',
	'맞춤법 고치는 중',
	'할 말 떠올리는 중',
];

function another(current?: string): string {
	const rest = TYPING.filter(word => word !== current);
	return rest[Math.floor(Math.random() * rest.length)];
}

/** Shown while the other side is typing: the thinking line, with a new guess at what they are up to every few seconds. */
export function TypingSpinner({since}: {since: number}) {
	const [word, setWord] = useState(() => another());
	useEffect(() => {
		const timer = setInterval(() => setWord(another), 4000);
		return () => clearInterval(timer);
	}, []);

	return <Spinner label={word} since={since} hint="" />;
}
