import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertFacebookPendingPostUrl,
  normalizeFacebookGroupKey,
  normalizeFacebookGroupPostInput,
  parseFacebookGroupPostLink,
  parseFacebookGroupPostUrl,
} from '../src/lib/facebook-post-url';

const groupId = '878540877111439';
const postId = '1441014217530766';
const expected = { groupId, postId };

test('the supplied HTTP group post input upgrades to HTTPS and extracts its handle and post ID', () => {
  const input = 'http://facebook.com/groups/designer.freelance/posts/2192701704986425/';
  const normalized = normalizeFacebookGroupPostInput(` ${input} `);
  assert.equal(
    normalized,
    'https://facebook.com/groups/designer.freelance/posts/2192701704986425/',
  );
  assert.deepEqual(parseFacebookGroupPostLink(normalized), {
    groupId: 'designer.freelance',
    postId: '2192701704986425',
  });
  assert.equal(parseFacebookGroupPostUrl(normalized), null, 'A handle is not a numeric Group ID.');
  assert.equal(parseFacebookGroupPostLink(input), null, 'Stored-link parsing remains HTTPS-only.');
  assert.equal(normalizeFacebookGroupPostInput(normalized), normalized);
});

test('HTTP input normalization supports numeric, share, and pending links without rounding IDs', () => {
  const longId = '9'.repeat(40);
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']) {
    for (const suffix of [
      `posts/${longId}/`,
      `permalink/${longId}?ref=share#comments`,
      `?multi_permalinks=${longId}&ref=share`,
    ]) {
      const input = `HTTP://${host}/groups/${groupId}/${suffix}`;
      const normalized = normalizeFacebookGroupPostInput(input);
      assert.equal(normalized, `https://${host}/groups/${groupId}/${suffix}`);
      assert.deepEqual(parseFacebookGroupPostUrl(normalized), { groupId, postId: longId });
    }
    const pending = `http://${host}/groups/designer.freelance/pending_posts/${longId}/`;
    const normalized = normalizeFacebookGroupPostInput(pending);
    assert.equal(normalized, `https://${host}/groups/designer.freelance/pending_posts/${longId}/`);
    assert.equal(parseFacebookGroupPostLink(normalized), null);
    assert.equal(
      convertFacebookPendingPostUrl(normalized),
      `https://www.facebook.com/groups/designer.freelance/posts/${longId}/`,
      'Pending inputs retain the existing explicit pending-post conversion.',
    );
  }
});

test('HTTP input normalization leaves unsafe authorities and unrecognized links unchanged', () => {
  for (const authority of [
    'http://facebook.com.evil.example',
    'http://notfacebook.com',
    'http://evil.facebook.com',
    'http://user@facebook.com',
    'http://user:password@facebook.com',
    'http://@facebook.com',
    'http://facebook.com:80',
    'http://facebook.com:443',
    'http://facebook.com:8443',
  ]) {
    for (const segment of ['posts', 'pending_posts']) {
      const input = `${authority}/groups/designer.freelance/${segment}/${postId}/`;
      assert.equal(normalizeFacebookGroupPostInput(input), input);
    }
  }
  for (const input of [
    '',
    'not a URL',
    'http://example.com/post/123',
    'http://facebook.com/groups/designer.freelance/',
    `http://facebook.com/groups/designer.freelance/posts/${postId}/comments`,
    'http://facebook.com/groups/designer.freelance/?multi_permalinks=1&multi_permalinks=2',
    `http://facebook.com/groups/${'1'.repeat(41)}/posts/${postId}/`,
    `http://facebook.com/groups/feed/posts/${postId}/`,
    `http://facebook.com/groups/designer.freelance/posts/${'1'.repeat(41)}/`,
    `https://facebook.com/groups/designer.freelance/posts/${postId}/`,
  ])
    assert.equal(normalizeFacebookGroupPostInput(` ${input} `), input);
});

test('converts Facebook moderation links to the matching group post URL without rounding IDs', () => {
  assert.equal(
    convertFacebookPendingPostUrl(
      ' https://m.facebook.com/groups/187964837981399/pending_posts/29158298537187977/?ref=share#comments ',
    ),
    'https://www.facebook.com/groups/187964837981399/posts/29158298537187977/',
  );
  for (const url of [
    `https://www.facebook.com/groups/${groupId}/posts/${postId}/`,
    `https://example.com/groups/${groupId}/pending_posts/${postId}/`,
    `https://user@www.facebook.com/groups/${groupId}/pending_posts/${postId}/`,
    `https://www.facebook.com/groups/${groupId}/pending_posts/`,
  ]) {
    assert.equal(convertFacebookPendingPostUrl(url), null);
  }
});

