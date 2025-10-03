export function toOutpoint(txidOrOutpoint: string, vout = 0): string {
  const [txid, maybeVout] = String(txidOrOutpoint).split(".");
  const useVout = Number.isFinite(Number(maybeVout)) ? Number(maybeVout) : vout;
  return `${txid}.${useVout}`;
}

export function toTxid(txidOrOutpoint: string): string {
  return String(txidOrOutpoint).split(".")[0];
}

export function parseOutpoint(txidOrOutpoint: string): { txid: string; vout: number } {
  const [txid, voutStr] = String(txidOrOutpoint).split(".");
  const vout = Number.isFinite(Number(voutStr)) ? Number(voutStr) : 0;
  return { txid, vout };
}
