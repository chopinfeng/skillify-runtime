import { ALL_ACTIONS } from "../registry";

export function handleListTools(request: Request): Response {
  const platform = new URL(request.url).searchParams.get("platform");
  const tools = ALL_ACTIONS.map((a) => a.tool).filter((t) => !platform || t.platform === platform);
  return Response.json({ tools });
}
