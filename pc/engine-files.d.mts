// engine-files.mjs の型（pc/bake の TypeScript から使うため）
export const DATA_DIR: string;
export const DEFAULT_UPSTREAM: string;
export const BASE: string;
export function createEngineFiles(options?: { upstream?: string; log?: (...a: unknown[]) => void }): {
  loadManifest(): Promise<unknown>;
  prepareEngine(evalId: 'mini' | 'micro', onStatus?: (text: string) => void): Promise<{ dir: string; id: string; exe: string }>;
};
