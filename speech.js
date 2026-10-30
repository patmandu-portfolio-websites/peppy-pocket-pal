import { speechVoices } from './voiceOptions.js';

export function createSpeechHandler(createClient) {
  return async (req, res) => {
    const { text, voice } = req.body || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 4096 || !speechVoices.includes(voice)) {
      return res.status(400).json({ error: 'Choose a supported voice and provide between 1 and 4096 characters to read aloud.' });
    }
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Add your OpenAI API key to enable spoken replies.' });
    res.set('Cache-Control', 'no-store');
    try {
      const response = await createClient().audio.speech.create({
        model: process.env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
        voice,
        input: text.trim(),
        instructions: 'Speak warmly and naturally, like a friendly conversational companion. Use relaxed pacing, expressive but subtle intonation, and gentle pauses. Avoid sounding like an announcer. Read the supplied text without adding words.',
        response_format: 'mp3'
      });
      const audio = Buffer.from(await response.arrayBuffer());
      res.type('audio/mpeg').send(audio);
    } catch (error) {
      console.error('Speech request failed:', error?.message || error);
      res.status(502).json({ error: 'Peppy could not generate speech. Check your API billing and speech-model access, then try again. Your text reply is still available.' });
    }
  };
}
