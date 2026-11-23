export const microlearningKey = 'peppy-microlearning-v1';

export const learningTopics = [
  'Personal Development', 'Motivation & Inspiration', 'Health', 'Psychology', 'Productivity',
  'Habits', 'Problem Solving', 'Communication', 'Mental Health', 'Learning & Education',
  'Time Management', 'Business', 'Philosophy', 'Leadership & Management', 'Mindfulness',
  'Marketing & Sales', 'Love & Relationships', 'Career', 'Science & Nature', 'Technology & The Future',
  'Meditation', 'Economics', 'Money & Investments', 'Society, Arts & Culture', 'Exercise & Fitness',
  'Reading & Writing', 'Artificial Intelligence', 'Entrepreneurship', 'Cybersecurity',
  'Religion & Spirituality', 'Creativity', 'Startups', 'Teamwork', 'Human Resources',
  'Cryptocurrency', 'Computer Science', 'Strategy', 'Entertainment', 'Remote Work',
  'Corporate Culture', 'Food', 'Product & Design'
];

export const emptyMicrolearning = () => ({ cards: [], stashes: [], plan: null });

function validImage(image) {
  if (!image || !['ai', 'commons'].includes(image.kind) || typeof image.data !== 'string' ||
      image.data.length > 200000 || !/^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return false;
  if (image.kind === 'ai') return true;
  if (['title', 'creator', 'license'].some(field => typeof image[field] !== 'string' || !image[field].trim() || image[field].length > 300)) return false;
  if (typeof image.sourceUrl !== 'string' || image.sourceUrl.length > 2048 ||
      typeof image.licenseUrl !== 'string' || image.licenseUrl.length > 2048) return false;
  try {
    const source = new URL(image.sourceUrl);
    const license = new URL(image.licenseUrl);
    return source.protocol === 'https:' && source.hostname === 'commons.wikimedia.org' && !source.username && !source.password &&
      source.pathname.startsWith('/wiki/File:') && license.protocol === 'https:' &&
      license.hostname === 'creativecommons.org' && !license.username && !license.password;
  } catch { return false; }
}

export function readMicrolearning(raw) {
  if (!raw) return emptyMicrolearning();
  const data = JSON.parse(raw);
  if (!data || !Array.isArray(data.cards) || !Array.isArray(data.stashes) ||
      !(data.plan === null || (data.plan && typeof data.plan === 'object'))) {
    throw new Error('Invalid microlearning data.');
  }
  for (const stash of data.stashes) {
    if (!stash || typeof stash.id !== 'string' || typeof stash.name !== 'string') throw new Error('Invalid stash.');
  }
  for (const card of data.cards) {
    if (!card || typeof card.id !== 'string' || typeof card.title !== 'string' ||
        typeof card.content !== 'string' || typeof card.source !== 'string' ||
        !learningTopics.includes(card.topic) || !Array.isArray(card.stashIds) ||
        card.stashIds.some(id => typeof id !== 'string') ||
        (card.image !== undefined && !validImage(card.image))) throw new Error('Invalid idea card.');
  }
  if (data.plan && (typeof data.plan.goal !== 'string' || !Array.isArray(data.plan.interests) ||
      data.plan.interests.some(topic => !learningTopics.includes(topic)) ||
      !Array.isArray(data.plan.cardIds) || data.plan.cardIds.some(id => typeof id !== 'string') ||
      !Array.isArray(data.plan.actions) || data.plan.actions.some(action => typeof action !== 'string'))) {
    throw new Error('Invalid growth plan.');
  }
  return data;
}

export function validateCard(card) {
  for (const [field, limit] of [['title', 120], ['content', 1200], ['source', 500]]) {
    if (typeof card[field] !== 'string' || !card[field].trim() || card[field].trim().length > limit) {
      throw new Error(`${field[0].toUpperCase() + field.slice(1)} must contain 1-${limit} characters.`);
    }
  }
  if (!learningTopics.includes(card.topic)) throw new Error('Choose a topic.');
  if (!Array.isArray(card.stashIds) || card.stashIds.some(id => typeof id !== 'string')) throw new Error('Invalid stash selection.');
  if (card.image !== undefined && !validImage(card.image)) throw new Error('Invalid card image.');
  return { ...card, title: card.title.trim(), content: card.content.trim(), source: card.source.trim() };
}
