import type {ChatRoom} from '../bridge/types.js';

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

/** "가족" → "ㄱㅈ", so rooms can be found by initial consonants like in KakaoTalk. */
export function chosung(text: string): string {
	let out = '';
	for (const ch of text) {
		const code = ch.charCodeAt(0);
		out += code >= 0xac00 && code <= 0xd7a3 ? CHOSUNG[Math.floor((code - 0xac00) / 588)] : ch;
	}

	return out;
}

function isSubsequence(needle: string, hay: string): boolean {
	let i = 0;
	for (const ch of hay) if (ch === needle[i]) i++;
	return i === needle.length;
}

/** Higher is better; -1 means no match. */
export function score(query: string, name: string): number {
	const q = query.trim().toLowerCase().replace(/\s+/g, '');
	const n = name.toLowerCase().replace(/\s+/g, '');
	if (!q) return 0;
	if (n === q) return 1000;
	if (n.startsWith(q)) return 800 - n.length;
	const at = n.indexOf(q);
	if (at >= 0) return 600 - at;
	const initials = chosung(n);
	if (initials.startsWith(q)) return 500 - n.length;
	if (initials.includes(q)) return 400;
	if (isSubsequence(q, n)) return 200;
	if (isSubsequence(q, initials)) return 100;
	return -1;
}

export function filterRooms(rooms: ChatRoom[], query: string): ChatRoom[] {
	if (!query.trim()) return rooms;
	return rooms
		.map(room => ({room, s: score(query, room.name)}))
		.filter(x => x.s >= 0)
		.sort((a, b) => b.s - a.s || a.room.index - b.room.index)
		.map(x => x.room);
}
