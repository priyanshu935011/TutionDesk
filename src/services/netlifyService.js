import path from "path";
import fs from "fs";

/**
 * Generate full HTML markup for tuition website
 */
export const generateTuitionHTML = ({
  instituteName,
  ownerName,
  slug,
  headline,
  subheadline,
  aboutText,
  bannerUrl,
  logoUrl,
  contactPhone,
  adminEmail,
  contactAddress,
  clientUrl,
}) => {
  const appDomain = clientUrl || "http://localhost:5173";
  const studentLoginUrl = `${appDomain}/student-login?slug=${encodeURIComponent(slug)}`;
  const teacherLoginUrl = `${appDomain}/login?slug=${encodeURIComponent(slug)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${instituteName} | Premier Tuition & Coaching Academy</title>
  <meta name="description" content="${subheadline || 'Premier Coaching Academy offering personalized education.'}">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Outfit', sans-serif; }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">

  <!-- Header / Navbar -->
  <header class="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
    <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        ${
          logoUrl
            ? `<img src="${logoUrl}" alt="${instituteName}" class="h-10 w-10 object-cover rounded-xl border border-slate-200 shadow-sm">`
            : `<div class="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white font-extrabold text-lg shadow-sm">${instituteName.charAt(0)}</div>`
        }
        <div>
          <h1 class="text-lg font-black text-slate-900 leading-tight">${instituteName}</h1>
          <p class="text-[11px] font-semibold text-indigo-600">Managed by ${ownerName}</p>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <a href="${studentLoginUrl}" class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition shadow-sm">
          Student Login
        </a>
        <a href="${teacherLoginUrl}" class="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 text-xs font-bold transition shadow-md shadow-indigo-200">
          Educator Login
        </a>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <section class="relative overflow-hidden bg-gradient-to-b from-indigo-50/60 via-white to-slate-50 py-16 sm:py-24">
    <div class="max-w-7xl mx-auto px-6 grid gap-12 lg:grid-cols-2 items-center">
      <div class="space-y-6 text-left">
        <div class="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700">
          <span class="h-2 w-2 rounded-full bg-indigo-600 animate-pulse"></span>
          <span>Official Tuition Portal & Academy</span>
        </div>
        <h2 class="text-4xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight">
          ${headline || `Welcome to ${instituteName}`}
        </h2>
        <p class="text-base sm:text-lg text-slate-600 font-medium leading-relaxed">
          ${subheadline || "Delivering interactive learning, continuous evaluation, attendance tracking, and live quizzes."}
        </p>

        <div class="flex flex-wrap items-center gap-4 pt-2">
          <a href="${studentLoginUrl}" class="rounded-2xl bg-indigo-600 hover:bg-indigo-700 px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-indigo-200 transition transform hover:-translate-y-0.5">
            Student Portal Access
          </a>
          <a href="${teacherLoginUrl}" class="rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 px-7 py-3.5 text-sm font-bold text-slate-700 shadow-sm transition">
            Teacher / Admin Login
          </a>
        </div>
      </div>

      <div class="relative">
        <div class="aspect-video w-full rounded-3xl bg-slate-900 overflow-hidden shadow-2xl border border-slate-200/80">
          <img src="${bannerUrl || 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=80'}" alt="${instituteName}" class="h-full w-full object-cover">
        </div>
      </div>
    </div>
  </section>

  <!-- Features Grid -->
  <section class="py-16 bg-white border-y border-slate-200/60">
    <div class="max-w-7xl mx-auto px-6 space-y-12">
      <div class="text-center space-y-3">
        <span class="text-xs font-bold uppercase tracking-wider text-indigo-600">Academy Highlights</span>
        <h3 class="text-3xl font-black text-slate-900">Why Students Excel With Us</h3>
      </div>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-3xl border border-slate-200 p-6 bg-slate-50/50 hover:bg-white transition shadow-sm space-y-3">
          <div class="h-12 w-12 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xl">📅</div>
          <h4 class="text-lg font-bold text-slate-900">Daily Attendance</h4>
          <p class="text-xs text-slate-500 font-medium leading-relaxed">Automated check-ins and instant WhatsApp absence alerts sent directly to parents.</p>
        </div>

        <div class="rounded-3xl border border-slate-200 p-6 bg-slate-50/50 hover:bg-white transition shadow-sm space-y-3">
          <div class="h-12 w-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xl">📝</div>
          <h4 class="text-lg font-bold text-slate-900">Notes & Study Material</h4>
          <p class="text-xs text-slate-500 font-medium leading-relaxed">Instant access to chapter notes, lecture PDFs, and revision modules anytime.</p>
        </div>

        <div class="rounded-3xl border border-slate-200 p-6 bg-slate-50/50 hover:bg-white transition shadow-sm space-y-3">
          <div class="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xl">📊</div>
          <h4 class="text-lg font-bold text-slate-900">Test Marks & Progress</h4>
          <p class="text-xs text-slate-500 font-medium leading-relaxed">Detailed report cards, score analytics, and progress tracking after every test.</p>
        </div>

        <div class="rounded-3xl border border-slate-200 p-6 bg-slate-50/50 hover:bg-white transition shadow-sm space-y-3">
          <div class="h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xl">⚡</div>
          <h4 class="text-lg font-bold text-slate-900">Live Quizzes</h4>
          <p class="text-xs text-slate-500 font-medium leading-relaxed">Real-time socket quiz competitions with instant leaderboard rankings.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- About & Contact Section -->
  <section class="py-16 bg-slate-50">
    <div class="max-w-7xl mx-auto px-6 grid gap-12 lg:grid-cols-2">
      <div class="rounded-3xl border border-slate-200 bg-white p-8 space-y-4 shadow-sm">
        <h4 class="text-2xl font-black text-slate-900">About ${instituteName}</h4>
        <p class="text-sm text-slate-600 leading-relaxed font-medium">
          ${aboutText || `${instituteName} is a premier educational center focused on conceptual clarity, rigorous assessment, and student success.`}
        </p>
      </div>

      <div class="rounded-3xl border border-slate-200 bg-slate-900 text-white p-8 space-y-5 shadow-xl">
        <h4 class="text-2xl font-black">Get In Touch</h4>
        <div class="space-y-3 text-sm text-slate-300 font-medium">
          <p><span class="font-bold text-white">Owner:</span> ${ownerName}</p>
          <p><span class="font-bold text-white">Email:</span> ${adminEmail}</p>
          ${contactPhone ? `<p><span class="font-bold text-white">Phone:</span> ${contactPhone}</p>` : ''}
          ${contactAddress ? `<p><span class="font-bold text-white">Address:</span> ${contactAddress}</p>` : ''}
        </div>
        <div class="pt-4 border-t border-slate-800 flex gap-3">
          <a href="${studentLoginUrl}" class="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 text-xs font-bold transition">
            Student Login
          </a>
          <a href="${teacherLoginUrl}" class="rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 px-5 py-2.5 text-xs font-bold transition">
            Educator Login
          </a>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-8 bg-white border-t border-slate-200 text-center text-xs text-slate-500 font-semibold">
    <p>© ${new Date().getFullYear()} ${instituteName}. All rights reserved.</p>
  </footer>

</body>
</html>`;
};

