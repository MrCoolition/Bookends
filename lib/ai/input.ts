import { strFromU8, unzipSync } from "fflate";
import { SOW_MAX_FILE_BYTES, SOW_MAX_REQUEST_BYTES, SOW_MAX_TEXT_CHARACTERS, SowIntakeError, type SowSource } from "./contracts";

export type SowInput = { source: SowSource; text: string; pdf?: Uint8Array };
const invalid = (message: string) => new SowIntakeError("invalid_document", message);
function checkedText(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text.length < 30) throw invalid("Add at least a few sentences describing the work, team, and dates.");
  if (text.length > SOW_MAX_TEXT_CHARACTERS) throw new SowIntakeError("document_too_large", "Keep the document text below 60,000 characters. Try the relevant SOW sections.", 413);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw invalid("This file is not readable text. Upload a PDF, DOCX, or UTF-8 text file.");
  return text;
}
const safeName = (name: string) => name.replace(/[\\/]/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160).trim() || "SOW document";
function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? "";
    const point = parseInt(entity.slice(entity[1].toLowerCase() === "x" ? 2 : 1), entity[1].toLowerCase() === "x" ? 16 : 10);
    return point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
  });
}
/** Read only document text. No macros, embedded links, attachments, or XML entities execute. */
export function extractDocxText(bytes: Uint8Array): string {
  let expanded = 0, entries = 0;
  try {
    const parts = unzipSync(bytes, { filter(file) {
      if (++entries > 2000) throw invalid("This DOCX contains too many parts. Export a simpler document or paste its text.");
      if (!/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(file.name)) return false;
      expanded += file.originalSize;
      if (expanded > 2 * 1024 * 1024) throw new SowIntakeError("document_too_large", "This DOCX expands beyond the text limit. Paste the relevant SOW sections.", 413);
      return true;
    } });
    if (!parts["word/document.xml"]) throw invalid("This is not a readable DOCX document. Export it again or paste its text.");
    const paragraphs = Object.values(parts).map(part => {
      const xml = strFromU8(part);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw invalid("This DOCX contains unsupported XML declarations. Export it as PDF or plain text.");
      return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)\b[^>]*\/\s*>|<\/w:(?:p|tr|tc)>/g)]
        .map(match => match[1] === undefined ? "\n" : decodeXml(match[1])).join("");
    });
    return checkedText(paragraphs.join("\n"));
  } catch (error) {
    if (error instanceof SowIntakeError) throw error;
    throw invalid("This DOCX could not be opened. Export it again or paste its text.");
  }
}
export function sowTextInput(text: string): SowInput { return { source: { name: "Pasted brief", kind: "text" }, text: checkedText(text) }; }
export async function sowFileInput(file: File): Promise<SowInput> {
  if (!file.size) throw invalid("Choose a file containing the SOW.");
  if (file.size > SOW_MAX_FILE_BYTES) throw new SowIntakeError("document_too_large", "Choose a PDF, DOCX, or text file under 3 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer()), name = safeName(file.name);
  if (/\.pdf$/i.test(file.name)) {
    if (!strFromU8(bytes.subarray(0, 8)).startsWith("%PDF-")) throw invalid("This file is not a readable PDF. Export it again or paste its text.");
    return { source: { name, kind: "pdf" }, text: "", pdf: bytes };
  }
  if (/\.docx$/i.test(file.name)) return { source: { name, kind: "docx" }, text: extractDocxText(bytes) };
  if (/\.txt$/i.test(file.name)) {
    let raw: string;
    try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw invalid("Save the text file as UTF-8, or paste the brief instead."); }
    return { source: { name, kind: "text" }, text: checkedText(raw) };
  }
  throw invalid("Choose a PDF, DOCX, or TXT file. You can also paste the brief.");
}
/** Enforce the actual byte count even when Content-Length is absent or false. */
export async function readSowRequest(request: Request): Promise<SowInput> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) throw invalid("Send one file or a pasted brief.");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > SOW_MAX_REQUEST_BYTES) throw new SowIntakeError("document_too_large", "Choose a file under 3 MB.", 413);
  if (!request.body) throw invalid("Choose a document or paste the brief.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > SOW_MAX_REQUEST_BYTES) { await reader.cancel(); throw new SowIntakeError("document_too_large", "Choose a file under 3 MB.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData(); }
  catch { throw invalid("The upload was interrupted. Choose the document again."); }
  if ([...form.keys()].some(key => key !== "file" && key !== "text") || form.getAll("file").length > 1 || form.getAll("text").length > 1) throw invalid("Use one document or one pasted brief at a time.");
  const file = form.get("file"), text = form.get("text");
  if (file && text) throw invalid("Use a document or a pasted brief, one at a time.");
  if (file instanceof File) return sowFileInput(file);
  if (typeof text === "string") return sowTextInput(text);
  throw invalid("Choose a document or paste the brief.");
}
