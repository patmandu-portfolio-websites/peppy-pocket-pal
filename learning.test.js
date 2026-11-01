import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLearning, approveProposal, correctEntry, learningContext, suggestionStatus, validateProposal } from './learning.js';
import { learningHandler } from './learningApi.js';

const memory = { kind: 'memory', title: 'Music preference', content: 'I like jazz.', source: 'User explicitly selected chat note', certainty: 'confirmed' };
test('approved memory starts excluded, supports corrections/deletion and opt-out', () => {
  const initial = emptyLearning();
  assert.equal(initial.entries.length, 0);
  let state = approveProposal(initial, memory, 'one', '2026-11-02');
  assert.equal(initial.entries.length, 0, 'No mutation before saving approval');
  assert.equal(learningContext(state), '');
  state.entries[0].included = true;
  assert.match(learningContext(state), /I like jazz/);
  assert.match(learningContext(state), /UNTRUSTED/);
  assert.equal(learningContext({ ...state, enabled: false }), '');
  state = correctEntry(state, 'one', 'I prefer classical.', '2026-11-03');
  assert.equal(state.entries[0].included, false, 'Changed context needs fresh inclusion consent');
  assert.equal(state.entries[0].history[0].content, 'I like jazz.');
  assert.equal(learningContext({ ...state, entries: [] }), '');
});
test('knowledge requires provenance, rejects credentials and bounds selected context', () => {
  assert.throws(() => validateProposal({ ...memory, kind: 'knowledge' }), /URL/);
  assert.throws(() => validateProposal({ ...memory, content: 'api_key=private' }), /credentials/);
  const item = { ...memory, kind: 'knowledge', source: 'https://example.com/research' };
  assert.equal(validateProposal(item).source, item.source);
  assert.throws(() => approveProposal({ ...emptyLearning(), entries: Array(100).fill(item) }, memory, 'one'), /full/);
  assert.throws(() => learningContext({ ...emptyLearning(), entries: Array(10).fill({ ...item, content: 'x'.repeat(2000), included: true }) }), /too large/);
});
test('suggestion queue decisions confer no execution capabilities and suppress repeats', () => {
  const proposal = { ...memory, kind: 'suggestion', benefit: 'Reduce repeated input', risks: 'Requires review', testPlan: 'Test a copy', rollbackPlan: 'Restore reviewed version' };
  let state = approveProposal(emptyLearning(), proposal, 's');
  state = suggestionStatus(state, 's', 'investigate');
  assert.equal(state.suggestions[0].status, 'investigate');
  state = suggestionStatus(state, 's', 'dismissed');
  assert.throws(() => approveProposal(state, proposal, 's2'), /already/);
  assert.throws(() => suggestionStatus(state, 's', 'install'), /Invalid/);
  assert.throws(() => approveProposal({ ...state, suggestionsEnabled: false }, { ...proposal, title: 'Other' }, 's3'), /disabled/);
});
test('AI learning endpoint uses only selected evidence, validates response and saves nothing', async () => {
  let request;
  const client = { responses: { create: async value => { request = value; return { output_text: JSON.stringify(memory) }; } } };
  let body;
  const res = { json: value => { body = value; }, status: () => res };
  await learningHandler(() => client)({ body: { kind: 'memory', evidence: 'I like jazz.', messages: 'Not authorized' } }, res);
  assert.equal(body.proposal.content, memory.content);
  assert.ok(!request.input.includes('Not authorized'));
  assert.equal(request.tools, undefined);
  assert.equal(request.text.format.type, 'json_schema');
});
