import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as ed from '../dist/lib/editor.js';
import {chosung, filterRooms, score} from '../dist/lib/fuzzy.js';
import {fitCells, halfBlocks} from '../dist/lib/image.js';
import {formatDay} from '../dist/lib/time.js';
import {applyUnread, fillTimes, firstUnreadRow, Grouper, settleTimes} from '../dist/lib/transcript.js';
import {width, wrapRows} from '../dist/lib/text.js';
import {layout} from '../dist/ui/PromptInput.js';

test('editor edits around wide and multi-code-unit characters', () => {
	let e = ed.insert(ed.emptyEditor, '안녕👋하세요');
	assert.equal(e.cursor, e.value.length);
	e = ed.left(ed.left(ed.left(e)));
	e = ed.backspace(e); // removes the whole emoji (a surrogate pair), not half of it
	assert.equal(e.value, '안녕하세요');
	e = ed.insert(ed.home(e), '> ');
	assert.equal(e.value, '> 안녕하세요');
});

test('editor word and line kills', () => {
	let e = ed.fromText('hello big world');
	e = ed.deleteWordBack(e);
	assert.equal(e.value, 'hello big ');
	e = ed.killToLineStart(e);
	assert.deepEqual(e, {value: '', cursor: 0});
	e = ed.killToLineEnd({value: 'ab\ncd', cursor: 1});
	assert.equal(e.value, 'a\ncd');
});

test('editor moves between lines and reports the edges', () => {
	const e = {value: 'first\nsecond line', cursor: 3};
	assert.equal(ed.vertical(e, -1), null);
	const down = ed.vertical(e, 1);
	assert.equal(down.cursor, 'first\n'.length + 3);
	assert.equal(ed.vertical(down, 1), null);
});

test('insert strips control characters but keeps newlines', () => {
	assert.equal(ed.insert(ed.emptyEditor, 'a\u0007b\r\nc').value, 'ab\nc');
});

