import { ObjectId } from "mongodb";
import { propertiesCollection, sharesCollection } from "../lib/mongo";

export type ChainHop = {
  transferTxid: string;
  parentTxid: string;
  amount: number;
  investorId: string;
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
  // Check for originalMintTxid first, fall back to mintTxid for backward compatibility
  const mintTxid = property?.txids?.originalMintTxid || property?.txids?.mintTxid;
  if (!property || !mintTxid) {
    return {
      valid: false,
      reason: "Property or originalMintTxid not found",
      propertyId: propertyObjectId,
      mintTxid: "",
      startedFrom: opts.leafTransferTxid,
      endedAt: "",
      length: 0,
      hops: [],
    };
  }

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
    let share = await sharesCollection.findOne({ propertyId: propertyObjectId, transferTxid: current } as any);
    if (!share) {
      // If we've reached the mint outpoint, we're done
      if (current === mintTxid) {
        break;
      }

      // Check if this is a change output (output index 1) by looking for a share at output 0
      const [txid, voutStr] = current.split(/[._]/);
      const vout = parseInt(voutStr);

      if (vout === 1) {
        // This might be a change output, check if there's a share at output 0
        const changeOutputShare = await sharesCollection.findOne({
          propertyId: propertyObjectId,
          transferTxid: `${txid}.0`
        } as any);

        if (changeOutputShare) {
          // Found the share at output 0, continue chain from its parent
          current = changeOutputShare.parentTxid as string;
          continue;
        }
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
      investorId: share.investorId as string,
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
