import { PageHeader } from '@/components/ui/PageHeader';
import { ComingSoon } from '@/components/feedback/ComingSoon';
import { useAuth } from '@/features/auth/useAuth';

export function ProfilePage() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader
        title="Profil"
        subtitle={user?.email ?? 'Din profil och personliga statistik.'}
      />
      <ComingSoon
        phase="Fas 5 – Idag & personlig status"
        what="Streak, längsta streak, genomförda/missade dagar, skuld och träningshistorik"
      />
    </>
  );
}
