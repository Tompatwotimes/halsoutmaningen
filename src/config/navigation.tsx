import type { ComponentType, SVGProps } from 'react';
import {
  AdminIcon,
  GroupIcon,
  HomeIcon,
  LogIcon,
  OverviewIcon,
  ProfileIcon,
  RankingIcon,
} from '@/components/icons';

export interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Shown in the primary bottom navigation on mobile. */
  primary: boolean;
  adminOnly?: boolean;
}

/**
 * Application navigation. Kept as data so the shell, bottom nav and route
 * table stay in sync (docs/PRODUCT_SPEC.md §6).
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Hem', icon: HomeIcon, primary: true },
  { path: '/logga', label: 'Logga', icon: LogIcon, primary: true },
  { path: '/gruppen', label: 'Gruppen', icon: GroupIcon, primary: true },
  { path: '/oversikt', label: 'Översikt', icon: OverviewIcon, primary: true },
  { path: '/ranking', label: 'Ranking', icon: RankingIcon, primary: true },
  { path: '/profil', label: 'Profil', icon: ProfileIcon, primary: false },
  {
    path: '/admin',
    label: 'Administration',
    icon: AdminIcon,
    primary: false,
    adminOnly: true,
  },
];
