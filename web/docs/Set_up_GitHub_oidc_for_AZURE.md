# How to Set Up GitHub OIDC for Azure

GitHub OIDC lets GitHub Actions authenticate to Azure **without storing any secrets** — Azure issues a short-lived token at run time by trusting GitHub's identity provider.

## Prerequisites

- An Azure account and subscription — see [Creating AZURE account](/Creating_AZURE_account) if you haven't set one up yet
- **Azure subscription:** Owner or User Access Administrator — to assign RBAC roles to the Service Principal
- **Entra ID — Application Administrator** (or higher) — to create App Registrations and add federated credentials
- **Entra ID — Privileged Role Administrator** (or Global Administrator) — to grant admin consent for Microsoft Graph API application permissions

> If you only have Application Administrator but not Privileged Role Administrator, you can complete Steps 1–3 yourself and ask a Global Administrator to perform the "Grant admin consent" action in Step 4.

---

> **Prefer the CLI?** [Jump to Quick Setup — Azure CLI](#quick-setup-azure-cli) to complete Steps 1–4 with a single script.

---

## Step 1 of 5 — Register an App in Microsoft Entra ID

1. Go to [entra.microsoft.com](https://entra.microsoft.com/) and sign in.
2. In the left sidebar, under **Entra ID**, click **App registrations**.
3. Click **+ New registration**.
4. Fill in:

   | Field | Value |
   | ----- | ----- |
   | **Name** | A meaningful name, e.g. `github-actions-deployer` |
   | **Supported account types** | **Accounts in this organizational directory only** |
   | **Redirect URI** | Leave blank |

5. Click **Register**.
6. On the app overview page, copy and save:
   - **Application (client) ID**
   - **Directory (tenant) ID**

---

## Step 2 of 5 — Add a Federated Identity Credential

1. On the app registration page, click **Certificates & secrets** in the left sidebar.
2. Select the **Federated credentials** tab.
3. Click **+ Add credential**.
4. Under **Federated credential scenario**, select **GitHub Actions deploying Azure resources**.
5. Fill in:

   | Field | What to Enter |
   | ----- | ------------- |
   | **Organization** | Your GitHub organisation or username (e.g. `my-org`) |
   | **Repository** | The repository name (e.g. `ZBCorpArchitecture`) |
   | **Entity type** | **Environment** |
   | **GitHub environment name** | The GitHub Environment name (e.g. `PROD`) — must exactly match the `environment:` value in your workflow |
   | **Name** | A label for this credential (e.g. `github-actions-prod`) |

6. Click **Add**.

> **Tip:** Add one federated credential per GitHub Environment (e.g. `PROD`, `TEST`). Each environment can have its own protection rules (required reviewers, wait timers) in GitHub Settings.

---

## Step 3 of 5 — Assign Azure RBAC Roles

The app registration acts as a Service Principal. Assign roles at the subscription scope so it can deploy resources across all resource groups.

1. Go to **Subscriptions** and open your subscription.

   > On the overview page, copy and save the **Subscription ID**.

2. Click **Access control (IAM)** in the left sidebar.
3. Click **+ Add** → **Add role assignment**.
4. Assign the following roles one at a time. Both are under the **Privileged administrator roles** tab when searching:

   | Role | Why it is needed |
   | ---- | ---------------- |
   | **Contributor** | Create and manage all Azure resources |
   | **User Access Administrator** | Assign RBAC roles to managed identities and groups during deployment |

5. For each role:
   - **Role** tab: select the role and click **Next**
   - **Members** tab: set **Assign access to** = `User, group, or service principal` → **+ Select members** → search for the app name from Step 1 → click **Next**
   - **Conditions** tab *(User Access Administrator only)*: select **Allow user to assign all roles** to keep things simple, or select **Constrained** if you want to limit which roles the Service Principal can assign. See the note below.
   - Click **Review + assign**

> **Note:** If you choose **Constrained** on the User Access Administrator assignment, add **Owner**, **User Access Administrator**, and **Role Based Access Control Administrator** to the exclusion list to prevent the Service Principal from escalating its own privileges.

---

## Step 4 of 5 — Add Graph API Permissions

If your workflow creates Entra ID groups, users, or app registrations, the Service Principal also needs Microsoft Graph API permissions. Choose one of the three methods below.

### Permissions required

| Permission | Used for |
| ---------- | -------- |
| `Group.ReadWrite.All` | Create / manage Entra security groups |
| `GroupMember.ReadWrite.All` | Add members to groups |
| `User.ReadWrite.All` | Create and manage user accounts |
| `Application.ReadWrite.All` | Register and update app registrations |
| `AppRoleAssignment.ReadWrite.All` | Assign app roles to users and services |
| `RoleManagement.ReadWrite.Directory` | Assign PIM-eligible directory roles |
| `Policy.ReadWrite.AuthenticationMethod` | Manage FIDO2 / TAP policies |
| `PrivilegedAccess.ReadWrite.AzureADGroup` | PIM for groups |
| `UserAuthenticationMethod.ReadWrite.All` | Create Temporary Access Passes |

---

### Option A — Portal (step by step)

1. Go to **Microsoft Entra ID** → **App registrations** → your app.
2. Click **API permissions** in the left sidebar.
3. Click **+ Add a permission** → **Microsoft Graph** → **Application permissions**.
4. Search for and add each permission in the table above.
5. Click **Grant admin consent for [your tenant]** and confirm.

---

### Option B — Manifest editor (bulk paste)

Use this to replicate the same permission set quickly without clicking through the portal UI.

1. Open your app registration and click **Manifest** in the left sidebar.
2. Find the `"requiredResourceAccess"` key (it may be an empty array `[]`).
3. Replace it with the block below:

```json
"requiredResourceAccess": [
  {
    "resourceAppId": "00000003-0000-0000-c000-000000000000",
    "resourceAccess": [
      { "id": "62a82d76-70ea-41e2-9197-370581804d09", "type": "Role" },
      { "id": "dbaae8cf-10b5-4b86-a4a1-f871c94c6695", "type": "Role" },
      { "id": "741f803b-c850-494e-b5df-cde7c675a1ca", "type": "Role" },
      { "id": "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9", "type": "Role" },
      { "id": "06b708a9-e830-4db3-a914-8e69da51d44f", "type": "Role" },
      { "id": "9e3f62cf-ca93-4989-b6ce-bf83c28f9fe8", "type": "Role" },
      { "id": "29c18626-4985-4dcd-85c0-193eef327366", "type": "Role" },
      { "id": "2f6817f8-7b12-4f0f-bc18-eeaf60705a9e", "type": "Role" },
      { "id": "50483e42-d915-4231-9639-7fdb7fd190e5", "type": "Role" }
    ]
  }
]
```

4. Click **Save**.
5. Go to **API permissions** and click **Grant admin consent for [your tenant]**.

> **Replicating to a new app:** Open the source app's Manifest, copy the full `requiredResourceAccess` block, paste it into the new app's Manifest, save, then grant admin consent. No need to re-enter each permission by hand.

---

### Option C — Azure CLI / Cloud Shell (add to existing app)

Use this if the app already exists and you only need to add or update its permissions.

```bash
#!/bin/bash
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
APP_DISPLAY_NAME="github-actions-deployer"   # Change to match your app name
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

PERMISSIONS=(
  "Group.ReadWrite.All"
  "GroupMember.ReadWrite.All"
  "User.ReadWrite.All"
  "Application.ReadWrite.All"
  "AppRoleAssignment.ReadWrite.All"
  "RoleManagement.ReadWrite.Directory"
  "Policy.ReadWrite.AuthenticationMethod"
  "PrivilegedAccess.ReadWrite.AzureADGroup"
  "UserAuthenticationMethod.ReadWrite.All"
)

# ── Resolve app ───────────────────────────────────────────────────────────────
APP_ID=$(az ad app list --display-name "$APP_DISPLAY_NAME" --query "[0].appId" -o tsv)
if [[ -z "$APP_ID" ]]; then
  echo "Error: no app found with display name '$APP_DISPLAY_NAME'" >&2
  exit 1
fi
echo "App ID: $APP_ID"

# ── Resolve permission IDs from the Graph service principal ───────────────────
GRAPH_ROLES=$(az ad sp show --id "$GRAPH_APP_ID" --query "appRoles" -o json)

PERMISSION_ARGS=()
for PERM in "${PERMISSIONS[@]}"; do
  ID=$(echo "$GRAPH_ROLES" | jq -r --arg name "$PERM" '.[] | select(.value == $name) | .id')
  if [[ -z "$ID" ]]; then
    echo "Warning: permission '$PERM' not found — skipping" >&2
  else
    PERMISSION_ARGS+=("${ID}=Role")
  fi
done

# ── Add permissions and grant admin consent ───────────────────────────────────
az ad app permission add \
  --id "$APP_ID" \
  --api "$GRAPH_APP_ID" \
  --api-permissions "${PERMISSION_ARGS[@]}"

az ad app permission admin-consent --id "$APP_ID"

echo "Done. All permissions added and admin consent granted."
```

> **Note:** `az ad app permission admin-consent` requires Privileged Role Administrator or Global Administrator in Entra ID.

---

## Step 5 of 5 — Enter the Values in ZenInstaller

Return to the ZenInstaller page and open the **Environment** step. In the **Azure** section, enter:

| Field | Where to find it |
| ----- | ---------------- |
| `AZURE_CLIENT_ID` | Application (client) ID from Step 1 (or printed by the Quick Setup script) |
| `AZURE_TENANT_ID` | Directory (tenant) ID from Step 1 (or printed by the Quick Setup script) |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID from Step 3 (or printed by the Quick Setup script) |

ZenInstaller will save these as GitHub Actions variables in your repository automatically.

---

## Quick Setup — Azure CLI (covers Steps 1 – 4) {#quick-setup-azure-cli}

The script creates the app, adds federated credentials for each environment, assigns RBAC roles, and grants admin consent. Re-running it is safe — it skips any resources that already exist.

> **Troubleshooting — Cloud Shell credential error**
> If you see `Audience ... is not a supported MSI token audience`, Cloud Shell's automatic credentials don't cover the Microsoft Graph API. Run the following to re-authenticate interactively, then re-run the script:
> ```bash
> az logout
> az login
> ```

> **Troubleshooting — Consent validation failed**
> The CLI admin consent command can fail even for Global Administrators due to tenant-specific restrictions. If this happens, grant consent through the portal instead — it is always reliable:
> 1. Go to **Microsoft Entra ID** → **App registrations** → your app
> 2. Click **API permissions** in the left sidebar
> 3. Click **Grant admin consent for [your tenant]** and confirm

**Option A — Download and upload to Cloud Shell**

1. **Download** <a href="/scripts/azure-github-oidc-setup.sh" download>azure-github-oidc-setup.sh</a>
2. **Edit** the four variables at the top of the file
3. **Upload** to [Azure Cloud Shell](https://shell.azure.com): in the toolbar click **Manage files → Upload** and select the file
   > If this is your first time opening Cloud Shell: select **Bash** when prompted to choose a shell, then select your **Subscription** in the Getting started screen and click **Apply**.
4. **Run:**
   ```bash
   bash azure-github-oidc-setup.sh
   ```

---

**Option B — Paste directly into Cloud Shell**

Edit the configuration block, then paste the whole script into [Azure Cloud Shell](https://shell.azure.com):

> If this is your first time opening Cloud Shell: select **Bash** when prompted to choose a shell, then select your **Subscription** in the Getting started screen and click **Apply**.

```bash
#!/bin/bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Configuration — edit these values before running
# ══════════════════════════════════════════════════════════════════════════════
APP_NAME="github-actions-deployer"     # Display name for the app registration
GITHUB_ORG="my-org"                    # GitHub org or username
GITHUB_REPO="ZBCorpArchitecture"       # Repository name
ENVIRONMENTS=("PROD" "TEST")           # GitHub Environments (one federated credential each)
# ══════════════════════════════════════════════════════════════════════════════

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)
APP_ID=""

# Print ZenInstaller values on exit if the app was created
trap '
  if [[ -n "$APP_ID" ]]; then
    echo ""
    echo "====== Copy these into ZenInstaller ======"
    echo "AZURE_CLIENT_ID:       $APP_ID"
    echo "AZURE_TENANT_ID:       $TENANT_ID"
    echo "AZURE_SUBSCRIPTION_ID: $SUBSCRIPTION_ID"
  fi
' EXIT

# ── 1. Create app registration (skip if already exists) ───────────────────────
echo "Checking app registration..."
EXISTING_APP_ID=$(az ad app list --display-name "$APP_NAME" --query "[0].appId" -o tsv)

if [[ -n "$EXISTING_APP_ID" ]]; then
  echo "  App already exists: $EXISTING_APP_ID"
  APP_ID="$EXISTING_APP_ID"
  APP_OBJECT_ID=$(az ad app show --id "$APP_ID" --query id -o tsv)
else
  echo "  Creating app registration..."
  APP=$(az ad app create \
    --display-name "$APP_NAME" \
    --sign-in-audience AzureADMyOrg \
    --required-resource-accesses '[{"resourceAppId":"00000003-0000-0000-c000-000000000000","resourceAccess":[{"id":"62a82d76-70ea-41e2-9197-370581804d09","type":"Role"},{"id":"dbaae8cf-10b5-4b86-a4a1-f871c94c6695","type":"Role"},{"id":"741f803b-c850-494e-b5df-cde7c675a1ca","type":"Role"},{"id":"1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9","type":"Role"},{"id":"06b708a9-e830-4db3-a914-8e69da51d44f","type":"Role"},{"id":"9e3f62cf-ca93-4989-b6ce-bf83c28f9fe8","type":"Role"},{"id":"29c18626-4985-4dcd-85c0-193eef327366","type":"Role"},{"id":"2f6817f8-7b12-4f0f-bc18-eeaf60705a9e","type":"Role"},{"id":"50483e42-d915-4231-9639-7fdb7fd190e5","type":"Role"}]}]' \
    -o json)
  APP_ID=$(echo "$APP" | jq -r '.appId')
  APP_OBJECT_ID=$(echo "$APP" | jq -r '.id')
  echo "  Created: $APP_ID"
fi

# ── 2. Create service principal (skip if already exists) ──────────────────────
echo "Checking service principal..."
EXISTING_SP_ID=$(az ad sp list --filter "appId eq '$APP_ID'" --query "[0].id" -o tsv)

if [[ -n "$EXISTING_SP_ID" ]]; then
  echo "  Service principal already exists: $EXISTING_SP_ID"
  SP_OBJECT_ID="$EXISTING_SP_ID"
else
  echo "  Creating service principal..."
  SP=$(az ad sp create --id "$APP_ID" -o json)
  SP_OBJECT_ID=$(echo "$SP" | jq -r '.id')
  echo "  Created: $SP_OBJECT_ID"
fi

# ── 3. Add federated credentials (skip existing ones) ─────────────────────────
for ENV in "${ENVIRONMENTS[@]}"; do
  CRED_NAME="github-${ENV,,}"
  EXISTING_CRED=$(az ad app federated-credential list --id "$APP_OBJECT_ID" \
    --query "[?name=='$CRED_NAME'].id" -o tsv)

  if [[ -n "$EXISTING_CRED" ]]; then
    echo "  Federated credential '$CRED_NAME' already exists, skipping"
  else
    echo "  Adding federated credential for environment: $ENV"
    az ad app federated-credential create \
      --id "$APP_OBJECT_ID" \
      --parameters "{
        \"name\": \"$CRED_NAME\",
        \"issuer\": \"https://token.actions.githubusercontent.com\",
        \"subject\": \"repo:${GITHUB_ORG}/${GITHUB_REPO}:environment:${ENV}\",
        \"audiences\": [\"api://AzureADTokenExchange\"]
      }"
  fi
done

# ── 4. Assign RBAC roles (skip existing assignments) ─────────────────────────
SCOPE="/subscriptions/$SUBSCRIPTION_ID"
for ROLE in "Contributor" "User Access Administrator"; do
  EXISTING_ASSIGNMENT=$(az role assignment list \
    --role "$ROLE" \
    --assignee "$SP_OBJECT_ID" \
    --scope "$SCOPE" \
    --query "[0].id" -o tsv)

  if [[ -n "$EXISTING_ASSIGNMENT" ]]; then
    echo "  Role '$ROLE' already assigned, skipping"
  else
    echo "  Assigning role: $ROLE"
    az role assignment create \
      --role "$ROLE" \
      --assignee-object-id "$SP_OBJECT_ID" \
      --assignee-principal-type ServicePrincipal \
      --scope "$SCOPE"
  fi
done

# ── 5. Grant admin consent ────────────────────────────────────────────────────
echo "Granting admin consent..."
if ! az ad app permission admin-consent --id "$APP_ID" 2>/dev/null; then
  echo ""
  echo "  ⚠ Admin consent via CLI failed."
  echo "  Grant it manually in the portal:"
  echo "  Entra ID → App registrations → $APP_NAME → API permissions → Grant admin consent"
fi

echo "Done."
```

The script prints the three values you need for [Step 5](#step-5-of-5-enter-the-values-in-zeninstaller).
