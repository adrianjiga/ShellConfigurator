/** Makes `process.platform` read `platform` until the returned function puts it back. */
export function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  return () => Object.defineProperty(process, 'platform', { value: original });
}
