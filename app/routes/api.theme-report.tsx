import { data as json, type ActionFunctionArgs } from "react-router";
import {
  authenticateStorefrontRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { optionsResponse, withCors } from "../utils/cors.server";
import {
  parseThemeReport,
  recordThemeReport,
} from "../models/themeCompatibility.server";
import { cappedJson } from "../utils/cappedJson.server";
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  try {
    const body = await cappedJson(request);
    const { shop, sessionId } = authenticateStorefrontRequest(request, body);
    const report = parseThemeReport(body.report);
    const ok = await recordThemeReport(shop, sessionId, report);
    return json(
      { ok },
      {
        status: ok ? 200 : 429,
        headers: withCors({ "Cache-Control": "no-store" }),
      },
    );
  } catch (error) {
    return json(
      { ok: false },
      {
        status: isStorefrontAuthError(error) ? error.status : 400,
        headers: withCors(),
      },
    );
  }
};
