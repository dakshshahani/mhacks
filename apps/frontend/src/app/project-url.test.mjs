import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localhostPreview, projectHref, validProjectName } from './project-url.ts';

test('localhost previews preserve paths, ports, and URL query parameters', () => {
  assert.equal(localhostPreview('http://localhost:3001/home?theme=dark'), 'http://localhost:3001/home?theme=dark');
  assert.equal(localhostPreview('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/');
  assert.equal(localhostPreview('http://[::1]:3001'), 'http://[::1]:3001/');
  for (const value of ['https://example.com', 'javascript:alert(1)', 'http://localhost.example.com', 'http://user:password@localhost', 'invalid']) {
    assert.throws(() => localhostPreview(value));
  }
});

test('project routes encode names and preview URLs and reject reserved names', () => {
  assert.equal(projectHref(' My Website ', 'http://localhost:3001'), '/My%20Website?preview=http%3A%2F%2Flocalhost%3A3001%2F');
  for (const name of ['', 'projects', 'new', 'gallery', 'API', '..', 'one/two', 'a/b/c', 'a\\b', 'a'.repeat(81)]) {
    assert.equal(validProjectName(name), false);
    assert.throws(() => projectHref(name, 'http://localhost:3001'));
  }
});
