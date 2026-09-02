import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---- Navigation ------------------------------------------------------- */

export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v10h14V10" />
  </Base>
);

export const LogIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v16M4 12h16" />
  </Base>
);

export const GroupIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.5a3 3 0 0 1 0 6M18.5 19a5.5 5.5 0 0 0-3-4.9" />
  </Base>
);

export const OverviewIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11M15 4v16" />
  </Base>
);

export const RankingIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 21V10M12 21V4M19 21v-7" />
  </Base>
);

export const ProfileIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </Base>
);

export const AdminIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Base>
);

export const LogoutIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M15 4h4v16h-4" />
    <path d="M10 8 6 12l4 4M6 12h10" />
  </Base>
);

/* ---- Status --------------------------------------------------------- */

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 13 4 4L19 7" />
  </Base>
);

export const MissedIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const PendingIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2" />
  </Base>
);

/* ---- UI ------------------------------------------------------------- */

export const CameraIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5A2 2 0 0 1 11 4h2a2 2 0 0 1 1.7 1L15.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.2" />
  </Base>
);

export const ClockIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Base>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m15 6-6 6 6 6" />
  </Base>
);

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const ArrowUpRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 17 17 7M8 7h9v9" />
  </Base>
);

export const FlagIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Base>
);

export const SparkIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </Base>
);

export const CoinIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9.5 9.5h3.75a1.75 1.75 0 0 1 0 3.5H9.5h4a1.75 1.75 0 0 1 0 3.5H9.5" />
  </Base>
);

export const ImageIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m4 16 4.5-4.5L11 14l3.5-3.5L20 16" />
  </Base>
);

export const ImageOffIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 4l16 16" />
    <path d="M20 16V6a2 2 0 0 0-2-2H8M4 8v10a2 2 0 0 0 2 2h10" />
    <path d="m6 18 4-4 2 2" />
  </Base>
);

export const ShieldIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
  </Base>
);

/** Straffbanken marker — a spare skull, not a cartoon. */
export const SkullIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3a7 7 0 0 0-7 7v3l1.5 2v2.5A1.5 1.5 0 0 0 8 20h8a1.5 1.5 0 0 0 1.5-1.5V16L19 14v-4a7 7 0 0 0-7-7Z" />
    <circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none" />
    <path d="M12 14v3M10.5 20v-2M13.5 20v-2" />
  </Base>
);

export const CalendarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Base>
);

export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const CopyIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Base>
);

export const DownloadIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </Base>
);

export const FilterIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5h16l-6 8v6l-4-2v-4z" />
  </Base>
);
