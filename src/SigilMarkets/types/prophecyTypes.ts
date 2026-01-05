/* eslint-disable @typescript-eslint/consistent-type-definitions */

// SigilMarkets/types/prophecyTypes.ts
// Prophecy Sigils: sealed, time-locked claims (portable SVG proof).

import type { Brand, KaiMoment, KaiPulse, MicroDecimalString } from "./marketTypes";
import type { EvidenceBundle } from "./oracleTypes";
import type { CanonicalHash, KaiSignature, SvgHash, UserPhiKey } from "./vaultTypes";

export type ProphecyId = Brand<string, "ProphecyId">;
export const asProphecyId = (v: string): ProphecyId => v as ProphecyId;

export type ProphecyTextEncoding = "uri" | "b64";

export type ProphecyAuthor = Readonly<{
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;
}>;

export type ProphecyZkBundle = Readonly<{
  scheme: string;
  proof: unknown;
  publicInputs: readonly string[];
  poseidonHash?: string;
}>;

export type ProphecySigilPayloadV1 = Readonly<{
  v: "SM-PROPHECY-1";
  kind: "prophecy";

  prophecyId: ProphecyId;

  text: string;
  textEnc: ProphecyTextEncoding;
  textEncoded?: string;

  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: MicroDecimalString;
  evidence?: EvidenceBundle;

  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  canonicalHash: CanonicalHash;

  pulse: KaiPulse;
  beat: number;
  stepIndex: number;
  stepPct?: number;
  createdAt: KaiMoment;
  createdAtPulse: KaiPulse;

  zk?: ProphecyZkBundle;
}>;

export type ProphecySigilArtifact = Readonly<{
  svgHash: SvgHash;
  url?: string;
  svgText?: string;
  canonicalHash: CanonicalHash;
  payload: ProphecySigilPayloadV1;
  zk?: ProphecyZkBundle;
}>;

export type ProphecyRecord = Readonly<{
  id: ProphecyId;
  kind: "prophecy";

  text: string;
  textEnc: ProphecyTextEncoding;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: MicroDecimalString;
  evidence?: EvidenceBundle;

  createdAt: KaiMoment;
  createdAtPulse: KaiPulse;
  author: ProphecyAuthor;

  sigil?: ProphecySigilArtifact;

  updatedPulse: KaiPulse;
}>;
