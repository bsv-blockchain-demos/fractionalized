// _test/TokenIndex.test.ts
import { recordTokenDerivation, getTokenDerivation } from '../src/lib/tokenIndex'

function fakeCollection(initial: any = null) {
  let doc = initial
  return {
    async updateOne(_filter: any, update: any) { doc = { ...(doc || {}), ...update.$set }; return { modifiedCount: 1 } },
    async findOne(_filter: any) { return doc },
    _get: () => doc,
  } as any
}

describe('tokenIndex', () => {
  it('writes and reads a derivation by outpoint', async () => {
    const col = fakeCollection({ transferTxid: 'ab.0' })
    await recordTokenDerivation(col, { transferTxid: 'ab.0' }, { keyId: 'n1', counterparty: 'SELLER', counterpartyDerivedKey: 'PUB', order: 'self-second' })
    const d = await getTokenDerivation(col, 'transferTxid', 'ab.0')
    expect(d).toEqual({ keyId: 'n1', counterparty: 'SELLER', counterpartyDerivedKey: 'PUB', order: 'self-second' })
  })
  it('returns null for legacy rows with no keyId', async () => {
    const col = fakeCollection({ transferTxid: 'ab.0' })
    expect(await getTokenDerivation(col, 'transferTxid', 'ab.0')).toBeNull()
  })
})
