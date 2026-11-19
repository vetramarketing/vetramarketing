const assert = require('node:assert/strict');

// Use only the disposable test server and its test PIN. Its HTTP-only session cookie is
// shared with pages in this Playwright context, including their protected JS and CSS.
async function unlockTestContext(context, base) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
  const pin = process.env.VETRA_TEST_WORKSPACE_PIN;
  assert.ok(pin, 'Set VETRA_TEST_WORKSPACE_PIN for the disposable local test server');
  const response = await context.request.post(base + '/api/access/unlock', {
    form: { pin, next: '/groups' },
    headers: { Origin: base },
    maxRedirects: 0,
  });
  assert.equal(response.status(), 303);
  assert.equal(response.headers().location, '/groups', 'Test workspace did not unlock');
  await response.dispose();
}

module.exports = { unlockTestContext };