test('extracts group and post IDs from Facebook permalink and posts URLs', () => {
  for (const segment of ['permalink', 'posts']) {
    assert.deepEqual(
      parseFacebookGroupPostUrl(`https://www.facebook.com/groups/${groupId}/${segment}/${postId}/`),
      expected,
    );
    assert.deepEqual(
      parseFacebookGroupPostUrl(
        ` https://www.facebook.com/groups/${groupId}/${segment}/${postId}?ref=share#comments `,
      ),
      expected,
    );
  }
});

test('accepts common Facebook host variants and preserves large ID strings', () => {
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']) {
    assert.deepEqual(
      parseFacebookGroupPostUrl(`https://${host}/groups/${groupId}/posts/${postId}`),
      expected,
    );
  }
});

test('accepts the single-post multi_permalinks group share format', () => {
  assert.deepEqual(
    parseFacebookGroupPostUrl(
      `https://www.facebook.com/groups/${groupId}/?multi_permalinks=${postId}&ref=share`,
    ),
    expected,
  );
});

test('accepts 40-digit IDs and rejects 41-digit group or post IDs', () => {
  const fortyDigitId = '1'.repeat(40);
  const longId = '1'.repeat(41);
  assert.deepEqual(
    parseFacebookGroupPostUrl(`https://facebook.com/groups/${fortyDigitId}/posts/${fortyDigitId}`),
    { groupId: fortyDigitId, postId: fortyDigitId },
  );
  assert.equal(
    parseFacebookGroupPostUrl(`https://facebook.com/groups/${longId}/posts/${postId}`),
    null,
  );
  assert.equal(
    parseFacebookGroupPostUrl(`https://facebook.com/groups/${groupId}/permalink/${longId}`),
    null,
  );
  assert.equal(
    parseFacebookGroupPostUrl(`https://facebook.com/groups/${groupId}/?multi_permalinks=${longId}`),
    null,
  );
});

test('rejects URLs that cannot confidently identify one Facebook group post', () => {
  const invalid = [
    '',
    'not a URL',
    `http://www.facebook.com/groups/${groupId}/posts/${postId}`,
    `https://facebook.com.evil.example/groups/${groupId}/posts/${postId}`,
    `https://notfacebook.com/groups/${groupId}/posts/${postId}`,
    `https://user@www.facebook.com/groups/${groupId}/posts/${postId}`,
    `https://www.facebook.com:8443/groups/${groupId}/posts/${postId}`,
    `https://www.facebook.com/groups/example/posts/${postId}`,
    `https://www.facebook.com/groups/${groupId}/posts/example`,
    `https://www.facebook.com/groups/${groupId}/posts/${postId}/comments`,
    `https://www.facebook.com/${groupId}/posts/${postId}`,
    `https://www.facebook.com/groups/${groupId}/`,
    `https://www.facebook.com/groups/${groupId}/?multi_permalinks=invalid`,
    `https://www.facebook.com/groups/${groupId}/?multi_permalinks=${postId}&multi_permalinks=2`,
    `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${groupId}`,
  ];

  for (const url of invalid) assert.equal(parseFacebookGroupPostUrl(url), null, url);
});

test('recognizes the supplied designg post without treating its handle as a numeric group ID', () => {
  const url = 'https://www.facebook.com/groups/designg/posts/1810899433450636/';
  assert.deepEqual(parseFacebookGroupPostLink(url), {
    groupId: 'designg',
    postId: '1810899433450636',
  });
  assert.equal(parseFacebookGroupPostUrl(url), null);
});

test('normalizes supported handles in posts, permalink, multi_permalinks, and pending links', () => {
  const groupId = 'designg';
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']) {
    for (const path of [
      `DesignG/posts/${postId}/`,
      `DESIGNG/permalink/${postId}?ref=share#comments`,
      `Designg/?multi_permalinks=${postId}&ref=share`,
    ]) {
      assert.deepEqual(parseFacebookGroupPostLink(`https://${host}/groups/${path}`), {
        groupId,
        postId,
      });
    }
    const pending = `https://${host}/groups/DesignG/pending_posts/${postId}/?ref=share#comments`;
    const converted = convertFacebookPendingPostUrl(pending);
    assert.equal(converted, `https://www.facebook.com/groups/${groupId}/posts/${postId}/`);
    assert.deepEqual(parseFacebookGroupPostLink(converted!), { groupId, postId });
    assert.equal(
      parseFacebookGroupPostLink(pending),
      null,
      'Pending URLs need explicit conversion',
    );
  }
});

