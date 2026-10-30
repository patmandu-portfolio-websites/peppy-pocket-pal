export function parseVoiceSend(results, draft, enabled) {
  const transcript = Array.from(results, result => result[0].transcript).join(' ').trim();
  const command = enabled && Array.from(results).every(result => result.isFinal)
    ? /(?:^|[\s,.!?;:])peppy[\s,]+send[.!?,;:\s]*$/i.exec(transcript)
    : null;
  const spoken = command ? transcript.slice(0, command.index).trim() : transcript;
  return {
    text: [draft.trim(), spoken].filter(Boolean).join(' '),
    command: Boolean(command)
  };
}