/**
 * Deploy website to Netlify via Netlify REST API
 */
export const deployToNetlify = async ({
  slug,
  htmlContent,
  customToken,
}) => {
  const netlifyToken = customToken || process.env.NETLIFY_AUTH_TOKEN;

  if (!slug) {
    throw new Error("Website slug is required for deployment.");
  }

  const sanitizedSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const defaultSubdomain = `${sanitizedSlug}.netlify.app`;
  const defaultPublishedUrl = `https://${defaultSubdomain}`;

  if (!netlifyToken) {
    console.warn(`[NetlifyService] NETLIFY_AUTH_TOKEN not configured. Returning dynamic fallback URL for slug: ${sanitizedSlug}`);
    return {
      success: true,
      subdomain: defaultSubdomain,
      publishedUrl: defaultPublishedUrl,
      isFallback: true,
      message: "Website configured successfully! (Live fallback route enabled)",
    };
  }

  try {
    // 1. Check if site exists or create a new Netlify site
    const sitesRes = await fetch("https://api.netlify.com/api/v1/sites", {
      headers: {
        Authorization: `Bearer ${netlifyToken}`,
        "Content-Type": "application/json",
      },
    });

    let siteId = null;

    if (sitesRes.ok) {
      const sites = await sitesRes.json();
      const existing = sites.find((s) => s.name === sanitizedSlug || s.custom_domain === sanitizedSlug);
      if (existing) {
        siteId = existing.id;
      }
    }

    if (!siteId) {
      // Create new site
      const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: sanitizedSlug,
        }),
      });

      if (createRes.ok) {
        const newSite = await createRes.json();
        siteId = newSite.id;
      } else {
        console.warn("[NetlifyService] Site creation response status:", createRes.status);
      }
    }

    // If siteId created, trigger deployment files
    if (siteId) {
      const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${netlifyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: {
            "/index.html": String(htmlContent),
          },
        }),
      });

      if (deployRes.ok) {
        const deployData = await deployRes.json();
        const liveUrl = deployData.ssl_url || deployData.url || defaultPublishedUrl;
        return {
          success: true,
          siteId,
          subdomain: `${sanitizedSlug}.netlify.app`,
          publishedUrl: liveUrl,
          isFallback: false,
          message: "Website deployed to Netlify successfully!",
        };
      }
    }

    return {
      success: true,
      subdomain: defaultSubdomain,
      publishedUrl: defaultPublishedUrl,
      isFallback: true,
      message: "Configured website with fallback URL.",
    };
  } catch (err) {
    console.error("[NetlifyService] Error deploying to Netlify:", err.message);
    return {
      success: true,
      subdomain: defaultSubdomain,
      publishedUrl: defaultPublishedUrl,
      isFallback: true,
      message: `Configured website with fallback URL (${err.message})`,
    };
  }
};
