export const outpointPattern = '^[0-9a-fA-F]{64}([._])\\d+$';

export const propertiesValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['txids', 'seller'],
    properties: {
      txids: {
        bsonType: 'object',
        // tokenTxid can be added later; do not require it at insertion time
        // required: ['tokenTxid'],
        properties: {
          tokenTxid: {
            bsonType: 'string',
            pattern: outpointPattern,
          },
          mintTxid: {
            bsonType: 'string',
            pattern: outpointPattern,
          },
          paymentTxid: {
            bsonType: 'string',
            pattern: outpointPattern,
          },
        },
        additionalProperties: true,
      },
      seller: {
        bsonType: 'string',
      },
      title: { bsonType: 'string', maxLength: 80 },
      location: { bsonType: 'string', maxLength: 80 },
      currentValuationUSD: { bsonType: ['double','int','long','decimal'], minimum: 0, maximum: 1e12 },
      investors: { bsonType: ['int','long'], minimum: 0, maximum: 100 },
      investmentBreakdown: {
        bsonType: 'object',
        properties: {
          purchaseCost: { bsonType: ['double','int','long','decimal'], minimum: 0, maximum: 1e12 },
          transactionCost: { bsonType: ['double','int','long','decimal'], minimum: 0, maximum: 1e12 },
          runningCost: { bsonType: ['double','int','long','decimal'], minimum: 0, maximum: 1e12 },
        },
      },
      proofOfOwnership: { bsonType: 'string', maxLength: 10485760 }, // ~10MB base64 limit (roughly 7.5MB PDF)
    },
    additionalProperties: true,
  },
} as const;

export const propertyDescriptionsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['propertyId', 'description'],
    properties: {
      propertyId: { bsonType: 'objectId' },
      description: {
        bsonType: 'object',
        required: ['details'],
        properties: {
          details: { bsonType: 'string', maxLength: 1500 },
          features: {
            bsonType: 'array',
            items: { bsonType: 'string', maxLength: 80 },
            maxItems: 20,
          },
        },
        additionalProperties: false,
      },
      whyInvest: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          properties: {
            title: { bsonType: 'string', maxLength: 80 },
            text: { bsonType: 'string', maxLength: 400 },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: true,
  },
} as const;

export const sharesValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'propertyId',
      'investorId',
      'parentTxid',
      'transferTxid',
      'amount',
      'createdAt',
    ],
    properties: {
      propertyId: { bsonType: 'objectId' },
      investorId: { bsonType: 'string' },
      parentTxid: { bsonType: 'string', pattern: outpointPattern },
      transferTxid: { bsonType: 'string', pattern: outpointPattern },
      amount: { bsonType: 'number' },
      createdAt: { bsonType: 'date' },
    },
    additionalProperties: true,
  },
} as const;

export const marketItemsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: [
      'propertyId',
      'sellerId',
      'shareId',
      'sellAmount',
    ],
    properties: {
      propertyId: { bsonType: 'objectId' },
      sellerId: { bsonType: 'string' },
      shareId: { bsonType: 'objectId' },
      sellAmount: { bsonType: 'number', minimum: 1 },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
      sold: { bsonType: 'bool' },
    },
    additionalProperties: true,
  },
} as const;
