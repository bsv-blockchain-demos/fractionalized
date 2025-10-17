import { LockingScript } from '@bsv/sdk'
import { PrivateKey, Transaction, Script } from '@bsv/sdk'
import { Ordinals } from '../src/utils/ordinalsP2PKH'
import { makeWallet } from '../src/lib/serverWallet'

describe('Ordinals.lock', () => {
  beforeEach(() => {
    // Ensure env var is set before importing the module under test
    process.env.NEXT_PUBLIC_SERVER_PUBKEY = '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'
    jest.resetModules()
  })

  it('creates a first output with multisig + inscription when isFirst=true', async () => {
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

  it('creates a Ordinal and spends it validly', async () => {
      const uut = new Ordinals()
      const userPriv = PrivateKey.fromRandom()
      const serverPriv = PrivateKey.fromRandom()
  
      const userWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', userPriv.toHex())
      const serverWallet = await makeWallet('main', 'https://store-us-1.bsvb.tech', serverPriv.toHex())
  
  
      const { publicKey: serverLockingKey } = await serverWallet.getPublicKey({
        protocolID: [0, "fractionalized"],
        keyID: "0",
        counterparty: "self",
      })
  
  
      const { publicKey: userLockingKey } = await userWallet.getPublicKey({
        protocolID: [0, "fractionalized"],
        keyID: "0",
        counterparty: 'self',
      })

      const address = 
  
      const sourceTransaction = new Transaction()
      sourceTransaction.addInput({
        sourceTXID: '0000000000000000000000000000000000000000000000000000000000000000',
        sourceOutputIndex: 0,
        unlockingScript: Script.fromASM('OP_TRUE')
      })
      sourceTransaction.addOutput({
        lockingScript: uut.lock(),
        satoshis: 2
      })
  
      sourceTransaction.merklePath = MerklePath.fromCoinbaseTxidAndHeight(sourceTransaction.id('hex'), 1234)
  
      const tx = new Transaction()
  
      tx.addInput({
        sourceTransaction,
        sourceOutputIndex: 0,
        unlockingScriptTemplate: uut.unlock(userWallet, serverLockingKey)
      })
      tx.addOutput({
        lockingScript: Script.fromASM('OP_TRUE'),
        satoshis: 1
      })
  
      await tx.fee()
      await tx.sign()
  
      const result: boolean = await tx.verify('scripts only')
  
      expect(result).toBe(true)
    })
})

