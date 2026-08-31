import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeGeneratedSourceMap,
  reproducibleBuildEnvironment,
} from './package-reproducible.mjs'

test('reproducible package builds pin all clock-sensitive environment inputs', () => {
  assert.deepEqual(reproducibleBuildEnvironment, {
    TZ: 'UTC',
    LC_ALL: 'C',
    SOURCE_DATE_EPOCH: '0',
  })
})

test('normalizes only Vite-generated asset source-map entries', () => {
  const sourceMap = {
    sourcesContent: ['const realSource = true', 'export default "__VITE_ASSET__unstable__"'],
  }

  assert.deepEqual(normalizeGeneratedSourceMap(sourceMap), {
    sourcesContent: ['const realSource = true', null],
  })
})
