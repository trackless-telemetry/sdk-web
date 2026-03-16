/**
 * PII guard for generic event properties.
 *
 * Key blocklist + value regex detection.
 * Strips properties that might contain personally identifiable information.
 */

const BLOCKED_KEYS = new Set([
  "email",
  "phone",
  "name",
  "address",
  "ssn",
  "password",
  "token",
  "secret",
  "credit_card",
  "creditcard",
  "card_number",
  "cardnumber",
  "first_name",
  "firstname",
  "last_name",
  "lastname",
  "full_name",
  "fullname",
  "username",
  "user_name",
  "user_id",
  "userid",
  "ip",
  "ip_address",
  "ipaddress",
  "device_id",
  "deviceid",
]);

/** Patterns that suggest PII in values */
const PII_VALUE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // email
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, // phone
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card
];

const MAX_PROPERTIES = 10;
const MAX_KEY_LENGTH = 50;
const MAX_VALUE_LENGTH = 200;

/**
 * Sanitize event properties by removing PII.
 *
 * @returns sanitized properties, or undefined if all were stripped
 */
export function sanitizeProperties(
  properties: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!properties) return undefined;

  const result: Record<string, string> = {};
  let count = 0;

  for (const [key, value] of Object.entries(properties)) {
    if (count >= MAX_PROPERTIES) break;

    const normalizedKey = key.toLowerCase();

    // Skip blocked keys
    if (BLOCKED_KEYS.has(normalizedKey)) continue;

    // Skip if value matches PII patterns
    if (typeof value === "string" && PII_VALUE_PATTERNS.some((p) => p.test(value))) continue;

    // Truncate key and value
    const safeKey = normalizedKey.slice(0, MAX_KEY_LENGTH);
    const safeValue = typeof value === "string" ? value.slice(0, MAX_VALUE_LENGTH) : String(value);

    result[safeKey] = safeValue;
    count++;
  }

  return count > 0 ? result : undefined;
}