test('chosung search finds rooms by initial consonants', () => {
	assert.equal(chosung('가족 모임'), 'ㄱㅈ ㅁㅇ');
	const rooms = [
		{index: 0, name: '개발팀', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
		{index: 1, name: '가족', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
		{index: 2, name: 'Design Sync', unread: 0, time: '', preview: '', muted: false, kind: 'group'},
	];
	assert.deepEqual(filterRooms(rooms, 'ㄱㅈ').map(r => r.name), ['가족']);
	assert.deepEqual(filterRooms(rooms, 'ㄱ').map(r => r.name), ['가족', '개발팀']);
	assert.deepEqual(filterRooms(rooms, 'dsync').map(r => r.name), ['Design Sync']);
	assert.ok(score('가족', '가족') > score('가', '가족'));
	assert.equal(score('zzz', '가족'), -1);
});

const m = (text, extra = {}) => ({row: 0, kind: 'text', mine: false, text, ...extra});

test('fillTimes gives a run the time of its labelled last bubble', () => {
	const out = fillTimes([
		m('a', {sender: '민지'}),
		m('b', {sender: '민지', time: '오후 3:25'}),
		m('c', {mine: true}),
		m('d', {mine: true, time: '오후 3:27'}),
		m('', {kind: 'divider'}),
		m('e', {sender: '민지'}),
	]);
	assert.deepEqual(out.map(x => x.time), ['오후 3:25', '오후 3:25', '오후 3:27', '오후 3:27', undefined, undefined]);
});

test('Grouper folds a sender\'s consecutive bubbles within a minute into one block', () => {
	const g = new Grouper(true);
	const items = [
		m('a', {sender: '민지', time: '오후 3:25'}),
		m('b', {sender: '민지', time: '오후 3:25'}),
		m('c', {sender: '민지', time: '오후 3:26'}),
		m('d', {sender: '지수', time: '오후 3:26'}),
		m('e', {mine: true, time: '오후 3:26'}),
		m('f', {mine: true, time: '오후 3:26'}),
	].map(x => g.next(x));
	assert.deepEqual(items.map(i => i.first), [true, false, true, true, true, false]);
});

test('settleTimes labels only the last bubble of a sender\'s minute, like KakaoTalk', () => {
	const g = new Grouper(true);
	const items = settleTimes(
		[
			m('a', {sender: '민지', time: '오후 3:25'}),
			m('b', {sender: '민지', time: '오후 3:25'}),
			m('c', {sender: '민지', time: '오후 3:26'}),
			m('d', {sender: '지수', time: '오후 3:26'}),
			m('e', {mine: true, time: '오후 3:26'}),
			m('', {kind: 'divider'}),
			m('f', {mine: true, time: '오후 3:26'}),
		].map(x => g.next(x)),
	);
	assert.deepEqual(items.map(i => i.showTime), [false, true, true, true, true, false, true]);

	// A bubble arriving in the same minute takes the label from the one before it.
	const more = settleTimes([...items, g.next(m('g', {mine: true, time: '오후 3:26'}))]);
	assert.deepEqual(more.map(i => i.showTime), [false, true, true, true, true, false, false, true]);
	assert.equal(more[0], items[0], 'unchanged items are kept as they were');
});

test('applyUnread refreshes counts, lining rows up by content when they have moved', () => {
	const g = new Grouper(false);
	const items = [
		m('a', {row: 3, mine: true, unread: 2}),
		m('b', {row: 4, mine: true, unread: 2}),
		m('c', {row: -1, mine: true}),
	].map(x => g.next(x));
	assert.equal(firstUnreadRow(items), 3);

	const fresh = applyUnread(items, [
		{row: 3, kind: 'text', mine: true, text: 'a', unread: 1},
		{row: 4, kind: 'text', mine: true, text: 'b', unread: 0},
	]);
	assert.deepEqual(fresh.map(i => i.message.unread), [1, undefined, undefined]);
	assert.equal(fresh[2], items[2]);

	// Older history loaded above pushed everything down by ten rows.
	const shifted = applyUnread(items, [
		{row: 13, kind: 'text', mine: true, text: 'a', unread: 0},
		{row: 14, kind: 'text', mine: true, text: 'b', unread: 1},
	]);
	assert.deepEqual(shifted.map(i => [i.message.row, i.message.unread]), [[13, undefined], [14, 1], [-1, undefined]]);

	assert.equal(applyUnread(items, [{row: 4, kind: 'text', mine: true, text: 'zzz', unread: 0}]), items);
});

test('wrapRows breaks by display width, not code units', () => {
	const rows = wrapRows('가나다라마', 4);
	assert.deepEqual(rows.map(r => r.text), ['가나', '다라', '마']);
	assert.deepEqual(rows.map(r => r.start), [0, 2, 4]);
});

test('prompt layout puts the caret on the right wrapped row and column', () => {
	const value = '가나다라마바사\nab';
	const {rows, caret} = layout({value, cursor: 5}, 11);
	assert.deepEqual(rows.map(r => r.text), ['가나다라', '마바사', 'ab']);
	assert.deepEqual(caret, {row: 1, column: 2});
	assert.deepEqual(layout({value, cursor: 4}, 11).caret, {row: 1, column: 0});
	assert.deepEqual(layout({value, cursor: value.length}, 11).caret, {row: 2, column: 2});
});

test('formatDay spells out a separator date with its weekday', () => {
	assert.equal(formatDay('2026-09-30'), '2026년 9월 30일 수요일');
	assert.equal(formatDay('2026-01-04'), '2026년 1월 4일 일요일');
	assert.equal(formatDay('not a date'), 'not a date');
});

test('halfBlocks draws two pixels per cell and measures exactly its column count', () => {
	// 2×4: left column red over blue (twice), right column all green.
	const px = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 255, 0]];
	const image = {w: 2, h: 4, rgb: Buffer.from(px.flat()).toString('base64')};
	const lines = halfBlocks(image, {columns: 2, rows: 2});
	assert.equal(lines.length, 2);
	for (const line of lines) assert.equal(width(line), 2);
	assert.equal(lines[0], '\u001B[38;2;255;0;0;48;2;0;0;255m▀\u001B[38;2;0;255;0;48;2;0;255;0m▀\u001B[39;49m');
});

test('halfBlocks averages when shrinking', () => {
	const image = {w: 2, h: 2, rgb: Buffer.from([0, 0, 0, 200, 100, 50, 0, 0, 0, 200, 100, 50]).toString('base64')};
	assert.equal(halfBlocks(image, {columns: 1, rows: 1})[0], '\u001B[38;2;100;50;25;48;2;100;50;25m▀\u001B[39;49m');
});

test('fitCells keeps pictures within 30 columns and 5 rows, preserving shape', () => {
	assert.deepEqual(fitCells({w: 96, h: 64}, 'photo', 80), {columns: 15, rows: 5}); // 3:2 is height-bound
	assert.deepEqual(fitCells({w: 96, h: 16}, 'photo', 80), {columns: 30, rows: 3}); // panorama is width-bound
	assert.deepEqual(fitCells({w: 96, h: 16}, 'photo', 10), {columns: 10, rows: 1}); // narrow terminal
	assert.deepEqual(fitCells({w: 72, h: 96}, 'photo', 80), {columns: 8, rows: 5});
	assert.deepEqual(fitCells({w: 48, h: 48}, 'emoticon', 80), {columns: 5, rows: 3}); // emoticons stay small
});

