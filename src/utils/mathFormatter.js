/**
 * Universal utility for converting power notation, raw LaTeX symbols,
 * and scientific equations into clean, natural human-readable text
 * with clear step-by-step layout.
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

export const SUBSCRIPT_MAP = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  'a': 'ₐ',
  'e': 'ₑ',
  'h': 'ₕ',
  'i': 'ᵢ',
  'j': 'ⱼ',
  'k': 'ₖ',
  'l': 'ₗ',
  'm': 'ₘ',
  'n': 'ₙ',
  'o': 'ₒ',
  'p': 'ₚ',
  'r': 'ᵣ',
  's': 'ₛ',
  't': 'ₜ',
  'u': 'ᵤ',
  'v': 'ᵥ',
  'x': 'ₓ',
};

export const LATEX_SYMBOLS = {
  '\\times': '×',
  '\\cdot': '·',
  '\\pm': '±',
  '\\mp': '∓',
  '\\approx': '≈',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\le': '≤',
  '\\leq': '≤',
  '\\ge': '≥',
  '\\geq': '≥',
  '\\infty': '∞',
  '\\implies': '➔',
  '\\rightarrow': '➔',
  '\\to': '➔',
  '\\leftarrow': '←',
  '\\iff': '⟺',
  '\\int': '∫',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\theta': 'θ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\pi': 'π',
  '\\sigma': 'σ',
  '\\omega': 'ω',
  '\\Delta': 'Δ',
  '\\Omega': 'Ω',
  '\\phi': 'φ',
  '\\rho': 'ρ',
  '\\tau': 'τ',
  '\\varepsilon': 'ε',
  '\\degree': '°',
  '\\circ': '°',
};

export function toSuperscript(str) {
  if (!str) return '';
  return String(str)
    .split('')
    .map((ch) => SUPERSCRIPT_MAP[ch] || ch)
    .join('');
}

export function toSubscript(str) {
  if (!str) return '';
  return String(str)
    .split('')
    .map((ch) => SUBSCRIPT_MAP[ch] || ch)
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

/**
 * Converts raw LaTeX commands, math tags, and symbols into clean,
 * natural human-readable text.
 */
export function cleanLatexToText(text) {
  if (!text || typeof text !== 'string') return text;
  let str = text;

  // 1. Remove rambling chain-of-thought self-checks from Gemini
  // e.g. "... wait, let's re-verify: ... Wait, let's re-check $d_1+d_2+d_3 = 11\text{ m}$."
  str = str.replace(
    /(\.{2,3}\s*)?(wait,?\s*)?(let'?s\s+(re-?verify|re-?calculate|re-?check|check again|verify carefully))[\s\S]*?(?=(Thus|Hence|Therefore|So|In conclusion|Conclusion|Option\s+[A-D]|Final Answer|$))/i,
    ''
  );

  // 2. Ensure space between closing brace/tag and subsequent word: e.g. \text{ s}andt -> \text{ s} andt
  str = str.replace(/([\}])([a-zA-Z])/g, '$1 $2');
  str = str.replace(/([a-zA-Z]{2,})([a-zA-Z]\([a-zA-Z0-9]+\))/g, '$1 $2'); // "Settingv(t)" -> "Setting v(t)"
  str = str.replace(/(\d+)([a-zA-Z]{2,})/g, '$1 $2'); // "0yields" -> "0 yields"
  str = str.replace(/\batt\s*=\s*/g, 'at t = '); // "att = 1" -> "at t = 1"
  str = str.replace(/\bandt\s*=\s*/g, 'and t = '); // "andt = 2" -> "and t = 2"
  str = str.replace(/\bFromt\s*=\s*/g, 'From t = '); // "Fromt = 1" -> "From t = 1"
  str = str.replace(/\btot\s*=\s*/g, 'to t = '); // "tot = 2" -> "to t = 2"
  str = str.replace(/([a-zA-Z0-9])=\s*([a-zA-Z0-9])/g, '$1 = $2'); // "distance =d" -> "distance = d"

  // 3. Convert \frac{a}{b} -> a/b (or (a)/(b) if composite)
  str = str.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_, num, den) => {
    const cleanNum = num.trim();
    const cleanDen = den.trim();
    if (cleanNum.length <= 4 && cleanDen.length <= 4 && !cleanNum.includes('+') && !cleanNum.includes('-')) {
      return `${cleanNum}/${cleanDen}`;
    }
    return `(${cleanNum})/(${cleanDen})`;
  });

  // 4. Convert \sqrt{x} -> √(x)
  str = str.replace(/\\sqrt\s*\{([^{}]+)\}/g, (_, inner) => `√(${inner.trim()})`);

  // 5. Convert \text{...}, \mathrm{...}, \mathbf{...} -> inner
  str = str.replace(/\\(text|mathrm|mathbf|mathit|textnormal)\s*\{([^{}]+)\}/g, (_, __, inner) => inner);

  // 6. Replace known LaTeX symbol commands
  for (const [tex, sym] of Object.entries(LATEX_SYMBOLS)) {
    str = str.replaceAll(tex, sym);
  }

  // 7. Convert subscripts: d_1 -> d₁, x_0 -> x₀, d_{1} -> d₁
  str = str.replace(/([a-zA-Z])_\{?([0-9a-z\+\-]+)\}?/g, (_, varName, sub) => `${varName}${toSubscript(sub)}`);

  // 8. Convert powers: x^2 -> x², t^3 -> t³, 10^(-6) -> 10⁻⁶
  str = formatPowersToSuperscript(str);

  // 9. Remove all remaining stray dollar signs
  str = str.replace(/\$+/g, '');

  // 10. Clean any lingering backslash artifacts (\left, \right, etc.)
  str = str.replace(/\\(left|right|displaystyle|quad|qquad|,|;|!)/g, ' ');
  str = str.replace(/\\([%_&])/g, '$1');

  // 11. Normalize spaces
  str = str.replace(/[ \t]+/g, ' ');

  return str.trim();
}

