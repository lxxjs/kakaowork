/** KakaoTalk's clock format: "오후 3:28". */
export function formatClock(date: Date): string {
	const hours = date.getHours();
	const period = hours < 12 ? '오전' : '오후';
	const h12 = hours % 12 === 0 ? 12 : hours % 12;
	return `${period} ${h12}:${String(date.getMinutes()).padStart(2, '0')}`;
}
