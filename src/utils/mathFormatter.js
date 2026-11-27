/**
 * Universal utility for converting power notation like `[M^0 L T^(-3)]` or `x^2` or `10^(-6)`
 * into authentic real-world raised superscripts like `[M⁰ L T⁻³]`, `x²`, and `10⁻⁶`.
 */

export const SUPERSCRIPT_MAP = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  '/': 'ᐟ',
  'a': 'ᵃ',
  'b': 'ᵇ',
  'c': 'ᶜ',
  'd': 'ᵈ',
  'e': 'ᵉ',
  'f': 'ᶠ',
  'g': 'ᵍ',
  'h': 'ʰ',
  'i': 'ⁱ',
  'j': 'ʲ',
  'k': 'ᵏ',
  'l': 'ˡ',
  'm': 'ᵐ',
  'n': 'ⁿ',
  'o': 'ᵒ',
  'p': 'ᵖ',
  'r': 'ʳ',
  's': 'ˢ',
  't': 'ᵗ',
  'u': 'ᵘ',
  'v': 'ᵛ',
  'w': 'ʷ',
  'x': 'ˣ',
  'y': 'ʸ',
  'z': 'ᶻ',
  'A': 'ᴬ',
  'B': 'ᴮ',
  'D': 'ᴰ',
  'E': 'ᴱ',
  'G': 'ᴳ',
  'H': 'ᴴ',
  'I': 'ᴵ',
  'J': 'ᴶ',
  'K': 'ᴷ',
  'L': 'ᴸ',
  'M': 'ᴹ',
  'N': 'ᴺ',
  'O': 'ᴼ',
  'P': 'ᴾ',
  'R': 'ᴿ',
  'T': 'ᵀ',
  'U': 'ᵁ',
  'V': 'ⱽ',
  'W': 'ᵂ',
};

export function toSuperscript(str) {
  if (!str) return '';
  return String(str)
    .split('')
    .map((ch) => SUPERSCRIPT_MAP[ch] || ch)
    .join('');
}

export function formatPowersToSuperscript(text) {
  if (!text || typeof text !== 'string') return text;
  let res = text;

  // 1. Bracketed or braced powers: ^(-3), ^(2), ^{3}, ^{ -2 }, ^(n+1), ^(1/2)
  res = res.replace(/\^[\(\{]([^\)\}]+)[\)\}]/g, (_, exp) => toSuperscript(exp.trim()));

  // 2. Simple signed/unsigned numbers: ^-3, ^+2, ^0, ^2, ^12
  res = res.replace(/\^([\+\-]?\d+)/g, (_, exp) => toSuperscript(exp));

  // 3. Single letter powers: ^n, ^x, ^-x, ^m, ^k, ^i
  res = res.replace(/\^([\+\-]?[a-zA-Z])/g, (_, exp) => toSuperscript(exp));

  return res;
}

export function formatDisplayMath(text) {
  if (!text || typeof text !== 'string') return text;
  let res = text;

  // Clean raw single dollars around simple arithmetic / variables ($2 + 2$ -> 2 + 2, $a = 2$ -> a = 2)
  res = res.replace(/(?<!\\)\$\s*([a-zA-Z0-9\s\+\-\*\/\=\.\,\(\)]+?)\s*\$/g, (match, inner) => {
    if (!inner.includes('\\')) {
      return inner.trim();
    }
    return match;
  });

  // Convert powers to superscripts
  res = formatPowersToSuperscript(res);

  return res;
}

export default formatDisplayMath;
