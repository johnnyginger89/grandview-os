import { Card, CardHeader, PageHeader } from "@/components/ui";
import { needsMfaEnrollment, requireUser } from "@/lib/authz/guard";
import { ROLE_LABELS } from "@/lib/authz/permissions";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata = { title: "Account security" };

export default async function SecurityPage() {
  const user = await requireUser({ allowMfaPending: true });
  const mustEnroll = needsMfaEnrollment(user);
  return (
    <>
      <PageHeader title="Account security" description={`${user.name} · ${user.email} · ${ROLE_LABELS[user.role]}`} />
      {mustEnroll && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Your role has access to customer and financial information, so two-factor authentication is required before you continue.
        </div>
      )}
      <Card className="max-w-xl">
        <CardHeader title="Two-factor authentication" description="Use an authenticator app such as Google Authenticator, 1Password or Microsoft Authenticator." />
        <div className="p-4">
          <TwoFactorSetup enabled={user.twoFactorEnabled} />
        </div>
      </Card>
    </>
  );
}
