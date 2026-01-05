// SigilMarkets/views/Prophecy/ProphecyComposer.tsx
"use client";

import React from "react";
import type { KaiMoment } from "../../types/marketTypes";
import { ProphecyMintForm } from "./ProphecyMintForm";

export const ProphecyComposer = (props: Readonly<{ now: KaiMoment }>) => {
  return <ProphecyMintForm now={props.now} compact />;
};