test('normalizes safe group keys while preserving numeric ID limits and reserved navigation routes', () => {
  for (const [input, expected] of [
    [' DesignG ', 'designg'],
    ['Team_Design.2026-Group', 'team_design.2026-group'],
    ['a', 'a'],
    ['A'.repeat(80), 'a'.repeat(80)],
    ['1'.repeat(40), '1'.repeat(40)],
    ['00001', '00001'],
  ])
    assert.equal(normalizeFacebookGroupKey(input), expected);
  for (const input of [
    '',
    '  ',
    'A'.repeat(81),
    '1'.repeat(41),
    'design g',
    'design/g',
    'design%67',
    'ดีไซน์',
    'design?g',
    'design#g',
    'design\\g',
    'feed',
    'DISCOVER',
    'joins',
    'create',
    'categories',
    'notifications',
    'your_groups',
    'membership',
    'admin',
  ])
    assert.equal(normalizeFacebookGroupKey(input), '', input);
});

test('handle-aware parsing keeps large IDs as strings and rejects numeric overflow in every path', () => {
  const id = '9'.repeat(40);
  for (const key of ['a', 'A'.repeat(80), id]) {
    assert.deepEqual(parseFacebookGroupPostLink(`https://facebook.com/groups/${key}/posts/${id}`), {
      groupId: key.toLowerCase(),
      postId: id,
    });
  }
  for (const group of ['1'.repeat(41), 'a'.repeat(81), 'feed']) {
    for (const path of [`posts/${postId}`, `permalink/${postId}`, `?multi_permalinks=${postId}`]) {
      assert.equal(
        parseFacebookGroupPostLink(`https://facebook.com/groups/${group}/${path}`),
        null,
      );
    }
    assert.equal(
      convertFacebookPendingPostUrl(`https://facebook.com/groups/${group}/pending_posts/${postId}`),
      null,
    );
  }
  for (const invalidPost of ['9'.repeat(41), 'post-name', '-1', '1.2', '1e5', '%31']) {
    for (const path of [`posts/${invalidPost}`, `permalink/${invalidPost}`]) {
      assert.equal(parseFacebookGroupPostLink(`https://facebook.com/groups/designg/${path}`), null);
    }
    assert.equal(
      convertFacebookPendingPostUrl(
        `https://facebook.com/groups/designg/pending_posts/${invalidPost}`,
      ),
      null,
    );
  }
  for (const invalidPost of ['9'.repeat(41), 'post-name', '-1', '1.2', '1e5']) {
    assert.equal(
      parseFacebookGroupPostLink(
        `https://facebook.com/groups/designg/?multi_permalinks=${invalidPost}`,
      ),
      null,
    );
  }
});

test('handle-aware parsing rejects unsafe authorities and malformed or ambiguous group links', () => {
  for (const authority of [
    'http://www.facebook.com',
    'https://facebook.com.evil.example',
    'https://notfacebook.com',
    'https://user@www.facebook.com',
    'https://user:password@facebook.com',
    'https://@facebook.com',
    'https://www.facebook.com:443',
    'https://www.facebook.com:8443',
    'https://evil.facebook.com',
  ]) {
    assert.equal(parseFacebookGroupPostLink(`${authority}/groups/designg/posts/${postId}`), null);
    assert.equal(
      convertFacebookPendingPostUrl(`${authority}/groups/designg/pending_posts/${postId}`),
      null,
    );
  }
  for (const path of [
    `design%67/posts/${postId}`,
    `design%2Fg/posts/${postId}`,
    `design%20g/posts/${postId}`,
    `designg/posts/${postId}/comments`,
    `designg/posts/${postId}//`,
    'designg/',
    'designg/?multi_permalinks=',
    `designg/?multi_permalinks=${postId}&multi_permalinks=2`,
    `designg/?multi_permalinks=${postId},2`,
  ])
    assert.equal(parseFacebookGroupPostLink(`https://www.facebook.com/groups/${path}`), null, path);
});

test('numeric-only callers retain the same values for all supported group post formats', () => {
  for (const suffix of [
    `posts/${postId}`,
    `permalink/${postId}/?ref=share`,
    `?multi_permalinks=${postId}`,
  ]) {
    const url = `https://www.facebook.com/groups/${groupId}/${suffix}`;
    assert.deepEqual(parseFacebookGroupPostLink(url), expected);
    assert.deepEqual(parseFacebookGroupPostUrl(url), expected);
  }
});
