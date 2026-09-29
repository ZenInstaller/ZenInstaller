import { expect, Locator, Page, test as setup } from "@playwright/test";
import fs from "fs";
import { CORP_URL } from "../../testInit";
import { authDir, azureSessionStorageFile, azureStorageStateFile, corpAzureAuthStateExists, saveAzureSessionStorage } from "../util/setupHelper.mts";

async function selectAzureTenant(page: Page, azureCard: Locator): Promise<string> {
  const tenantSelect = azureCard.getByTestId("tenant-select");
  const tenantInput = azureCard.getByPlaceholder("Tenant ID");
  await expect(tenantSelect.or(tenantInput)).toBeVisible({ timeout: 120_000 });
  await expect(azureCard.getByText("Loading tenants...", { exact: true })).toBeHidden({ timeout: 120_000 });
  await page.pause();

  if (!/^http:\/\/localhost:5173\/?(?:[/?#].*)?$/i.test(page.url())) {
    await page.waitForURL(/localhost:5173\/?(?:[/?#].*)?$/i, { timeout: 180_000 });
  }

  await expect(azureCard.getByText(/Signed in as/i)).toBeVisible({ timeout: 120_000 });
  await expect(tenantSelect.or(tenantInput)).toBeVisible({ timeout: 120_000 });
  console.log("Select the Azure tenant to use in the test browser. If prompted, enter a tenant ID and confirm it.");
  const selectedTenantControl = await tenantSelect.isVisible() ? tenantSelect.locator("input") : tenantInput;
  await expect(selectedTenantControl).toHaveValue(/\S/, { timeout: 180_000 });
  const selectedTenant = (await selectedTenantControl.inputValue()).trim();
  return selectedTenant;
}

// TODO: If the auth state already exist and is valid, only then succeed, otherwise fail!
setup("Manual setup for corp Azure auth tests", async ({ page, context }) => {
  setup.setTimeout(600_000);
  fs.mkdirSync(authDir, { recursive: true });

  // if (corpAzureAuthStateExists() && process.env.FORCE_AZURE_PASSKEY_SETUP !== "true") {
  //   console.log("Azure auth state already exists. Skipping manual passkey login.");
  //   console.log(`Storage state: ${azureStorageStateFile}`);
  //   console.log(`Session storage: ${azureSessionStorageFile}`);
  //   return;
  // }

  await page.goto(CORP_URL);

  const azureCard = page.locator("#card-azure_login");
  const signInButton = azureCard.getByRole("button", { name: "Sign in with Azure", exact: true });

  if (!(await signInButton.isVisible())) {
    await azureCard.getByText(/^Azure login$/i).click();
  }
  await expect(signInButton).toBeVisible();
  await signInButton.click();
  console.log("You need to manually sign in with your Azure UPN in the test browser.");
  await page.pause();

  try {
    await page.waitForURL(/localhost:5173\/?(?:[/?#].*)?$/i, { timeout: 180_000 });
  } catch {
    console.log("Page failed to redirect after manual sign in.");
    console.log(`Current URL: ${page.url()}`);

    if (page.url().startsWith(CORP_URL)) {
      await page
        .goto(CORP_URL, { waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch((err) => {
          console.log(`Fallback navigation was skipped: ${err.message}`);
        });
    }
  }

  const authenticatedAzureCard = await page.locator("#card-azure_login");
  await expect(authenticatedAzureCard.getByText(/Signed in as/i)).toBeVisible({ timeout: 120_000 });
  const selectedTenant = await selectAzureTenant(page, authenticatedAzureCard);

  const restoredAzureCard = page.locator("#card-azure_login");
  await expect(restoredAzureCard.getByText(/Signed in as/i)).toBeVisible({ timeout: 120_000 });
  const restoredTenantSelect = restoredAzureCard.getByTestId("tenant-select");
  const restoredTenantInput = restoredAzureCard.getByPlaceholder("Tenant ID");
  await expect(restoredTenantSelect.or(restoredTenantInput)).toBeVisible({ timeout: 120_000 });

  const restoredTenantValue = await restoredTenantSelect.isVisible()
    ? restoredTenantSelect.locator("input")
    : restoredTenantInput;
  await expect(restoredTenantValue).toHaveValue(selectedTenant);

  await page.evaluate((tenantId) => sessionStorage.setItem("zeninstaller_arm_tenant", tenantId), selectedTenant);

  await page.context().storageState({ path: azureStorageStateFile });
  await saveAzureSessionStorage(context);

  console.log(`Saved Azure tenant and auth storage state: ${azureStorageStateFile}`);
  console.log(`Saved Azure auth session storage: ${azureSessionStorageFile}`);
});
