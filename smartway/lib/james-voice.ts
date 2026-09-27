export function wakeCommand(transcript: string): string | null {
  const match = transcript.match(
    /\b(?:james|jhames|jeimes|djeimes|jaimes|djaimes)\b[\s,:.!?-]*/i,
  );
  return match ? transcript.slice(match.index! + match[0].length).trim() : null;
}
export function explicitConfirmation(value: string) {
  return /^(?:sim[, ]+)?confirmar requisi[cç][aã]o[.!]?$/i.test(value.trim());
}
