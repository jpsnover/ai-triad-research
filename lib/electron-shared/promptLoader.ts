import fs from 'fs';
import path from 'path';

const promptCache = new Map<string, string>();

const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

export function loadPromptWithFragments(
  promptsDir: string,
  promptName: string,
): string {
  if (!SAFE_NAME.test(promptName)) {
    throw new Error(`Invalid prompt name: ${promptName}`);
  }
  const cacheKey = `${promptsDir}:${promptName}`;
  const cached = promptCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const promptPath = path.join(promptsDir, `${promptName}.prompt`);
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt file not found: ${promptPath}`);
  }

  let text = fs.readFileSync(promptPath, 'utf-8');

  text = text.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (match, key: string) => {
    const fragmentPath = path.join(promptsDir, `${key}.fragment.prompt`);
    if (fs.existsSync(fragmentPath)) {
      return fs.readFileSync(fragmentPath, 'utf-8').trimEnd();
    }
    return match;
  });

  promptCache.set(cacheKey, text);
  return text;
}

export function clearPromptCache(): void {
  promptCache.clear();
}
