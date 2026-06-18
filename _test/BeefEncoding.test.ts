import { encodeBeef, decodeBeef } from '../src/utils/beefEncoding'

describe('beefEncoding', () => {
  it('round-trips a byte array through base64', () => {
    const bytes = [0, 1, 2, 254, 255, 128, 64]
    expect(decodeBeef(encodeBeef(bytes))).toEqual(bytes)
  })
  it('produces a base64 string', () => {
    expect(typeof encodeBeef([1, 2, 3])).toBe('string')
  })
})
