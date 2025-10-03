import { LockingScript } from '@bsv/sdk'

describe('Ordinals.lock', () => {
  beforeEach(() => {
    // Ensure env var is set before importing the module under test
    process.env.NEXT_PUBLIC_SERVER_PUBKEY = '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'
    jest.resetModules()
  })

  it('creates a first output with multisig + inscription when isFirst=true', async () => {
    const { Ordinals } = await import('../src/utils/ordinals')
    const uut = new Ordinals()
    const script = uut.lock(
      // address (pubkey hex), assetId, tokenTxid, shares, type, isFirst
      '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798',
      'deadbeef.0',
      'cafebabe'.padEnd(64, 'a'),
      100,
      'deploy+mint',
      true
    )
    expect(script).toBeInstanceOf(LockingScript)
  })

  it('creates a transfer output with inscription and singlesig when not first', async () => {
    const { Ordinals } = await import('../src/utils/ordinals')
    const uut = new Ordinals()
    const script = uut.lock(
      '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798',
      'deadbeef.1',
      'cafebabe'.padEnd(64, 'b'),
      5,
      'transfer'
    )
    expect(script).toBeInstanceOf(LockingScript)
  })

  it('creates serverChange output when serverChange=true', async () => {
    const { Ordinals } = await import('../src/utils/ordinals')
    const uut = new Ordinals()
    const script = uut.lock(
      '02D0DE0AAEAEFAD02B8BDc8A01A1B8B11C696BD3F0F5A0D7A1A2B3C4D5E6F70809',
      'asset.2',
      '00'.repeat(32),
      1,
      'transfer',
      false,
      true
    )
    expect(script).toBeInstanceOf(LockingScript)
  })
})

