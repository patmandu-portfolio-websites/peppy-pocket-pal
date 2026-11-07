export function replyExpression(text = '') {
  // Opening tone cues are deliberately conservative, not a sentiment diagnosis.
  const opening = text.trim().split(/\n/)[0].slice(0, 180);
  if (/\b(?:sorry|unfortunately|error|failed|cannot|can['’]t|not|never|sad|loss|died|danger|emergency)\b/i.test(opening.replace(/\bcan['’]t wait\b/ig, ''))) return 'neutral';
  if (/^(?:wow|whoa|oh wow|oh my|really)[,!?\s]|\b(?:what a surprise|that['’]s surprising|that is surprising|unexpected twist)\b/i.test(opening)) return 'surprised';
  if (/\b(?:hooray|woohoo|yay|so excited|how exciting|that['’]s exciting|that is exciting|can['’]t wait|let['’]s celebrate)\b/i.test(opening)) return 'excited';
  if (/^(?:great|wonderful|fantastic|lovely|excellent|congratulations|congrats|happy to help|glad to help|that['’]s great|that is great)\b/i.test(opening)) return 'happy';
  return 'neutral';
}
