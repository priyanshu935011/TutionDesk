/**
 * Universal utility for converting power notation, raw LaTeX symbols,
 * and scientific equations into clean, natural human-readable text
 * with clear step-by-step layout and centered formula alignment.
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
  '\\propto': '∝',
  '\\sim': '∼',
  '\\equiv': '≡',
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
  '\\perp': '⊥',
  '\\parallel': '∥',
  '\\therefore': '∴',
  '\\because': '∵',
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

  // 3. Single letter powers: ^n, ^x, ^-x, ^m, ^k, ^i, ^a, ^b, ^c
  res = res.replace(/\^([\+\-]?[a-zA-Z])/g, (_, exp) => toSuperscript(exp));

  return res;
}

/**
 * Converts raw LaTeX commands, math tags, and symbols into clean,
 * natural human-readable text without corrupting expressions.
 */
export function cleanLatexToText(text) {
  if (!text || typeof text !== 'string') return text;
  let str = text;

  // 1. Remove rambling chain-of-thought self-checks from Gemini
  str = str.replace(
    /(\.{2,3}\s*)?(wait,?\s*)?(let'?s\s+(re-?verify|re-?calculate|re-?check|check again|verify carefully))[\s\S]*?(?=(Thus|Hence|Therefore|So|In conclusion|Conclusion|Option\s+[A-D]|Final Answer|$))/i,
    ''
  );

  // 2. Strip \left and \right BEFORE symbol replacements so \le doesn't turn \left into ≤ft
  str = str.replace(/\\left\s*[\(\[\{]/g, '(');
  str = str.replace(/\\right\s*[\)\]\}]/g, ')');
  str = str.replace(/\\left\s*\|/g, '|');
  str = str.replace(/\\right\s*\|/g, '|');
  str = str.replace(/\\(left|right)\s*\./g, '');
  str = str.replace(/\\(left|right)\b/g, '');

  // 3. Repair any pre-corrupted "≤ft" from previous passes
  str = str.replace(/≤ft\s*\(/g, '(');
  str = str.replace(/≤ft\s*\[/g, '[');
  str = str.replace(/≤ft\b/g, '');

  // 4. Convert \frac{a}{b} -> a/b (or (a)/(b) if composite)
  str = str.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_, num, den) => {
    const cleanNum = num.trim();
    const cleanDen = den.trim();
    if (cleanNum.length <= 4 && cleanDen.length <= 4 && !cleanNum.includes('+') && !cleanNum.includes('-')) {
      return `${cleanNum}/${cleanDen}`;
    }
    return `(${cleanNum})/(${cleanDen})`;
  });

  // 5. Convert \sqrt{x} -> √(x)
  str = str.replace(/\\sqrt\s*\{([^{}]+)\}/g, (_, inner) => `√(${inner.trim()})`);

  // 6. Convert \text{...}, \mathrm{...}, \mathbf{...} -> inner
  str = str.replace(/\\(text|mathrm|mathbf|mathit|textnormal)\s*\{([^{}]+)\}/g, (_, __, inner) => inner);

  // 7. Replace known LaTeX symbol commands with word boundary checks for alphanumeric commands
  const sortedSymbols = Object.keys(LATEX_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const tex of sortedSymbols) {
    const sym = LATEX_SYMBOLS[tex];
    const isAlpha = /^\\[a-zA-Z]+$/.test(tex);
    if (isAlpha) {
      str = str.replace(new RegExp(tex.replace('\\', '\\\\') + '\\b', 'g'), sym);
    } else {
      str = str.replaceAll(tex, sym);
    }
  }

  // 8. Fix run-on glue words
  str = str.replace(/([\}])([a-zA-Z])/g, '$1 $2');
  str = str.replace(/([a-zA-Z]{2,})([a-zA-Z]\([a-zA-Z0-9]+\))/g, '$1 $2');
  str = str.replace(/(\d+)([a-zA-Z]{2,})/g, '$1 $2');
  str = str.replace(/\batt\s*=\s*/g, 'at t = ');
  str = str.replace(/\bandt\s*=\s*/g, 'and t = ');
  str = str.replace(/\bFromt\s*=\s*/g, 'From t = ');
  str = str.replace(/\btot\s*=\s*/g, 'to t = ');
  str = str.replace(/([a-zA-Z0-9])=\s*([a-zA-Z0-9])/g, '$1 = $2');

  // 9. Subscripts: t_{mean} -> t_mean, d_1 -> d₁, F_{net} -> F_net
  str = str.replace(/_\{([a-zA-Z0-9\+\-]+)\}/g, (_, sub) => {
    if (/^[0-9\+\-]+$/.test(sub) && sub.length <= 3) return toSubscript(sub);
    return `_${sub}`;
  });
  str = str.replace(/([a-zA-Z])_([0-9])/g, (_, v, s) => `${v}${toSubscript(s)}`);
  str = str.replace(/([a-zA-Z])_([a-zA-Z]{1,4})\b/g, '$1_$2');

  // 10. Convert powers: x^2 -> x², t^3 -> t³, 10^(-6) -> 10⁻⁶
  str = formatPowersToSuperscript(str);

  // 11. Remove all remaining stray dollar signs
  str = str.replace(/\$+/g, '');

  // 12. Clean any lingering backslash artifacts
  str = str.replace(/\\(left|right|displaystyle|quad|qquad|,|;|!)/g, ' ');
  str = str.replace(/\\([%_&])/g, '$1');

  // 13. Normalize spaces
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

  // 1. Repair accidentally broken numbers, decimals, or parentheses:
  // e.g. "(N +\n\n1)" -> "(N + 1)"
  str = str.replace(/\(([^()\n]*?)\s*\n+\s*([0-9a-zA-Z\+\-\*\/\s]+)\)/g, '($1 $2)');
  // e.g. "0.\n\n02" -> "0.02"
  str = str.replace(/(\d+)\.\s*\n+\s*(\d+)/g, '$1.$2');

  // 2. Repair any corrupted bullets mistakenly inserted before minus signs or variables:
  // e.g. "a\n• b = 0" -> "a - b = 0", "• a - 2b\n• c = 1" -> "a - 2b - c = 1"
  str = str.replace(/([a-zA-Z0-9\)])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 - $2');
  str = str.replace(/([a-zA-Z0-9\)])\s*•\s*([a-zA-Z0-9])/g, '$1 - $2');
  str = str.replace(/(\d+[\)\.])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 $2');
  str = str.replace(/([➔=>])\s*\n\s*•\s*([a-zA-Z0-9])/g, '$1 $2');
  str = str.replace(/(^|\n)\s*•\s*([a-zA-Z0-9]\s*[-+=])/g, '$1$2');

  // 3. Put numbered steps/equations on their own lines ONLY when preceded by newline or start
  str = str.replace(/(^|\n)\s*(\d+[\)\.]\s+[a-zA-Z0-9])/g, '$1$2');

  // 4. Break chained arrows onto the next indented line
  str = str.replace(/\s*([➔])\s*/g, '\n   ➔ ');

  // 5. Section headings get clean 2 line breaks (\n\n)
  str = str.replace(/([^\n])\s*(Step\s*\d+[:.-])/gi, '$1\n\n$2');
  str = str.replace(/(^|[.\n])\s*(Given\s*:)/g, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Substitute\b[^:\n]+:?)/g, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Equating\s+dimensions:?)/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Solving\s+the\s+system\b[^:]*:?)/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Now,?\s*calculate\b)/gi, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Total\s+[dD]istance\s*=)/g, '$1\n\n$2');
  str = str.replace(/([^\n])\s*(Thus|Therefore|Hence|In conclusion),?\s*(Option\s+[A-D]|the\s+correct|T\s*=|[a-z]\s*=|the\s+result)/gi, '$1\n\n$2, $3');

  // 6. Trim excess whitespace and normalize newlines
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
  
  if (
    text.includes('\\') ||
    text.includes('$') ||
    text.includes('Step') ||
    text.includes('From t') ||
    text.includes('Total distance') ||
    text.includes('VSD') ||
    text.includes('MSD') ||
    text.includes('≤ft') ||
    text.includes('propto') ||
    text.length > 80
  ) {
    return formatStepByStepSolution(text);
  }

  return cleanLatexToText(text);
}

export default formatDisplayMath;
