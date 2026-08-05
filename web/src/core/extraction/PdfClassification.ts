export type PageType = "native" | "scanned";

export type PdfClassification =
  | "native"
  | "scanned"
  | "encrypted"
  | { mixed: Record<number, PageType> };
