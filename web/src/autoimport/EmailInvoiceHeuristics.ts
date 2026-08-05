const SUBJECT_KEYWORDS = [
  "invoice", "receipt", "bill", "order confirmation", "payment confirmation",
  "purchase", "transaction", "e-invoice", "tax invoice",
  "बिल", "रसीद", "चालान", "बीजक",
];

const SENDER_DOMAINS = [
  "amazon.in", "flipkart.com", "myntra.com", "ajio.com",
  "swiggy.in", "zomato.com", "blinkit.com", "zepto.co",
  "irctc.co.in", "makemytrip.com", "goibibo.com",
  "airtel.in", "jio.com", "vodafone.in",
  "paytm.com", "phonepe.com", "razorpay.com",
  "bigbasket.com", "dunzo.in", "nykaa.com",
];

export function isInvoiceCandidate(subject: string, senderEmail: string): boolean {
  const ls = subject.toLowerCase();
  const le = senderEmail.toLowerCase();
  return (
    SUBJECT_KEYWORDS.some((k) => ls.includes(k)) ||
    SENDER_DOMAINS.some((d) => le.includes(d))
  );
}
