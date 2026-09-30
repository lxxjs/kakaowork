/** KakaoTalk's clock format: "오후 3:28". */
export function formatClock(date: Date): string {
	const hours = date.getHours();
	const period = hours < 12 ? '오전' : '오후';
	const h12 = hours % 12 === 0 ? 12 : hours % 12;
	return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** "2026-09-30" → "2026년 9월 30일 수요일", as on KakaoTalk's date separators. */
export function formatDay(iso: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return iso;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
	return `${year}년 ${month}월 ${day}일 ${weekday}요일`;
}

export function isoDay(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
