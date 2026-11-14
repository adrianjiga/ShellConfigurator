export function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  return () => Object.defineProperty(process, 'platform', { value: original });
}
