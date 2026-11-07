function websiteUrl(value) {
  try {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function trimUrl(value) {
  let result = value.replace(/[.,;:!?]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (result.endsWith(close) && result.split(close).length > result.split(open).length) {
      result = result.slice(0, -1).replace(/[.,;:!?]+$/, '');
    }
  }
  return result;
}

export function chatLinks(text) {
  const pattern = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|(?<![\w@])(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  const parts = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    const destination = match[2] || trimUrl(match[0]);
    const url = websiteUrl(destination);
    if (url) {
      parts.push({ text: match[1] || destination, url });
      if (!match[2] && destination.length < match[0].length) parts.push({ text: match[0].slice(destination.length) });
    } else {
      parts.push({ text: match[0] });
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}
