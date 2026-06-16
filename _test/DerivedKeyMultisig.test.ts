import { PrivateKey, Transaction, Script, MerklePath, PublicKey } from '@bsv/sdk'
import { OrdinalsP2MS } from '../src/utils/ordinalsP2MS'
import { makeWallet } from '../src/lib/serverWallet'
import { hashFromPubkeys } from '../src/utils/hashFromPubkeys'
import { generateNonce, deriveMultisigPair, TOKEN_PROTOCOL } from '../src/utils/tokenDerivation'

async function buildSpend(signerWallet: any, counterpartyId: string, otherDerivedKey: string, hash: number[], firstPubkeyIsWallet: boolean, nonce: string) {
  const src = new Transaction()
  src.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE') })
  src.addOutput({ lockingScript: new OrdinalsP2MS().lock(hash, 'a_0', 'a'.repeat(64), 10, 'transfer'), satoshis: 2 })
  src.merklePath = MerklePath.fromCoinbaseTxidAndHeight(src.id('hex'), 1)
  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: src, sourceOutputIndex: 0,
    unlockingScriptTemplate: new OrdinalsP2MS().unlock(
      signerWallet, nonce, counterpartyId, otherDerivedKey, 'single', true, undefined, undefined, firstPubkeyIsWallet, TOKEN_PROTOCOL,
    ),
  })
  tx.addOutput({ lockingScript: new OrdinalsP2MS().lock(hash, 'a_0', 'a'.repeat(64), 10, 'transfer'), satoshis: 1 })
  await tx.fee(); await tx.sign()
  return tx.verify('scripts only')
}

describe('Derived-key multisig round-trip', () => {
  it('locks to derived keys and unlocks as BOTH server and seller', async () => {
    const server = PrivateKey.fromRandom(); const seller = PrivateKey.fromRandom()
    const serverW = await makeWallet('main', 'https://store-us-1.bsvb.tech', server.toHex())
    const sellerW = await makeWallet('main', 'https://store-us-1.bsvb.tech', seller.toHex())
    const serverId = server.toPublicKey().toString(); const sellerId = seller.toPublicKey().toString()
    const nonce = generateNonce()

    const { selfKey: serverChild, counterpartyKey: sellerChild } = await deriveMultisigPair(serverW, sellerId, nonce)
    // committed order: [seller, server]
    const hash = hashFromPubkeys([PublicKey.fromString(sellerChild), PublicKey.fromString(serverChild)])

    // server signs: server is SECOND in the concat -> firstPubkeyIsWallet = false
    expect(await buildSpend(serverW, sellerId, sellerChild, hash, false, nonce)).toBe(true)
    // seller signs (cancel): seller is FIRST -> firstPubkeyIsWallet = true
    expect(await buildSpend(sellerW, serverId, serverChild, hash, true, nonce)).toBe(true)
  })
})
