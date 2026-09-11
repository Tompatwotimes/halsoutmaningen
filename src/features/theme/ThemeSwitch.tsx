import { MonitorIcon, MoonIcon, SunIcon } from '@/components/icons';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useTheme } from './useTheme';
import type { ThemePreference } from './theme';

const OPTIONS = [
  { value: 'light', label: 'Ljus', icon: <SunIcon /> },
  { value: 'dark', label: 'Mörk', icon: <MoonIcon /> },
  { value: 'system', label: 'System', icon: <MonitorIcon /> },
] as const satisfies readonly {
  value: ThemePreference;
  label: string;
  icon: React.ReactNode;
}[];

/** The appearance picker — lives in Profile (design: a settings row, not a
 * dedicated page for one control). */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl
      options={OPTIONS}
      value={preference}
      onChange={setPreference}
      ariaLabel="Utseende"
    />
  );
}
