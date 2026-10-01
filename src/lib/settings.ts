import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

/** Preferences that outlive a session, e.g. whether to show pictures. */
export type Settings = {images?: 'on' | 'off'};

export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'kakaowork', 'settings.json');
}

export function loadSettings(path = settingsPath()): Settings {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Settings;
	} catch {
		return {};
	}
}

export function saveSettings(patch: Settings, path = settingsPath()): void {
	try {
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, JSON.stringify({...loadSettings(path), ...patch}, null, 2) + '\n');
	} catch {
		// A read-only home just means the choice lasts for this session.
	}
}
