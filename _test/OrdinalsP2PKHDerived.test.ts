import { PrivateKey, Transaction, Script, MerklePath, PublicKey } from '@bsv/sdk'
import { OrdinalsP2PKH } from '../src/utils/ordinalsP2PKH'
import { makeWallet } from '../src/lib/serverWallet'
import { generateNonce, deriveRecipientKey, TOKEN_PROTOCOL } from '../src/utils/tokenDerivation'

it('investor spends a P2PKH locked to their derived key', async () => {
  const server = PrivateKey.fromRandom(); const user = PrivateKey.fromRandom()
  const serverW = await makeWallet('main', 'https://store-us-1.bsvb.tech', server.toHex())
  const userW = await makeWallet('main', 'https://store-us-1.bsvb.tech', user.toHex())
  const serverId = server.toPublicKey().toString(); const userId = user.toPublicKey().toString()
  const nonce = generateNonce()

  const childPub = await deriveRecipientKey(serverW, userId, nonce) // server locks for user
  const addr = PublicKey.fromString(childPub).toAddress()

  const src = new Transaction()
  src.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE') })
  src.addOutput({ lockingScript: new OrdinalsP2PKH().lock(addr, 'a_0', 'a'.repeat(64), 5, 'transfer'), satoshis: 2 })
  src.merklePath = MerklePath.fromCoinbaseTxidAndHeight(src.id('hex'), 1)

  const tx = new Transaction()
  tx.addInput({
    sourceTransaction: src, sourceOutputIndex: 0,
    unlockingScriptTemplate: new OrdinalsP2PKH().unlock(
      userW, 'single', false, undefined, undefined,
      { protocolID: TOKEN_PROTOCOL, keyID: nonce, counterparty: serverId },
    ),
  })
  tx.addOutput({ lockingScript: new OrdinalsP2PKH().lock(addr, 'a_0', 'a'.repeat(64), 5, 'transfer'), satoshis: 1 })
  await tx.fee(); await tx.sign()
  expect(await tx.verify('scripts only')).toBe(true)
})
