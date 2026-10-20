import { test as setup } from "@playwright/test";
import { login, ROLES_UNDER_TEST, statePath } from "./helpers";

for (const role of ROLES_UNDER_TEST) {
  setup(`sign in as ${role}`, async ({ page }) => {
    await login(page, role);
    await page.context().storageState({ path: statePath(role) });
  });
}
