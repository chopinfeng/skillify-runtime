import type { ActionDefinition } from "./types";
import { bigmodelActions } from "./platforms/bigmodel-cn/actions";
import { feishuActions } from "./platforms/feishu/actions";

export const ALL_ACTIONS: ActionDefinition[] = [...bigmodelActions, ...feishuActions];

export const ACTIONS_BY_NAME: Record<string, ActionDefinition> = Object.fromEntries(
  ALL_ACTIONS.map((action) => [action.tool.name, action]),
);
