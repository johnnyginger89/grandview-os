import { Card, CardHeader, PageHeader } from "@/components/ui";
import { needsPasswordChange, needsTwoFactorSetup, requireUser } from "@/lib/authz/guard";
import { ROLE_LABELS } from "@/lib/authz/permissions";
import { BackupCodes } from "./backup-codes";
import { ChangePassword } from "./change-password";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata = { title: "Account security" };

export default async function SecurityPage() {
  const user = await requireUser({ allowSetupPending: true });
  const mustChangePassword = needsPasswordChange(user);
  const mustEnroll = needsTwoFactorSetup(user);
  const twoFactor = (
    <Card key="two-factor" className="max-w-xl">
      <CardHeader title="Two-factor authentication" description="Use an authenticator app such as Google Authenticator, 1Password or Microsoft Authenticator." />
      <div className="p-4">
        <TwoFactorSetup enabled={user.twoFactorEnabled} />
      </div>
    </Card>
  );
  const password = (
    <Card key="password" className="max-w-xl" role="region" aria-label="Password">
      <CardHeader title="Password" />
      <div className="p-4">
        <ChangePassword hasTwoFactor={user.twoFactorEnabled} required={mustChangePassword} />
      </div>
    </Card>
  );
  return (
    <>
      <PageHeader title="Account security" description={`${user.name} · ${user.email} · ${ROLE_LABELS[user.role]}`} />
      {mustChangePassword ? (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          You signed in with a temporary password. Choose your own password before you continue.
        </div>
      ) : (
        mustEnroll && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
            Your role has access to customer and financial information, so two-factor authentication is required before you continue.
          </div>
        )
      )}
      {/* A temporary password comes first: setting up two-factor asks for the password. */}
      <div className="space-y-4">{mustChangePassword ? [password, twoFactor] : [twoFactor, password]}</div>
      {user.twoFactorEnabled && (
        <Card className="mt-4 max-w-xl" role="region" aria-label="Backup codes">
          <CardHeader title="Backup codes" description="Each one signs you in once when you don't have your phone." />
          <div className="p-4">
            <BackupCodes />
          </div>
        </Card>
      )}
    </>
  );
}
