import { expect, Locator, Page, test as setup } from "@playwright/test";
import fs from "fs";
import { CORP_URL, TENANT_ID } from "../../testInit";
import { authDir, azureSessionStorageFile, azureStorageStateFile, corpAzureAuthStateExists, saveAzureSessionStorage } from "../util/setupHelper.mts";

// Selects the tenant identified by `tenantId`, whether it appears in the fetched tenant dropdown
// or must be typed into the manual "Tenant ID" field (e.g. for personal Microsoft accounts).
async function selectAzureTenant(page: Page, azureCard: Locator, tenantId: string): Promise<void> {
  const tenantSelect = azureCard.getByTestId("tenant-select");
  const tenantInput = azureCard.getByPlaceholder("Tenant ID");
  await expect(tenantSelect.or(tenantInput)).toBeVisible({ timeout: 120_000 });

  if (await tenantSelect.isVisible()) {
    //TODO: Do not auto select a value here, let the user select a value and then save that value to the config file for future tests.
    await tenantSelect.click();
    const tenantOption = page.getByRole("option").filter({ hasText: tenantId }).first();
    await expect(tenantOption).toBeVisible({ timeout: 30_000 }); 
    await tenantOption.click();
  } else {
    await tenantInput.fill(tenantId);
    await azureCard.getByRole("button", { name: "Confirm tenant" }).click();
  }
}

// TODO: If the auth state already exist and is valid, only then succeed, otherwise fail!
setup("Manual setup for corp Azure auth tests", async ({ page, context }) => {
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
  console.log("You need to manually sign into your Azure account in the test browser.");
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
  console.log(`Selecting tenant "${TENANT_ID}" automatically.`);
  await selectAzureTenant(page, authenticatedAzureCard, TENANT_ID);

  console.log("Waiting for Azure auth flow...")
  const microsoftConsent = page.waitForURL(/login\.microsoftonline\.com|login\.live\.com/i, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (await microsoftConsent) {
    await page.pause();
    await page.waitForURL(CORP_URL, { timeout: 180_000 });
  }

  const restoredAzureCard = page.locator("#card-azure_login");
  await expect(restoredAzureCard.getByText(/Signed in as/i)).toBeVisible({ timeout: 120_000 });
  const restoredTenantSelect = restoredAzureCard.getByTestId("tenant-select");
  const restoredTenantInput = restoredAzureCard.getByPlaceholder("Tenant ID");
  await expect(restoredTenantSelect.or(restoredTenantInput)).toBeVisible({ timeout: 120_000 });

  const restoredTenantValue = await restoredTenantSelect.isVisible()
    ? restoredTenantSelect.locator("input")
    : restoredTenantInput;
  let azureTenantId = (await restoredTenantValue.inputValue()).trim();

  if (!azureTenantId) {
    console.log(`Tenant selection was not restored. Selecting tenant "${TENANT_ID}" automatically.`);
    await selectAzureTenant(page, restoredAzureCard, TENANT_ID);

    azureTenantId = (await restoredTenantValue.inputValue()).trim();
  }

  if (!azureTenantId) throw new Error("Select or confirm an Azure tenant before resuming the setup test.");

  await page.evaluate((tenantId) => sessionStorage.setItem("zeninstaller_arm_tenant", tenantId), azureTenantId);

  await page.context().storageState({ path: azureStorageStateFile });
  await saveAzureSessionStorage(context);

  console.log(`Saved Azure auth storage state: ${azureStorageStateFile}`);
  console.log(`Saved Azure auth session storage: ${azureSessionStorageFile}`);
});
