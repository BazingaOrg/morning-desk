export type VetoFlags = {
  dataConflict?: boolean;
  staleData?: boolean;
  historyShort?: boolean;
  binaryEventNear?: boolean;
  toolStaleOrUnverified?: boolean;
  leverageDecayHigh?: boolean;
  unverifiedThesis?: boolean;
  rrMissingOrBelowMin?: boolean;
  extra?: string[];
};

export function collectBlockingVetoes(flags: VetoFlags): string[] {
  const out: string[] = [];
  if (flags.dataConflict) out.push("data-conflict");
  if (flags.staleData) out.push("stale-data");
  if (flags.historyShort) out.push("history-short");
  if (flags.binaryEventNear) out.push("binary-event-near");
  if (flags.toolStaleOrUnverified) out.push("tool-stale-or-unverified");
  if (flags.leverageDecayHigh) out.push("leverage-decay-high");
  if (flags.unverifiedThesis) out.push("unverified-thesis");
  if (flags.rrMissingOrBelowMin) out.push("rr-missing-or-below-min");
  if (flags.extra) {
    for (const reason of flags.extra) {
      if (reason && !out.includes(reason)) out.push(reason);
    }
  }
  return out;
}
