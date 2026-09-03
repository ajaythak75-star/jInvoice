const SARVAM_API_BASE = "https://api.sarvam.ai";

// Indic Unicode blocks: Devanagari, Bengali, Gurmukhi, Gujarati, Oriya,
// Tamil, Telugu, Kannada, Malayalam
const INDIC_SCRIPT_RE =
  /[ऀ-ॿঀ-৿਀-੿઀-૿଀-୿஀-௿ఀ-౿ಀ-೿ഀ-ൿ]/;

export function looksIndian(text: string): boolean {
  return INDIC_SCRIPT_RE.test(text);
}

// Sarvam translate API accepts up to ~1000 chars per request; chunk large texts.
export async function translateToEnglish(text: string, apiKey: string): Promise<string> {
  const MAX = 900;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX) chunks.push(text.slice(i, i + MAX));

  const parts: string[] = [];
  for (const chunk of chunks) {
    const res = await fetch(`${SARVAM_API_BASE}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        input: chunk,
        source_language_code: "auto",
        target_language_code: "en-IN",
        model: "mayura:v1",
      }),
    });
    if (!res.ok) throw new Error(`Sarvam translate HTTP ${res.status}`);
    const data = await res.json();
    parts.push((data.translated_text as string | undefined) ?? chunk);
  }
  return parts.join(" ");
}
