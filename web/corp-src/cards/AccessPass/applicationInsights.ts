/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

import { ApplicationInsights } from "@microsoft/applicationinsights-web";
import { ReactPlugin } from "@microsoft/applicationinsights-react-js";
import { ClickAnalyticsPlugin } from "@microsoft/applicationinsights-clickanalytics-js";

export const reactPlugin = new ReactPlugin();
let appInsights: ApplicationInsights | null = null;
let debugEnabled = import.meta.env.DEV;

export interface MonitorOptions {
  page: string; // Page identity attached to every telemetry item (ai.cloud.roleInstance + appPage property)
  connectionString?: string; // Overrides the env-derived connection string. Defaults to import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING
  role?: string; //  Application Map node name (ai.cloud.role). Defaults to "ZenInstallerFrontend"
  debug?: boolean; // Defaults to import.meta.env.DEV
}

export function initMonitor({ page, connectionString, role = "ZenInstallerFrontend", debug }: MonitorOptions): boolean {
  if (debug !== undefined) debugEnabled = debug;
  if (appInsights) return true;
  const conn = connectionString || import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING || "";
  if (!conn) {
    if (debugEnabled) console.info("[monitor] no connection string — telemetry disabled");
    return false;
  }
  try {
    const clickPluginInstance = new ClickAnalyticsPlugin();
    const clickPluginConfig = { autoCapture: true };
    const instance = new ApplicationInsights({
      config: {
        connectionString: conn,
        enableAutoRouteTracking: true,
        samplingPercentage: 100,
        extensions: [reactPlugin, clickPluginInstance],
        extensionConfig: {
          [clickPluginInstance.identifier]: clickPluginConfig,
        },
      },
    });
    instance.addTelemetryInitializer((envelope) => {
      envelope.tags = envelope.tags || {};
      envelope.tags["ai.cloud.role"] = role;
      envelope.tags["ai.cloud.roleInstance"] = page;
      if (envelope.baseData) {
        envelope.baseData.properties = { ...envelope.baseData.properties, appPage: page };
      }
      if (debugEnabled) console.log("[monitor]", envelope);
    });
    instance.loadAppInsights();
    appInsights = instance;
    if (debugEnabled) console.info(`[monitor] initialized — page="${page}" role="${role}"`);
    return true;
  } catch (error) {
    console.error("[monitor] Application Insights has an invalid connection string — telemetry disabled:", error);
    return false;
  }
}

export function getAppInsights(): ApplicationInsights | null {
  return appInsights;
}

export function isDebugEnabled(): boolean {
  return debugEnabled;
}

initMonitor({ page: "corp" });
