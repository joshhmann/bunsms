import { DOMParser, XMLSerializer, onWarningStopParsing } from "@xmldom/xmldom";
import type { Element } from "@xmldom/xmldom";
import { readFileSync, writeFileSync } from "node:fs";

export interface ServerStringEntry {
  section: string[];
  id: string;
  fields: Array<{ name: string; value: string }>;
}

/** Update exact WZ string directories regardless of source whitespace/indentation. */
export function upsertServerStrings(path: string, rootName: string, entries: ServerStringEntry[]): void {
  const document = new DOMParser({ onError: onWarningStopParsing }).parseFromString(readFileSync(path, "utf8"), "text/xml");
  const root = document.documentElement;
  if (!root || root.tagName !== "imgdir" || root.getAttribute("name") !== rootName) {
    throw new Error(`Unexpected server string root in ${rootName}`);
  }
  const indexes = new Map<Element, Map<string, Element[]>>();
  function directories(parent: Element): Map<string, Element[]> {
    const existing = indexes.get(parent);
    if (existing) return existing;
    const result = new Map<string, Element[]>();
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1 || child.nodeName !== "imgdir") continue;
      // The DOM node type/tag check establishes the parser's Element contract.
      const element = child as Element;
      const name = element.getAttribute("name") || "";
      const matching = result.get(name);
      if (matching) matching.push(element); else result.set(name, [element]);
    }
    indexes.set(parent, result);
    return result;
  }
  for (const update of entries) {
    let parent = root;
    for (const section of update.section) {
      const matches = directories(parent).get(section);
      if (matches?.length !== 1) throw new Error(`Missing or ambiguous ${rootName}/${update.section.join("/")}`);
      parent = matches[0];
    }
    const children = directories(parent);
    for (const old of children.get(update.id) || []) parent.removeChild(old);
    const entry = document.createElement("imgdir");
    entry.setAttribute("name", update.id);
    for (const field of update.fields) {
      const value = document.createElement("string");
      value.setAttribute("name", field.name); value.setAttribute("value", field.value);
      entry.appendChild(value);
    }
    parent.appendChild(entry); children.set(update.id, [entry]);
  }
  writeFileSync(path, new XMLSerializer().serializeToString(document), "utf8");
}
