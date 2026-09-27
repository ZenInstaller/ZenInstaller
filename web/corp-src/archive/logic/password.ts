function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function pickRandomChar(chars: string): string {
  return chars[randomInt(chars.length)];
}

function shuffleString(input: string): string {
  const out = input.split("");
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out.join("");
}

export function generateRandomPassword(length = 30): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}<>?";
  const all = `${lowercase}${uppercase}${digits}${symbols}`;

  const effectiveLength = Math.max(length, 4);
  const chars: string[] = [
    pickRandomChar(lowercase),
    pickRandomChar(uppercase),
    pickRandomChar(digits),
    pickRandomChar(symbols),
  ];

  for (let i = chars.length; i < effectiveLength; i += 1) {
    chars.push(pickRandomChar(all));
  }

  return shuffleString(chars.join(""));
}