import {inflateSync} from 'node:zlib';
import stringWidth from 'string-width';
import {detectKitty, placeholderLines, transmit} from '../dist/lib/kitty.js';
import {DIACRITICS} from '../dist/lib/kitty-diacritics.js';
import {encodePng} from '../dist/lib/png.js';

test('kitty placeholders: one cell per column, row and column marks, id in the colour', () => {
	const lines = placeholderLines(0x010203, 3, 2);
	assert.equal(lines.length, 2);
	assert.ok(lines[0].startsWith('\u001B[38;2;1;2;3m') && lines[0].endsWith('\u001B[39m'));
	const cells = [...lines[1].slice('\u001B[38;2;1;2;3m'.length, -'\u001B[39m'.length)];
	assert.deepEqual(cells, [0, 1, 2].flatMap(column => ['\u{10EEEE}', DIACRITICS[1], DIACRITICS[column]]));
	assert.equal(stringWidth(lines[0]), 3);
	assert.equal(DIACRITICS.length, 297);
});

test('kitty transmit splits base64 into 4096-byte chunks, keys only on the first', () => {
	const chunks = transmit(7, 'A'.repeat(9000), 20, 6).split('\u001B\\').filter(Boolean);
	assert.equal(chunks.length, 3);
	assert.ok(chunks[0].startsWith('\u001B_Ga=T,U=1,f=100,t=d,q=2,i=7,c=20,r=6,m=1;'));
	assert.ok(chunks[1].startsWith('\u001B_Gm=1;'));
	assert.ok(chunks[2].startsWith('\u001B_Gm=0;'));
});

test('detectKitty: Ghostty and kitty yes, others no, env override wins', () => {
	assert.equal(detectKitty({TERM_PROGRAM: 'ghostty'}), true);
	assert.equal(detectKitty({TERM: 'xterm-kitty'}), true);
	assert.equal(detectKitty({TERM_PROGRAM: 'iTerm.app'}), false);
	assert.equal(detectKitty({TERM_PROGRAM: 'ghostty', KAKAOWORK_IMAGES: 'blocks'}), false);
});

test('encodePng writes a valid RGB PNG', () => {
	const png = encodePng(2, 1, Uint8Array.from([255, 0, 0, 0, 0, 255]));
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const idat = png.indexOf('IDAT');
	const length = png.readUInt32BE(idat - 4);
	assert.deepEqual([...inflateSync(png.subarray(idat + 4, idat + 4 + length))], [0, 255, 0, 0, 0, 0, 255]);
});

import {solidBlocks} from '../dist/lib/image.js';
import {detectSolid} from '../dist/lib/kitty.js';

test('solidBlocks paints one background-coloured space per cell', () => {
	const image = {w: 2, h: 2, rgb: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]).toString('base64')};
	const lines = solidBlocks(image, {columns: 2, rows: 2});
	assert.deepEqual(lines, ['\u001B[48;2;255;0;0m \u001B[48;2;0;255;0m \u001B[49m', '\u001B[48;2;0;0;255m \u001B[48;2;255;255;255m \u001B[49m']);
	assert.equal(stringWidth(lines[0]), 2);
});

test('detectSolid: Apple Terminal, unless overridden', () => {
	assert.equal(detectSolid({TERM_PROGRAM: 'Apple_Terminal'}), true);
	assert.equal(detectSolid({TERM_PROGRAM: 'Apple_Terminal', KAKAOWORK_IMAGES: 'blocks'}), false);
	assert.equal(detectSolid({TERM_PROGRAM: 'iTerm.app'}), false);
});

import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {imagesEnabled} from '../dist/lib/kitty.js';
import {loadSettings, saveSettings} from '../dist/lib/settings.js';

test('imagesEnabled: off unless the flag, the env or the saved setting turns it on', () => {
	assert.equal(imagesEnabled(undefined, {}, undefined), false);
	assert.equal(imagesEnabled(undefined, {}, 'on'), true);
	assert.equal(imagesEnabled('on', {}, 'off'), true);
	assert.equal(imagesEnabled('off', {KAKAOWORK_IMAGES: 'kitty'}, 'on'), false);
	assert.equal(imagesEnabled(undefined, {KAKAOWORK_IMAGES: 'solid'}, 'off'), true);
	assert.equal(imagesEnabled(undefined, {KAKAOWORK_IMAGES: 'off'}, 'on'), false);
});

test('settings are saved as JSON and merged', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'kw-')), 'nested', 'settings.json');
	assert.deepEqual(loadSettings(path), {});
	saveSettings({images: 'on'}, path);
	assert.deepEqual(loadSettings(path), {images: 'on'});
	saveSettings({images: 'off'}, path);
	assert.deepEqual(loadSettings(path), {images: 'off'});
});
