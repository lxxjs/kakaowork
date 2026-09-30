import {Box, Text} from 'ink';
import {useEffect, useState} from 'react';
import {graphemes} from '../lib/text.js';
import {theme} from './theme.js';

const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'];
const CYCLE = [...FRAMES, ...[...FRAMES].reverse()];

/** Claude Code's "✻ Thinking… (3s · esc to interrupt)" line, with the moving shimmer. */
export function Spinner({label, since}: {label: string; since: number}) {
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
			<Text color={theme.secondary}> ({seconds}s · esc to interrupt)</Text>
		</Box>
	);
}
