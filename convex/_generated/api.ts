import { anyApi } from "convex/server";
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

import type * as messages from "../messages";
import type * as projects from "../projects";
import type * as sessions from "../sessions";

type AppModules = {
  messages: typeof messages;
  projects: typeof projects;
  sessions: typeof sessions;
};

declare const fullApi: ApiFromModules<AppModules>;

export const api = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

export const internal = anyApi as unknown as FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
