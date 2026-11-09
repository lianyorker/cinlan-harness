/** Dictation segment spacing preserves existing drafts and Unicode characters. */
import { expect, it } from 'vitest'
import { formatFinalTranscriptSegment } from '../src/client/final-segments.ts'

it.each([
  ['', 'hello', 'hello'],
  ['hello', '', ''],
  ['hello ', 'world', 'world'],
  ['hello\t', 'world', 'world'],
  ['hello\n', 'world', 'world'],
  ['hello', ' world', ' world'],
  ['hello', 'world', ' world'],
  ['Hello.', 'World', ' World'],
  ['hello,', 'world', ' world'],
  ['version', '2', ' 2'],
  ['你好', '世界', '世界'],
  ['𠀀', 'hello', 'hello'],
  ['hello', '𠀀', '𠀀'],
  ['こんにちは', '世界', '世界'],
  ['안녕', '하세요', '하세요'],
  ['你好', 'world', 'world'],
  ['hello', '世界', '世界'],
  ['hello', '.', '.'],
  ['你好', '。', '。'],
  ['hello', ')', ')'],
  ['(', 'hello', 'hello'],
  ['「', '世界', '世界'],
  ['😀', 'hello', 'hello'],
  ['hello', '😀', '😀'],
])('appends %j followed by %j as segment %j', (draft, transcript, expected) => {
  expect(formatFinalTranscriptSegment(transcript, draft)).toBe(expected)
})
