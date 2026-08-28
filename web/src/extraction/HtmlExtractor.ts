const NOISE_TAGS = new Set(["script", "style", "noscript", "head", "meta", "link", "svg", "img"]);
const BLOCK_TAGS = new Set(["p", "div", "tr", "li", "br", "hr", "h1", "h2", "h3", "td", "th", "header", "footer", "section"]);
const INVOICE_KEYWORDS = ["invoice", "receipt", "bill to", "amount due", "total", "₹", "inr", "gst", "tax"];

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  NOISE_TAGS.forEach((tag) => doc.querySelectorAll(tag).forEach((el) => el.remove()));

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent?.trim() ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = (node as Element).tagName.toLowerCase();
    const children = [...node.childNodes].map(walk).filter(Boolean).join("  ");
    return BLOCK_TAGS.has(tag) ? `\n${children}\n` : children;
  }

  return walk(doc.body).replace(/\n{3,}/g, "\n\n").replace(/ {2,}/g, " ").trim();
}

export function looksLikeInvoice(html: string): boolean {
  const lower = html.toLowerCase();
  return INVOICE_KEYWORDS.filter((k) => lower.includes(k)).length >= 3;
}
