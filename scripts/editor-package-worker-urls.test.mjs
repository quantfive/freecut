import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEditorWorkerUrls } from './editor-package-worker-urls.mjs'

test('unwraps generated worker URLs while retaining worker options and content', () => {
  const source = `new Worker(new URL(/* @vite-ignore */ "/assets/decoder-abc.js", "" + import.meta.url), {type:"module"});
new SharedWorker(new URL('/assets/waveform-def.js', import.meta.url), {name:'audio'});`
  assert.equal(normalizeEditorWorkerUrls(source), `new Worker("/assets/decoder-abc.js", {type:"module"});
new SharedWorker("/assets/waveform-def.js", {name:'audio'});`)
})

test('leaves relative, external, computed, non-worker URLs and documentation unchanged', () => {
  const source = `new Worker(new URL('./relative.js', import.meta.url));
new Worker(new URL('https://cdn.example.com/assets/worker.js', import.meta.url));
new Worker(new URL('/assets/worker.js', otherBase));
new Worker(new URL(assetPath, import.meta.url));
new URL('/assets/worker.js', import.meta.url).href;
const documentation = 'new Worker(new URL("/assets/worker.js", import.meta.url))';`
  assert.equal(normalizeEditorWorkerUrls(source), source)
})

test('is idempotent and rejects malformed chunks instead of silently changing code', () => {
  const normalized = 'new Worker("/assets/worker.js", {type:"module"})'
  assert.equal(normalizeEditorWorkerUrls(normalized), normalized)
  assert.throws(() => normalizeEditorWorkerUrls('new Worker( /* /assets/ */'), /Cannot inspect/)
})
