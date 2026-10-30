import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseVoiceSend } from './voiceCommand.js';

function result(text, isFinal = true) {
  return Object.assign([{ transcript: text }], { isFinal });
}

test('recognizes a final trailing command and preserves an existing draft', () => {
  assert.deepEqual(parseVoiceSend([result('How are you? Peppy, send!')], 'Hello', true), { text: 'Hello How are you?', command: true });
  assert.deepEqual(parseVoiceSend([result('Hello'), result('PEPPY SEND.')], '', true), { text: 'Hello', command: true });
});

test('does not send disabled, interim, non-trailing, or partial word commands', () => {
  for (const [results, enabled] of [
    [[result('Hi Peppy send')], false],
    [[result('Hi Peppy send', false)], true],
    [[result('Hi', false), result('Peppy send')], true],
    [[result('Peppy send a postcard')], true],
    [[result('Hi notpeppy send')], true]
  ]) assert.equal(parseVoiceSend(results, '', enabled).command, false);
  assert.equal(parseVoiceSend([result('Hi Peppy send')], '', false).text, 'Hi Peppy send');
});

test('handles empty commands and command-only sending of an existing draft', () => {
  assert.deepEqual(parseVoiceSend([result('Peppy, send!')], '', true), { text: '', command: true });
  assert.deepEqual(parseVoiceSend([result('Peppy send')], 'Existing draft', true), { text: 'Existing draft', command: true });
  assert.deepEqual(parseVoiceSend([], 'Draft', true), { text: 'Draft', command: false });
});
