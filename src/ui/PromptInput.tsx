import {Box, Text, useBoxMetrics, useCursor, type DOMElement} from 'ink';
import {useRef} from 'react';
import type {Editor} from '../lib/editor.js';
import {width, wrapRows} from '../lib/text.js';
import {theme} from './theme.js';

type Props = {
	editor: Editor;
	placeholder: string;
	columns: number;
	focused: boolean;
};

type VisualRow = {text: string; first: boolean};

export function layout(editor: Editor, columns: number) {
	const max = Math.max(8, columns - 3);
	const rows: VisualRow[] = [];
	let caret = {row: 0, column: 0};
	let offset = 0;
	const lines = editor.value.split('\n');
	lines.forEach((line, lineIndex) => {
		const wrapped = wrapRows(line, max);
		wrapped.forEach((row, rowIndex) => {
			const start = offset + row.start;
			const last = rowIndex === wrapped.length - 1;
			const endOfRow = start + row.text.length;
			if (editor.cursor >= start && (editor.cursor < endOfRow || (last && editor.cursor <= endOfRow))) {
				caret = {row: rows.length, column: width(row.text.slice(0, editor.cursor - start))};
			}

			rows.push({text: row.text, first: lineIndex === 0 && rowIndex === 0});
		});
		offset += line.length + 1;
	});
	return {rows, caret};
}

/**
 * The prompt between two rules, like Claude Code's.
 * The real terminal cursor is parked at the caret so Korean IME composition shows in place.
 */
export function PromptInput({editor, placeholder, columns, focused}: Props) {
	const ref = useRef<DOMElement>(null);
	const metrics = useBoxMetrics(ref);
	const {setCursorPosition} = useCursor();
	const {rows, caret} = layout(editor, columns);

	setCursorPosition(focused && metrics.hasMeasured ? {x: 2 + caret.column, y: metrics.top + 1 + caret.row} : undefined);

	const rule = '─'.repeat(Math.max(1, columns));
	return (
		<Box ref={ref} flexDirection="column" marginTop={1}>
			<Text color={theme.border}>{rule}</Text>
			{editor.value === '' ? (
				<Box>
					<Text color={theme.secondary}>{'> '}</Text>
					<Text color={theme.secondary} wrap="truncate-end">
						{placeholder}
					</Text>
				</Box>
			) : (
				rows.map((row, i) => (
					<Box key={i}>
						<Text color={theme.secondary}>{row.first ? '> ' : '  '}</Text>
						<Text>{row.text}</Text>
					</Box>
				))
			)}
			<Text color={theme.border}>{rule}</Text>
		</Box>
	);
}
