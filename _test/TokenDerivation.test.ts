// _test/TokenDerivation.test.ts
import { PrivateKey } from '@bsv/sdk'
import { makeWallet } from '../src/lib/serverWallet'
import { generateNonce, deriveRecipientKey, deriveMultisigPair } from '../src/utils/tokenDerivation'

describe('tokenDerivation', () => {
  it('generateNonce returns a fresh base64 string each call', () => {
    expect(generateNonce()).not.toEqual(generateNonce())
  })

  it('recipient derives the same key the sender locked to', async () => {
    const server = PrivateKey.fromRandom()
    const user = PrivateKey.fromRandom()
    const serverW = await makeWallet('main', 'https://store-us-1.bsvb.tech', server.toHex())
    const userW = await makeWallet('main', 'https://store-us-1.bsvb.tech', user.toHex())
    const serverId = server.toPublicKey().toString()
    const userId = user.toPublicKey().toString()
    const nonce = generateNonce()

    const locked = await deriveRecipientKey(serverW, userId, nonce)
    const { publicKey: ownKey } = await userW.getPublicKey({
      protocolID: [2, 'fractionalized token'], keyID: nonce, counterparty: serverId, forSelf: true,
    })
    expect(ownKey).toEqual(locked)
  })

  it('multisig pair: each side derives the same two keys for one nonce', async () => {
    const server = PrivateKey.fromRandom()
    const seller = PrivateKey.fromRandom()
    const serverW = await makeWallet('main', 'https://store-us-1.bsvb.tech', server.toHex())
    const sellerW = await makeWallet('main', 'https://store-us-1.bsvb.tech', seller.toHex())
    const serverId = server.toPublicKey().toString()
    const sellerId = seller.toPublicKey().toString()
    const nonce = generateNonce()

    const fromServer = await deriveMultisigPair(serverW, sellerId, nonce)
    const fromSeller = await deriveMultisigPair(sellerW, serverId, nonce)

    expect(fromServer.selfKey).toEqual(fromSeller.counterpartyKey)
    expect(fromServer.counterpartyKey).toEqual(fromSeller.selfKey)
  })
})
