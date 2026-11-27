/**
 * Content Normalizer & Sanitizer (Backend)
 * Intelligently detects Markdown, LaTeX (inline $ & display $$), Chemistry notation (\ce{...}),
 * HTML, and Unicode symbols.
 * Automatically wraps bare LaTeX commands (\frac, \sqrt, \mu₀, \varepsilon₀, \Phi_E, T_mean, t_mean)
 * in standard $...$ math delimiters so KaTeX and Markdown renderers can display them properly.
 */

const BRACED = String.raw`\{[^{}\n]*(?:\{[^{}\n]*\}[^{}\n]*)*\}`;
const FRAC = String.raw`\\frac\s*${BRACED}\s*${BRACED}`;
const SQRT = String.raw`\\sqrt(?:\s*\[[^\n\]]*\])?\s*${BRACED}`;
const FORMATTED_CMD = String.raw`\\(?:vec|hat|bar|dot|ddot|mathbf|mathrm|text|ce|pu)\s*${BRACED}`;
const BASIC_CMD = String.raw`\\[a-zA-Z]+(?:_[a-zA-Z0-9]+|\^[a-zA-Z0-9]+|\^\{[^{}\n]*\}|_\{[^{}\n]*\})*`;
const MATH_TOKEN = `(?:${FRAC}|${SQRT}|${FORMATTED_CMD}|${BASIC_CMD})`;

const FULL_MATH_EXPR = new RegExp(
  `(?<!\\$)(?:[a-zA-Z0-9_'^()|\\[\\]]+\\s*[=<>~≈∝±∓]\\s*)?` +
  `${MATH_TOKEN}` +
  `(?:\\s*[=+\\-*/<>^~≈∝±∓]\\s*(?:${MATH_TOKEN}|[a-zA-Z0-9_'^()|\\[\\]]+))*` +
  `(?![a-zA-Z0-9_]*\\$)`,
  "g"
);

export function sanitizeContent(text) {
  if (!text || typeof text !== "string") return text || "";
  let str = text;

  // 1. Remove rambling chain-of-thought self-checks from Gemini
  str = str.replace(
    /(\.{2,3}\s*)?(wait,?\s*)?(let'?s\s+(re-?verify|re-?calculate|re-?check|check again|verify carefully))[\s\S]*?(?=(Thus|Hence|Therefore|So|In conclusion|Conclusion|Option\s+[A-D]|Final Answer|$))/i,
    ""
  );

  // 2. Repair legacy corrupted "≤ft"
  str = str.replace(/≤ft\s*\(/g, "\\left(");
  str = str.replace(/≤ft\s*\[/g, "\\left[");
  str = str.replace(/≤ft\b/g, "\\left");

  // 3. Repair accidentally split numbers or parentheses across newlines
  str = str.replace(/\(([^()\n]*?)\s*\n+\s*([0-9a-zA-Z\+\-\*\/\s]+)\)/g, "($1 $2)");
  str = str.replace(/(\d+)\.\s*\n+\s*(\d+)/g, "$1.$2");

  // 4. Convert LaTeX parenthesis delimiters \( ... \) and \[ ... \]
  str = str.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n\n$$${math.trim()}$$\n\n`);
  str = str.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);

  // 5. Normalize Unicode subscripts/superscripts attached to LaTeX commands
  str = str.replace(/\\([a-zA-Z]+)₀/g, "\\$1_0");
  str = str.replace(/\\([a-zA-Z]+)₁/g, "\\$1_1");
  str = str.replace(/\\([a-zA-Z]+)₂/g, "\\$1_2");
  str = str.replace(/\\([a-zA-Z]+)₃/g, "\\$1_3");
  str = str.replace(/\\([a-zA-Z]+)₄/g, "\\$1_4");
  str = str.replace(/\\([a-zA-Z]+)θ/g, "\\$1\\theta");
  str = str.replace(/\\([a-zA-Z]+)α/g, "\\$1\\alpha");
  str = str.replace(/\\([a-zA-Z]+)β/g, "\\$1\\beta");
  str = str.replace(/\\([a-zA-Z]+)⁻¹/g, "\\$1^{-1}");

  // 6. Bare unicode Greek letters with subscripts: μ₀, ε₀
  str = str.replace(/\bmu₀\b/g, "\\mu_0");
  str = str.replace(/\bvarepsilon₀\b/g, "\\varepsilon_0");
  str = str.replace(/μ₀/g, "\\mu_0");
  str = str.replace(/ε₀/g, "\\varepsilon_0");

  // 7. Subscripted physical variables: T_mean, t_mean, v_avg, etc.
  str = str.replace(
    /\b([A-Za-z])_(mean|avg|max|min|total|net|initial|final|eff|peak|rms)\b/g,
    (_, v, s) => `$${v}_{\\text{${s}}}$`
  );

  // 8. Bracketed physical dimensions: [M^0 L T^(-3)]
  str = str.replace(/\[([M|L|T|I|K|A|cd|mol][\^0-9\s\+\-\(\)]+)\]/g, (_, inner) => {
    const clean = inner.replace(/\^[\(]?([\+\-]?\d+)[\)]?/g, "^$1");
    return `$[$${clean}$]$`.replace(/\$\[\$/g, "$[").replace(/\$\]\$/g, "]$");
  });

  // 9. Standalone chemistry \ce{...} or \pu{...} outside math mode
  str = str.replace(/(?<!\$)\\ce\{([^{}\n]+)\}(?!\$)/g, (_, chem) => `$\\ce{${chem}}$`);
  str = str.replace(/(?<!\$)\\pu\{([^{}\n]+)\}(?!\$)/g, (_, pu) => `$\\pu{${pu}}$`);

  // 10. Detect & wrap bare LaTeX commands and expressions outside of math mode
  const parts = str.split(/(\$\$[\s\S]*?\$\$|\$[^\$\n]*?\$)/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) continue;
    let seg = parts[i];
    if (!seg || !seg.includes("\\")) continue;

    seg = seg.replace(FULL_MATH_EXPR, (match) => {
      let core = match.trim();
      let trailing = "";
      if (/[.,;:?!]$/.test(core)) {
        trailing = core.slice(-1);
        core = core.slice(0, -1).trim();
      }
      return `$${core}$${trailing}`;
    });

    parts[i] = seg;
  }

  let merged = parts.join("");

  // 11. Merge adjacent or whitespace-separated inline math tags: $a$ $b$ -> $a b$
  while (/\$([^\$\n]+?)\$\s*\$([^\$\n]+?)\$/g.test(merged)) {
    merged = merged.replace(
      /\$([^\$\n]+?)\$\s*\$([^\$\n]+?)\$/g,
      (_, a, b) => `$${a.trim()} ${b.trim()}$`
    );
  }

  return merged.trim();
}

export function formatStepByStepSolution(text) {
  return sanitizeContent(text);
}

export function formatDisplayMath(text) {
  return sanitizeContent(text);
}

export function cleanLatexToText(text) {
  return sanitizeContent(text);
}

export default formatDisplayMath;
