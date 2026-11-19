import assert from 'node:assert/strict';
import test from 'node:test';
import directory from '../src/lib/facebook-group-directory.json';
import {
  knownFacebookGroupHandleName,
  knownFacebookGroupName,
  resolveFacebookGroupName,
} from '../src/lib/facebook-group-directory';

test('supplied group directory maps unique numeric IDs to names', () => {
  assert.equal(directory.groups.length, 118);
  assert.equal(new Set(directory.groups.map((entry) => entry.facebookId)).size, 118);
  assert.ok(directory.groups.every((entry) => /^\d{1,40}$/.test(entry.facebookId)));
  assert.equal(knownFacebookGroupName('878540877111439'), 'กลุ่มชาวลำลูกกา');
  assert.equal(knownFacebookGroupName(' 878540877111439 '), 'กลุ่มชาวลำลูกกา');
  assert.equal(knownFacebookGroupName('000000000000000'), undefined);
  assert.equal(directory.handlesWithoutId.length, 5);
});

test('known handles resolve names across URL casing and surrounding whitespace', () => {
  for (const { handle, name } of directory.handlesWithoutId) {
    assert.equal(knownFacebookGroupHandleName(handle), name);
    assert.equal(knownFacebookGroupHandleName(handle.toLowerCase()), name);
    assert.equal(knownFacebookGroupHandleName(` ${handle.toUpperCase()} `), name);
  }
  assert.equal(knownFacebookGroupHandleName('unknown-community-handle'), undefined);
});

test('lookup replaces generated placeholders but preserves custom group names', () => {
  const id = '878540877111439';
  assert.equal(resolveFacebookGroupName(id), 'กลุ่มชาวลำลูกกา');
  assert.equal(resolveFacebookGroupName(id, `Facebook group ${id}`), 'กลุ่มชาวลำลูกกา');
  assert.equal(resolveFacebookGroupName(id, 'Our local nickname'), 'Our local nickname');
  assert.equal(resolveFacebookGroupName('123'), 'Facebook group 123');
});
