import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createSpeechHandler } from './speech.js';

const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_SPEECH_MODEL;
after(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_SPEECH_MODEL;
  else process.env.OPENAI_SPEECH_MODEL = originalModel;
});

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    type(value) { this.contentType = value; return this; },
    send(body) { this.body = body; return this; }
  };
}

test('rejects invalid text and voices without making paid requests', async () => {
  const handler = createSpeechHandler(() => { throw new Error('Must not call OpenAI'); });
  for (const body of [undefined, {}, { text: ' ', voice: 'marin' }, { text: 1, voice: 'marin' }, { text: 'Hi', voice: 'invalid' }, { text: 'x'.repeat(4097), voice: 'marin' }]) {
    const res = response();
    await handler({ body }, res);
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.error);
  }
});

test('reports missing API key', async () => {
  delete process.env.OPENAI_API_KEY;
  const res = response();
  await createSpeechHandler(() => { throw new Error('Must not call OpenAI'); })({ body: { text: 'Hi', voice: 'marin' } }, res);
  assert.equal(res.statusCode, 503);
});

test('returns MP3 with selected voice and natural delivery instructions', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_SPEECH_MODEL;
  let request;
  const handler = createSpeechHandler(() => ({
    audio: { speech: { create: async input => {
      request = input;
      return { arrayBuffer: async () => Uint8Array.from([73, 68, 51]).buffer };
    } } }
  }));
  const res = response();
  await handler({ body: { text: ' Hello Peppy! ', voice: 'cedar' } }, res);
  assert.equal(request.model, 'gpt-4o-mini-tts');
  assert.equal(request.voice, 'cedar');
  assert.equal(request.input, 'Hello Peppy!');
  assert.match(request.instructions, /naturally/);
  assert.equal(request.response_format, 'mp3');
  assert.equal(res.contentType, 'audio/mpeg');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, Buffer.from('ID3'));
  process.env.OPENAI_SPEECH_MODEL = 'compatible-speech-model';
  await handler({ body: { text: 'x'.repeat(4096), voice: 'marin' } }, response());
  assert.equal(request.model, 'compatible-speech-model');
  assert.equal(request.input.length, 4096);
});

test('reports upstream failure explicitly', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const res = response();
    await createSpeechHandler(() => ({ audio: { speech: { create: async () => { throw new Error('No speech access'); } } } }))({ body: { text: 'Hi', voice: 'marin' } }, res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body.error, /billing and speech-model access/);
    assert.equal(logs.length, 1);
  } finally {
    console.error = originalError;
  }
});
