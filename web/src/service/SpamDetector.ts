const FRAUD_KEYWORDS = [
  "urgent action required", "verify your account", "account suspended", "click here immediately",
  "your account will be closed", "lottery winner", "you have won", "unclaimed funds",
  "advance fee", "wire money", "gift card payment", "bitcoin payment",
  "password expired", "update your credentials", "unauthorized access detected",
  "congratulations you have been selected", "claim your prize", "limited time offer",
  "act now", "free money", "earn from home", "make money fast",
];

const SUSPICIOUS_SENDER_PATTERNS = [
  /no.?reply@(?!amazon|flipkart|swiggy|zomato|irctc|makemytrip|airtel|jio|paytm|phonepe|razorpay|bigbasket|nykaa|myntra|ajio|blinkit|zepto)/i,
  /support@(?!google|microsoft|apple|amazon|paypal)/i,
  /admin@[^.]+\.(xyz|top|click|loan|work|online|site|tk|ml|ga|cf)$/i,
];

export interface ThreatAssessment {
  isSuspicious: boolean;
  riskLevel: "low" | "medium" | "high";
  reason: string;
}

function quickCheck(subject: string, senderEmail: string): { needsClaude: boolean; assessment: ThreatAssessment } {
  const ls = subject.toLowerCase();
  const le = senderEmail.toLowerCase();

  const keywordHit = FRAUD_KEYWORDS.find((k) => ls.includes(k));
  const patternHit = SUSPICIOUS_SENDER_PATTERNS.some((p) => p.test(le));

  if (keywordHit || patternHit) {
    return {
      needsClaude: true,
      assessment: {
        isSuspicious: true,
        riskLevel: "medium",
        reason: keywordHit ? `Suspicious keyword: "${keywordHit}"` : "Suspicious sender pattern",
      },
    };
  }
  return { needsClaude: false, assessment: { isSuspicious: false, riskLevel: "low", reason: "" } };
}

export async function assessEmailThreat(subject: string, senderEmail: string): Promise<ThreatAssessment> {
  const { needsClaude, assessment: quick } = quickCheck(subject, senderEmail);
  if (!needsClaude) return quick;

  const apiKey = (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? "";
  if (!apiKey) return quick;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: `Is this email spam, phishing, or fraudulent? Reply with JSON only: {"suspicious":true/false,"risk":"low"/"medium"/"high","reason":"one short phrase"}\n\nSubject: ${subject}\nSender: ${senderEmail}`,
          },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const data = (await resp.json()) as { content?: { text: string }[] };
    const text = data.content?.[0]?.text ?? "";
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { suspicious: boolean; risk: "low" | "medium" | "high"; reason: string };
      return { isSuspicious: parsed.suspicious, riskLevel: parsed.risk, reason: parsed.reason };
    }
  } catch (e) {
    console.warn("[SpamDetector] Claude check failed:", e);
  }

  return quick;
}
