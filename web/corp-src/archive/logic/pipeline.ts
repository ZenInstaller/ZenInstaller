import type { PipelineConfig, StageDefinition } from "../../types";
import { GRAPH_PERMISSIONS } from "../../config/azureConfig";
import { AZURE_VARIABLE_KEYS, AWS_VARIABLE_KEYS, C01_KEYS } from "../../logic/variables";

type StageSource = Omit<StageDefinition, "workflowId">;
type PipelineSource = Omit<PipelineConfig, "stages"> & { stages: StageSource[] };
const DEFINITIONS: Record<string, PipelineSource> = {
  corpSetup: {
    workflowId: "planChanges.yml",
    deployWorkflowId: "remoteLogin.yml",
    label: "Zenblox Core Environment Installer",
    templateRepo: "ZenMe-AU/ZenbloxCore",
    validEnvs: ["PROD", "TEST"] as const,
    stages: [
      {
        dir: "c01subscription",
        label: "Subscription Budget",
        azurePermissions: [],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
          {
            type: "stageVar",
            keys: C01_KEYS,
            label: "c01 variables",
            descriptions: {
              CONTACT_EMAILS: "Multiple emails — separate with a comma, e.g. alice@example.com,bob@example.com",
            },
          },
        ],
      },
      {
        dir: "c02globalGroups",
        label: "Global groups",
        azurePermissions: [
          GRAPH_PERMISSIONS.GroupReadWriteAll,
          GRAPH_PERMISSIONS.GroupMemberReadWriteAll,
          // TODO: confirm if PIM-managed group membership is needed (azuread_role_eligibility_schedule in c02 is commented out)
          // GRAPH_PERMISSIONS.PrivilegedAccessReadWriteAzureADGroup,
        ],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
        ],
      },
      /*
       * c05rootrg was replaced by the Corp Domain Setup + Terraform Setup cards,
       * which create the same resources directly via ARM/Graph from the browser.
       */
      {
        dir: "c07userAccounts",
        label: "User accounts",
        azurePermissions: [
          GRAPH_PERMISSIONS.GroupReadWriteAll,
          GRAPH_PERMISSIONS.GroupMemberReadWriteAll,
          GRAPH_PERMISSIONS.UserReadWriteAll,
          GRAPH_PERMISSIONS.RoleManagementReadWriteDirectory,
          GRAPH_PERMISSIONS.UserAuthenticationMethodReadWriteAll,
          GRAPH_PERMISSIONS.PolicyReadWriteAuthenticationMethod,
          GRAPH_PERMISSIONS.DomainReadWriteAll,
        ],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "var", key: "DNS" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
        ],
      },
      {
        dir: "c20awsentrasso",
        label: "AWS Entra SSO",
        azurePermissions: [GRAPH_PERMISSIONS.ApplicationReadWriteAll],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "var", key: "DNS" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
        ],
      },
      {
        dir: "c21awsentrassoP2",
        label: "AWS Entra SSO P2",
        azurePermissions: [
          GRAPH_PERMISSIONS.AppRoleAssignmentReadWriteAll,
          GRAPH_PERMISSIONS.PolicyReadWriteApplicationConfiguration,
        ],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "var", key: "DNS" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
          { type: "varGroup", keys: AWS_VARIABLE_KEYS, label: "AWS variables configured" },
        ],
      },
      {
        dir: "c25cloudfront",
        label: "CloudFront",
        azurePermissions: [GRAPH_PERMISSIONS.ApplicationReadWriteAll],
        prerequisites: [
          { type: "var", key: "NAME" },
          { type: "var", key: "DNS" },
          { type: "varGroup", keys: AZURE_VARIABLE_KEYS, label: "Azure variables configured" },
          { type: "varGroup", keys: AWS_VARIABLE_KEYS, label: "AWS variables configured" },
        ],
      },
    ],
  },
  // Add future pipelines here — no other files need to change
};

function withStageWorkflows(config: PipelineSource): PipelineConfig {
  return {
    ...config,
    stages: config.stages.map((stage) => ({ ...stage, workflowId: `plan-${stage.dir}.yml` })),
  };
}

export const PIPELINES: Record<string, PipelineConfig> = Object.fromEntries(
  Object.entries(DEFINITIONS).map(([name, config]) => [name, withStageWorkflows(config)]),
);

// Archived along with the stage cards; nothing in the live tree reads it.
export const PIPELINE = PIPELINES.corpSetup;
