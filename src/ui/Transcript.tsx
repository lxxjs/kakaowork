import {Box, useBoxMetrics, type DOMElement} from 'ink';
import {memo, useEffect, useRef} from 'react';
import type {Item} from '../lib/transcript.js';
import {TranscriptItem, type Context} from './TranscriptItem.js';

type Props = {
	items: Item[];
	context: Context;
	/** Lines scrolled up from the bottom; 0 follows the newest message. */
	scroll: number;
	onMetrics: (contentHeight: number, viewportHeight: number) => void;
};

const Items = memo(function Items({items, context}: {items: Item[]; context: Context}) {
	return (
		<>
			{items.map(it => (
				<TranscriptItem key={it.id} item={it} context={context} />
			))}
		</>
	);
});

/**
 * The conversation, drawn inside the app rather than into terminal scrollback (the app runs
 * on the alternate screen so quitting leaves the terminal as it was). Content is pinned to
 * the bottom of the viewport; a negative bottom margin slides it down to reveal older lines.
 */
export function Transcript({items, context, scroll, onMetrics}: Props) {
	const viewportRef = useRef<DOMElement>(null);
	const contentRef = useRef<DOMElement>(null);
	const viewport = useBoxMetrics(viewportRef);
	const content = useBoxMetrics(contentRef);

	useEffect(() => {
		if (viewport.hasMeasured && content.hasMeasured) onMetrics(content.height, viewport.height);
	}, [content.height, viewport.height, viewport.hasMeasured, content.hasMeasured]);

	return (
		<Box ref={viewportRef} flexGrow={1} flexShrink={1} flexBasis={0} flexDirection="column" justifyContent="flex-end" overflow="hidden">
			<Box ref={contentRef} flexDirection="column" flexShrink={0} marginBottom={-scroll}>
				<Items items={items} context={context} />
			</Box>
		</Box>
	);
}
