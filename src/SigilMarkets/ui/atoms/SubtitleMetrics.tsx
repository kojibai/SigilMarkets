// SigilMarkets/ui/atoms/SubtitleMetrics.tsx
"use client";

import React from "react";

type MetricIconProps = Readonly<{
  size?: number;
  className?: string;
}>;

const baseIconProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
});

export const UniverseIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <circle cx="12" cy="12" r="4.2" />
    <ellipse cx="12" cy="12" rx="9" ry="4.6" transform="rotate(-18 12 12)" />
    <circle cx="18.5" cy="6.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const LockedIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export const UnlockedIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M9 11V7.6a3.6 3.6 0 0 1 6.2-2.4" />
  </svg>
);

export const ChainIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <path d="M9 7h-2.5a3.5 3.5 0 0 0 0 7H9" />
    <path d="M15 17h2.5a3.5 3.5 0 0 0 0-7H15" />
    <path d="M8 12h8" />
  </svg>
);

export const PulseIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <path d="M3 12h4l2-4 4 8 2-4h4" />
  </svg>
);

export const CheckRingIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.3l2.2 2.2L15.8 9.2" />
  </svg>
);

export const MissedRingIcon = ({ size = 14, className }: MetricIconProps) => (
  <svg {...baseIconProps(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
);

export type SubtitleMetricProps = Readonly<{
  icon: React.ReactNode;
  value: string | number;
  label: string;
}>;

export const SubtitleMetric = ({ icon, value, label }: SubtitleMetricProps) => (
  <span className="sm-subtitle-metric" aria-label={label} title={label}>
    <span className="sm-subtitle-icon" aria-hidden="true">
      {icon}
    </span>
    <span className="sm-subtitle-value">{value}</span>
  </span>
);
