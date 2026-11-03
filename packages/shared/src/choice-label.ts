/** Presentation only: canonical choices remain the stored and wire values. */
export function choiceLabel(
  value: string,
  labels?: Record<string, string> | null,
  t: (text: string) => string = text => text,
): string {
  const legacy = t(value)
  if (legacy !== value) return legacy
  return t(labels && Object.hasOwn(labels, value) ? labels[value] : value)
}