/**
 * Formats a solution into a structured step-by-step layout with clean newlines
 * between equations, calculations, evaluations, and conclusions.
 * Restores mathematical minus signs and separates chained deductions like a real tutor.
 */
export function formatStepByStepSolution(text) {
  if (!text || typeof text !== 'string') return text;
  let str = cleanLatexToText(text);

  // 1. Repair any corrupted bullets that were mistakenly inserted before minus signs or variables:
  // e.g. "a\n• b = 0" -> "a - b = 0", "• a - 2b\n• c = 1" -> "a - 2b - c = 1"
  str = str.replace(/([a-zA-Z0-9\)])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 - $2');
  str = str.replace(/([a-zA-Z0-9\)])\s*•\s*([a-zA-Z0-9])/g, '$1 - $2');
  str = str.replace(/(\d+[\)\.])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 $2');
  str = str.replace(/([➔=>])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 $2');
  str = str.replace(/(^|\n)\s*•\s*([a-zA-Z0-9]\s*[-+=])/g, '$1$2');

  // 2. Put numbered steps/equations on their own new lines: 1), 2), 3) or 1., 2., 3.
  str = str.replace(/([^\n])\s*(\b\d+[\)\.]\s+[a-zA-Z0-9])/g, '$1\n\n$2');

  // 3. Segment "Step X:" or "Step 1:"
  str = str.replace(/([^\n])\s*(Step\s*\d+[:.-])/gi, '$1\n\n$2');

  // 4. Break long chains of arrows (➔) onto sequential indented lines like a tutor at a chalkboard
  str = str.replace(/\s*([➔])\s*/g, '\n   ➔ ');

  // 5. Segment transitional tutor headers: "Given:", "Now, calculate", "Let's evaluate", "Evaluating"
  str = str.replace(/([^\n])\s*(Given\b[:\s])/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Now,?\s*calculate\b)/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Let'?s\s*evaluate\b)/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Substitute\b)/gi, '$1\n\n$2');

  // 6. Segment "Total distance", "Total Distance"
  str = str.replace(/([^\n])\s*(Total\s+[dD]istance\s*=)/g, '$1\n\n$2');

  // 7. Segment concluding sentences: "Thus,", "Therefore,", "Hence,", "In conclusion,"
  str = str.replace(/([^\n])\s*(Thus|Therefore|Hence|In conclusion),?\s*(Option\s+[A-D]|the\s+correct)/gi, '$1\n\n$2, $3');

  // 8. Trim excess whitespace and normalize newlines
  str = str
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return str;
}

/**
 * Main display formatter: transforms raw LaTeX and powers into human-readable math
 * and formats multi-step explanations cleanly.
 */
export function formatDisplayMath(text) {
  if (!text || typeof text !== 'string') return text;
  
  // If the text looks like an explanation or contains steps/latex, format step-by-step
  if (
    text.includes('\\') ||
    text.includes('$') ||
    text.includes('Step') ||
    text.includes('From t') ||
    text.includes('Total distance') ||
    text.length > 80
  ) {
    return formatStepByStepSolution(text);
  }

  // Quick clean for short labels/options
  return cleanLatexToText(text);
}

export default formatDisplayMath;
