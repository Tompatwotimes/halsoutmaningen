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
  /** Longer label for the desktop rail / screen-reader context. */
  fullLabel?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * - `bar`    — a tab in the mobile bottom navigation
   * - `center` — the elevated primary action in the middle of the bar
   * - `menu`   — reachable from the top bar / desktop rail only
   */
  slot: 'bar' | 'center' | 'menu';
  adminOnly?: boolean;
  end?: boolean;
}

/**
 * Application navigation as data so the shell, bottom bar, desktop rail and
 * route table stay in sync (docs/PRODUCT_SPEC.md §6).
 *
 * IA decision (design phase): the five challenge destinations live in the
 * mobile bottom bar with "Logga" elevated as the primary action. "Profil"
 * is reached from the avatar in the top bar (a native-app pattern) and sits
 * in the desktop rail. Admin is a separate area, linked for admins only.
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Hem', icon: HomeIcon, slot: 'bar', end: true },
  { path: '/gruppen', label: 'Gruppen', icon: GroupIcon, slot: 'bar' },
  { path: '/logga', label: 'Logga', fullLabel: 'Logga träning', icon: LogIcon, slot: 'center' },
  { path: '/oversikt', label: 'Översikt', icon: OverviewIcon, slot: 'bar' },
  { path: '/ranking', label: 'Ranking', icon: RankingIcon, slot: 'bar' },
  { path: '/profil', label: 'Profil', icon: ProfileIcon, slot: 'menu' },
  {
    path: '/admin',
    label: 'Admin',
    fullLabel: 'Administration',
    icon: AdminIcon,
    slot: 'menu',
    adminOnly: true,
  },
];

export const BAR_ITEMS = NAV_ITEMS.filter((i) => i.slot === 'bar');

export const CENTER_ITEM: NavItem = NAV_ITEMS.find(
  (i) => i.slot === 'center',
) ?? {
  path: '/logga',
  label: 'Logga',
  fullLabel: 'Logga träning',
  icon: LogIcon,
  slot: 'center',
};
