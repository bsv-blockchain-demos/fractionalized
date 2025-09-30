import { ObjectId } from "mongodb";
import { propertiesCollection, sharesCollection } from "../lib/mongo";

export type ChainHop = {
  transferTxid: string;
  parentTxid: string;
  amount: number;
  investorId: ObjectId;
  createdAt: Date;
};

export type TraceResult = {
  valid: boolean;
  reason?: string;
  propertyId: ObjectId;
  mintTxid: string;
  startedFrom: string; // leaf transferTxid
  endedAt: string; // expected to be mintTxid when valid
  length: number;
  hops: ChainHop[];
};

export async function traceShareChain(opts: {
  propertyId: string | ObjectId;
  leafTransferTxid: string;
}): Promise<TraceResult> {
  const propertyObjectId = typeof opts.propertyId === "string" ? new ObjectId(opts.propertyId) : opts.propertyId;

  const property = await propertiesCollection.findOne({ _id: propertyObjectId });
  if (!property || !property?.txids?.mintTxid) {
    return {
      valid: false,
      reason: "Property or mintTxid not found",
      propertyId: propertyObjectId,
      mintTxid: "",
      startedFrom: opts.leafTransferTxid,
      endedAt: "",
      length: 0,
      hops: [],
    };
  }

  const mintTxid: string = property.txids.mintTxid;

  const hops: ChainHop[] = [];
  const visited = new Set<string>();

  let current = opts.leafTransferTxid;
  let length = 0;

  while (true) {
    if (visited.has(current)) {
      return {
        valid: false,
        reason: "Cycle detected in share chain",
        propertyId: propertyObjectId,
        mintTxid,
        startedFrom: opts.leafTransferTxid,
        endedAt: current,
        length,
        hops,
      };
    }
    visited.add(current);

    // Find the share record whose transferTxid equals current
    const share = await sharesCollection.findOne({ propertyId: propertyObjectId, transferTxid: current } as any);
    if (!share) {
      // If we've reached the mint outpoint, we're done; otherwise invalid chain
      if (current === mintTxid) {
        break;
      }
      return {
        valid: false,
        reason: `Missing share record for outpoint ${current}`,
        propertyId: propertyObjectId,
        mintTxid,
        startedFrom: opts.leafTransferTxid,
        endedAt: current,
        length,
        hops,
      };
    }

    const hop: ChainHop = {
      transferTxid: share.transferTxid as string,
      parentTxid: share.parentTxid as string,
      amount: share.amount as number,
      investorId: share.investorId as ObjectId,
      createdAt: share.createdAt as Date,
    };
    hops.push(hop);
    length += 1;

    if (hop.parentTxid === mintTxid) {
      // Reached root successfully
      break;
    }

    current = hop.parentTxid;
  }

  return {
    valid: true,
    propertyId: propertyObjectId,
    mintTxid,
    startedFrom: opts.leafTransferTxid,
    endedAt: mintTxid,
    length,
    hops,
  };
}
