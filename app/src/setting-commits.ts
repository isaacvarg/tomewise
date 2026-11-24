import { type AppSetting, CONFIG_FILE, subjectPath, type TomewiseConfig } from "@tomewise/core";

export interface SettingChange {
  file: string;
  path: [string, ...string[]];
  value: unknown;
  message: string;
}

const SETTING_MESSAGE = /^chore\([A-Za-z0-9][\w.-]*\): set (theme to \S+|start to \S+|subject order|assessments)$/;

export function isSettingMessage(subject: string): boolean {
  return SETTING_MESSAGE.test(subject);
}

function describe(key: AppSetting, value: unknown): string {
  if (key === "theme" || key === "start") return `${key} to ${value}`;
  if (key === "subjects") return "subject order";
  return "assessments";
}

export function homeSettingChange(key: AppSetting, config: TomewiseConfig): SettingChange {
  const value = config[key];
  return { file: CONFIG_FILE, path: [key], value, message: `chore(home): set ${describe(key, value)}` };
}

export function subjectAssessmentsChange(subject: string, value: unknown): SettingChange {
  return { file: subjectPath(subject, "subject.json"), path: ["settings", "assessments"], value, message: `chore(${subject}): set assessments` };
}
