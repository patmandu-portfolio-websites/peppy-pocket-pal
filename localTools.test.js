import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LocalPolicy, isPublicAddress } from './localPolicy.js';
import { LocalTools } from './localTools.js';
import { LocalAssistant } from './localAssistant.js';

async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(process.cwd(), 'peppy-tools-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'authorized');
  const state = path.join(folder, 'state');
  await fs.mkdir(root);
  const policy = new LocalPolicy({ roots: [root], origins: ['https://www.google.com'], protectedPaths: [state] });
  return { root, folder, policy, tools: new LocalTools(policy, state) };
}

test('blocks unauthorized, credential, executable and protected paths', async t => {
  const { root, folder, policy } = await fixture(t);
  for (const file of [path.join(folder, 'outside.txt'), path.join(root, '.env'), path.join(root, 'secrets.json'), path.join(root, 'run.ps1'), path.join(root, '.git', 'config.txt')]) {
    await assert.rejects(policy.resolve(file, { missing: true }));
  }
  await assert.rejects(policy.resolve(root, { mutate: true }), /roots/);
  const safe = path.join(root, 'notes.txt');
  await fs.writeFile(safe, 'api_key=very-private');
  await assert.rejects(policy.read(safe), /credentials/);
  await fs.writeFile(safe, 'normal text');
  assert.equal(await policy.read(safe), 'normal text');
});

test('blocks junction and hard-link access', async t => {
  const { root, folder, policy } = await fixture(t);
  const outside = path.join(folder, 'outside');
  await fs.mkdir(outside);
  const junction = path.join(root, 'linked');
  await fs.symlink(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(policy.resolve(junction), /junctions/);
  const file = path.join(root, 'one.txt');
  await fs.writeFile(file, 'hi');
  await fs.link(file, path.join(root, 'two.txt'));
  await assert.rejects(policy.read(file), /Hard-linked/);
});

test('previews writes without mutation, backs up, deletes recoverably and restores', async t => {
  const { root, tools } = await fixture(t);
  const file = path.join(root, 'notes.txt');
  await fs.writeFile(file, 'before\n');
  const write = await tools.prepare({ kind: 'write_file', path: file, text: 'after\n' });
  assert.match(write.diff, /-before/);
  assert.match(write.diff, /\+after/);
  assert.equal(await fs.readFile(file, 'utf8'), 'before\n');
  const changed = await tools.execute(write);
  assert.ok(changed.backupId);
  assert.equal(await fs.readFile(file, 'utf8'), 'after\n');
  const deletion = await tools.prepare({ kind: 'delete_file', path: file });
  const deleted = await tools.execute(deletion);
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  const restore = await tools.prepare({ kind: 'restore_backup', backupId: deleted.backupId });
  await tools.execute(restore);
  assert.equal(await fs.readFile(file, 'utf8'), 'after\n');
});

test('detects stale approvals, destination conflicts and expired actions', async t => {
  const { root, tools } = await fixture(t);
  const file = path.join(root, 'notes.txt');
  await fs.writeFile(file, 'before');
  const action = await tools.prepare({ kind: 'write_file', path: file, text: 'after' });
  await fs.writeFile(file, 'changed externally');
  await assert.rejects(tools.execute(action), /changed after preview/);
  const move = await tools.prepare({ kind: 'move_file', path: file, destination: path.join(root, 'moved.txt') });
  await tools.execute(move);
  assert.equal(await fs.readFile(path.join(root, 'moved.txt'), 'utf8'), 'changed externally');
  await assert.rejects(tools.prepare({ kind: 'move_file', path: path.join(root, 'moved.txt'), destination: path.join(root, 'moved.txt') }), /already exists/);
  const expired = await tools.prepare({ kind: 'read_file', path: path.join(root, 'moved.txt') });
  expired.expires = 0;
  await assert.rejects(tools.execute(expired), /expired/);
});

test('restricts exact website origins and public network addresses', async t => {
  const { policy } = await fixture(t);
  for (const url of ['http://www.google.com', 'https://google.com', 'https://www.google.com.evil.test', 'https://user:pass@www.google.com', 'https://127.0.0.1']) await assert.rejects(policy.website(url));
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.0.1', '169.254.169.254', '::1', 'fc00::1', '2001:db8::1', '100.64.0.1']) assert.equal(isPublicAddress(address), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2607:f8b0:4000::1'), true);
});

