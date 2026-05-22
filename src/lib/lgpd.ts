const CPF_REGEX = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_REGEX = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?<!\d)(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}(?!\d)/g;

export function digitsOnly(value: string) {
  return String(value || "").replace(/\D/g, "");
}

export function isCpf(value: string) {
  const digits = digitsOnly(value);
  return digits.length === 11 && isValidCpfDigits(digits);
}

export function isCnpj(value: string) {
  const digits = digitsOnly(value);
  return digits.length === 14 && isValidCnpjDigits(digits);
}

export function maskCpf(value: string) {
  const digits = digitsOnly(value);
  if (digits.length !== 11) return "***.***.***-**";
  return `***.***.***-${digits.slice(-2)}`;
}

export function maskCnpj(value: string) {
  const digits = digitsOnly(value);
  if (digits.length !== 14) return "**.***.***/****-**";
  return `**.***.***/****-${digits.slice(-2)}`;
}

export function maskPhone(value: string) {
  const digits = digitsOnly(value);
  if (digits.length < 8) return "***";
  return `***${digits.slice(-4)}`;
}

export function maskEmail(value: string) {
  const [user, domain] = String(value).split("@");
  if (!user || !domain) return "***@***";
  return `${user.slice(0, 2)}***@${domain}`;
}

export function sanitizeTextLgpd(value: string) {
  return String(value || "")
    .replace(CNPJ_REGEX, (match) => maskCnpj(match))
    .replace(CPF_REGEX, (match) => maskCpf(match))
    .replace(EMAIL_REGEX, (match) => maskEmail(match))
    .replace(PHONE_REGEX, (match) => {
      const digits = digitsOnly(match);
      if (digits.length === 11 && isValidCpfDigits(digits)) return maskCpf(match);
      if (digits.length === 14 && isValidCnpjDigits(digits)) return maskCnpj(match);
      return maskPhone(match);
    });
}

export function sanitizeForAudit<T>(value: T): T {
  if (typeof value === "string") return sanitizeTextLgpd(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeForAudit(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAudit(item)])) as T;
  }
  return value;
}

function isValidCpfDigits(digits: string) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const calc = (factor: number) => {
    let total = 0;
    for (let i = 0; i < factor - 1; i += 1) total += Number(digits[i]) * (factor - i);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(10) === Number(digits[9]) && calc(11) === Number(digits[10]);
}

function isValidCnpjDigits(digits: string) {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const calc = (base: string, weights: number[]) => {
    const sum = base.split("").reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = calc(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(digits.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}
