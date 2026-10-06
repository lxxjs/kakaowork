// Claude Code's dark palette with KakaoTalk yellow as the accent (Claude orange via --theme claude).
export const theme = {
	// KakaoTalk yellow, toned down toward Claude orange's warmth (S ~70%, L ~62%).
	accent: 'rgb(226,196,92)',
	accentShimmer: 'rgb(240,220,152)',
	kakao: 'rgb(226,196,92)',
	blush: 'rgb(255,150,170)',
	text: 'rgb(255,255,255)',
	secondary: 'rgb(153,153,153)',
	border: 'rgb(136,136,136)',
	suggestion: 'rgb(177,185,249)',
	success: 'rgb(78,186,101)',
	error: 'rgb(255,107,128)',
	warning: 'rgb(255,193,7)',
	userBackground: 'rgb(55,55,55)',
};

export type ThemeName = 'kakao' | 'claude';

const accents: Record<ThemeName, {accent: string; accentShimmer: string}> = {
	kakao: {accent: theme.accent, accentShimmer: theme.accentShimmer},
	claude: {accent: 'rgb(215,119,87)', accentShimmer: 'rgb(235,159,127)'},
};

let current: ThemeName = 'kakao';

export function themeName(): ThemeName {
	return current;
}

/** Switches the accent colour; anything else means KakaoTalk yellow. */
export function setTheme(name: string | undefined): ThemeName {
	current = name === 'claude' ? 'claude' : 'kakao';
	Object.assign(theme, accents[current]);
	return current;
}

const senderPalette = [
	'rgb(122,184,245)',
	'rgb(179,157,219)',
	'rgb(128,203,196)',
	'rgb(244,143,177)',
	'rgb(255,204,128)',
	'rgb(165,214,167)',
	'rgb(206,147,216)',
	'rgb(144,202,249)',
];

export function senderColor(name: string): string {
	let hash = 0;
	for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
	return senderPalette[hash % senderPalette.length];
}