test('AI proposal cannot write before matching one-time approval; decline does not execute', async t => {
  const { root, tools } = await fixture(t);
  const file = path.join(root, 'new.txt');
  let calls = 0;
  const model = { responses: { create: async () => {
    calls++;
    return { output_text: '', output: [{ type: 'function_call', name: 'propose_action', call_id: 'test-call', arguments: JSON.stringify({ kind: 'write_file', path: file, text: 'approved content' }) }] };
  } } };
  const assistant = new LocalAssistant(tools, () => model);
  const response = await assistant.start([{ role: 'user', content: 'Create a note' }], '');
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  await assert.rejects(assistant.approve(response.sessionId, 'wrong-id', true), /does not match/);
  const result = await assistant.approve(response.sessionId, response.pending.id, true);
  assert.equal(await fs.readFile(file, 'utf8'), 'approved content');
  assert.equal(result.canContinue, true);
  assert.equal(calls, 1, 'Tool output is not sent to AI until user chooses Continue');
  await assert.rejects(assistant.approve(response.sessionId, response.pending.id, true), /does not match/);
  const second = await assistant.start([{ role: 'user', content: 'Change note' }], '');
  await assistant.approve(second.sessionId, second.pending.id, false);
  assert.equal(await fs.readFile(file, 'utf8'), 'approved content');
});

test('website permission is explicit, task-scoped, and never a saved global grant', async t => {
  const { tools } = await fixture(t);
  tools.policy.website = async value => {
    const url = new URL(value);
    if (!tools.policy.origins.includes(url.origin)) throw new Error('This website is not authorized.');
    return url.href;
  };
  const assistant = new LocalAssistant(tools, () => ({ responses: { create: async () => ({
    output_text: 'This task needs another website.',
    output: [{ type: 'function_call', name: 'propose_action', call_id: 'site-call', arguments: JSON.stringify({ kind: 'request_website_access', url: 'https://example.com' }) }]
  }) } }));
  const proposal = await assistant.start([{ role: 'user', content: 'Read example.com' }], '');
  assert.deepEqual(tools.policy.origins, ['https://www.google.com']);
  assert.deepEqual(assistant.session(proposal.sessionId).origins, []);
  const result = await assistant.approve(proposal.sessionId, proposal.pending.id, true);
  assert.equal(result.result.scope, 'current task only');
  assert.deepEqual(assistant.session(proposal.sessionId).origins, ['https://example.com']);
  assert.deepEqual(tools.policy.origins, ['https://www.google.com']);
  const second = await assistant.start([{ role: 'user', content: 'Another task' }], '');
  assert.deepEqual(assistant.session(second.sessionId).origins, []);
  await assistant.approve(second.sessionId, second.pending.id, false);
  assert.deepEqual(assistant.session(second.sessionId).origins, []);
  assistant.session(second.sessionId).expires = 0;
  assert.throws(() => assistant.session(second.sessionId), /expired/);
});

test('unsupported actions, unsafe writes and oversized files are rejected', async t => {
  const { tools, root } = await fixture(t);
  await assert.rejects(tools.prepare({ kind: 'execute_shell', text: 'anything' }), /Unsupported/);
  await assert.rejects(tools.prepare({ kind: 'write_file', path: path.join(root, 'notes.txt'), text: 'password=private-value' }), /credentials/);
  const large = path.join(root, 'large.txt');
  await fs.writeFile(large, 'x'.repeat(65537));
  await assert.rejects(tools.prepare({ kind: 'read_file', path: large }), /64 KiB/);
});
