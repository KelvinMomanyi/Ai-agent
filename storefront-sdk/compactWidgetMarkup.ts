import * as ts from "typescript";
import type { Plugin } from "vite";

// Template indentation is source formatting, but JS minifiers must preserve it
// inside strings. Collapse only literal HTML line indentation at build time.
// Interpolated values (including shopper/merchant text) are never inspected.
export function compactWidgetMarkup(): Plugin {
  return {
    name: "compact-widget-markup",
    enforce: "pre",
    transform(source, id) {
      if (!/[\\/]src[\\/](?:widgets|agent)[\\/].*\.ts$/.test(id)) return;
      const file = ts.createSourceFile(
        id,
        source,
        ts.ScriptTarget.Latest,
        true,
      );
      const edits: Array<{ start: number; end: number; value: string }> = [];
      function visit(node: ts.Node) {
        if (
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          let template: ts.Node = node;
          if (!ts.isNoSubstitutionTemplateLiteral(node)) {
            template = node.parent;
            if (ts.isTemplateSpan(template)) template = template.parent;
          }
          if (
            /<[a-z][\s>]/i.test(template.getText(file)) ||
            /<[a-z][\w-]+[\s>]/i.test(template.getText(file))
          ) {
            const raw = node.getText(file),
              value = raw.replace(/[ \t]*\r?\n[ \t]*/g, " ");
            if (raw !== value)
              edits.push({ start: node.getStart(file), end: node.end, value });
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
      for (const edit of edits.sort((a, b) => b.start - a.start))
        source =
          source.slice(0, edit.start) + edit.value + source.slice(edit.end);
      return edits.length ? { code: source, map: null } : undefined;
    },
  };
}
