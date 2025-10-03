import { ObjectId } from 'mongodb'

// Mock the entire mongo layer BEFORE importing the module under test
const mockPropertiesCollection = { findOne: jest.fn() }
const mockSharesCollection = { findOne: jest.fn() }

jest.mock('../src/lib/mongo', () => ({
  __esModule: true,
  // Export only the collection singletons used by traceShareChain
  propertiesCollection: mockPropertiesCollection,
  sharesCollection: mockSharesCollection,
}))

describe('traceShareChain', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns invalid when property or mintTxid is missing', async () => {
    const { traceShareChain } = await import('../src/utils/shareChain')
    mockPropertiesCollection.findOne.mockResolvedValueOnce(null)

    const propertyId = new ObjectId()
    const res = await traceShareChain({ propertyId, leafTransferTxid: 'txid.leaf' })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/Property or mintTxid not found/i)
  })

  it('walks back hops to mintTxid and returns valid', async () => {
    const { traceShareChain } = await import('../src/utils/shareChain')

    const propertyId = new ObjectId()
    const mintTxid = 'minttxid.0'

    // property exists with mintTxid
    mockPropertiesCollection.findOne.mockResolvedValueOnce({ _id: propertyId, txids: { mintTxid } })

    // shares: leaf -> mid -> root(mint)
    mockSharesCollection.findOne
      // leaf share
      .mockResolvedValueOnce({
        propertyId,
        transferTxid: 'leaf.0',
        parentTxid: 'mid.0',
        amount: 10,
        investorId: 'inv-leaf',
        createdAt: new Date('2024-01-01'),
      })
      // mid share
      .mockResolvedValueOnce({
        propertyId,
        transferTxid: 'mid.0',
        parentTxid: mintTxid,
        amount: 10,
        investorId: 'inv-mid',
        createdAt: new Date('2024-01-02'),
      })

    const res = await traceShareChain({ propertyId, leafTransferTxid: 'leaf.0' })
    expect(res.valid).toBe(true)
    expect(res.mintTxid).toBe(mintTxid)
    expect(res.endedAt).toBe(mintTxid)
    expect(res.length).toBe(2)
    expect(res.hops.map(h => h.transferTxid)).toEqual(['leaf.0', 'mid.0'])
  })

  it('returns invalid if a hop is missing before reaching mint', async () => {
    const { traceShareChain } = await import('../src/utils/shareChain')

    const propertyId = new ObjectId()
    const mintTxid = 'minttxid.0'
    mockPropertiesCollection.findOne.mockResolvedValueOnce({ _id: propertyId, txids: { mintTxid } })

    // missing the first lookup entirely
    mockSharesCollection.findOne.mockResolvedValueOnce(null)

    const res = await traceShareChain({ propertyId, leafTransferTxid: 'missing.0' })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/Missing share record/i)
    expect(res.endedAt).toBe('missing.0')
  })

  it('detects a cycle and returns invalid', async () => {
    const { traceShareChain } = await import('../src/utils/shareChain')

    const propertyId = new ObjectId()
    const mintTxid = 'minttxid.0'
    mockPropertiesCollection.findOne.mockResolvedValueOnce({ _id: propertyId, txids: { mintTxid } })

    // Create a cycle: a -> b -> a
    mockSharesCollection.findOne
      .mockImplementation(({ transferTxid }: any) => {
        if (transferTxid === 'a') {
          return Promise.resolve({ propertyId, transferTxid: 'a', parentTxid: 'b', amount: 1, investorId: 'x', createdAt: new Date() })
        }
        if (transferTxid === 'b') {
          return Promise.resolve({ propertyId, transferTxid: 'b', parentTxid: 'a', amount: 1, investorId: 'y', createdAt: new Date() })
        }
        return Promise.resolve(null)
      })

    const res = await traceShareChain({ propertyId, leafTransferTxid: 'a' })
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/Cycle detected/i)
    expect(res.endedAt).toBe('a')
  })
})

