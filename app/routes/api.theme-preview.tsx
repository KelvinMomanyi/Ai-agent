import { data as json, type ActionFunctionArgs } from "react-router";
import {
  verifyAppProxyRequest,
  isStorefrontAuthError,
} from "../utils/storefrontAuth.server";
import { withCors, optionsResponse } from "../utils/cors.server";
import { cappedJson } from "../utils/cappedJson.server";
import {
  bootstrapThemePreview,
  saveThemePreview,
  verifyThemePreview,
} from "../models/themePreview.server";
import { isInstalledShop } from "../models/installedShop.server";
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return optionsResponse();
  try {
    const { shop } = verifyAppProxyRequest(request);
    if (!(await isInstalledShop(shop))) throw new Error("Shop unavailable");
    const body = await cappedJson(request);
    if (typeof body.token !== "string" || body.token.length > 2000)
      throw new Error("Invalid token");
    const claims = verifyThemePreview(body.token, shop);
    const result =
      body.intent === "bootstrap"
        ? await bootstrapThemePreview(shop, claims, body.identity)
        : body.intent === "report"
          ? await saveThemePreview(shop, claims, body.report)
          : null;
    if (!result) throw new Error("Invalid preview intent");
    return json(result, { headers: withCors({ "Cache-Control": "no-store" }) });
  } catch (error) {
    return json(
      {
        error:
          "Preview expired, already used, or unavailable. Create a new test link in AOVBoost.",
      },
      {
        status: isStorefrontAuthError(error) ? error.status : 400,
        headers: withCors({ "Cache-Control": "no-store" }),
      },
    );
  }
};
