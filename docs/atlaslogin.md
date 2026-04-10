<!DOCTYPE html>

<html lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Atlas | Signal Intelligence Login</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    "colors": {
                        "primary-fixed-dim": "#b7c6ee",
                        "outline-variant": "#c5c6cf",
                        "inverse-on-surface": "#ebf1ff",
                        "tertiary-container": "#003220",
                        "surface-container": "#e7eefe",
                        "surface": "#f9f9ff",
                        "on-tertiary-container": "#27a577",
                        "surface-tint": "#4f5e81",
                        "on-tertiary-fixed-variant": "#005137",
                        "error-container": "#ffdad6",
                        "surface-container-low": "#f0f3ff",
                        "on-tertiary-fixed": "#002114",
                        "on-secondary-fixed-variant": "#00497c",
                        "secondary-fixed": "#d1e4ff",
                        "secondary-fixed-dim": "#9ecaff",
                        "tertiary": "#001b10",
                        "inverse-primary": "#b7c6ee",
                        "on-surface": "#151c27",
                        "on-primary": "#ffffff",
                        "tertiary-fixed-dim": "#68dba9",
                        "secondary-container": "#7cbaff",
                        "on-background": "#151c27",
                        "tertiary-fixed": "#85f8c4",
                        "on-secondary": "#ffffff",
                        "inverse-surface": "#2a313d",
                        "primary-fixed": "#d9e2ff",
                        "on-surface-variant": "#45464e",
                        "surface-container-highest": "#dce2f3",
                        "surface-dim": "#d3daea",
                        "surface-container-high": "#e2e8f8",
                        "on-error": "#ffffff",
                        "background": "#f9f9ff",
                        "on-tertiary": "#ffffff",
                        "surface-container-lowest": "#ffffff",
                        "error": "#ba1a1a",
                        "on-secondary-fixed": "#001d36",
                        "surface-bright": "#f9f9ff",
                        "primary": "#041534",
                        "secondary": "#0b61a1",
                        "primary-container": "#1b2a4a",
                        "on-primary-fixed": "#0a1a3a",
                        "surface-variant": "#dce2f3",
                        "on-primary-fixed-variant": "#384668",
                        "on-error-container": "#93000a",
                        "outline": "#75777f",
                        "on-secondary-container": "#004a7d",
                        "on-primary-container": "#8392b7"
                    },
                    "borderRadius": {
                        "DEFAULT": "0.125rem",
                        "lg": "0.25rem",
                        "xl": "0.5rem",
                        "full": "0.75rem"
                    },
                    "fontFamily": {
                        "headline": ["Inter", "sans-serif"],
                        "body": ["Inter", "sans-serif"],
                        "label": ["Inter", "sans-serif"]
                    }
                }
            }
        }
    </script>
<style>
        body { font-family: 'Inter', sans-serif; }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
        }
        .signal-gradient {
            background: linear-gradient(135deg, #041534 0%, #1b2a4a 100%);
        }
        .glass-panel {
            background: rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
    </style>
</head>
<body class="bg-background text-on-surface antialiased overflow-hidden">
<main class="flex min-h-screen">
<!-- LEFT SIDE: Branding Panel -->
<section class="hidden lg:flex lg:w-7/12 relative signal-gradient flex-col justify-between p-12 overflow-hidden">
<!-- Background Visual Elements -->
<div class="absolute inset-0 z-0">
<div class="absolute top-[-10%] right-[-10%] w-[80%] h-[80%] bg-secondary/10 rounded-full blur-[120px]"></div>
<div class="absolute bottom-[-10%] left-[-5%] w-[60%] h-[60%] bg-primary-container/20 rounded-full blur-[100px]"></div>
<img class="absolute inset-0 w-full h-full object-cover mix-blend-overlay opacity-30" data-alt="Abstract digital visualization of flowing data points and interconnected signal nodes in deep navy and electric blue tones with soft bokeh" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAGz3bPy2AZXyWkUcDYK_DpFmV4QAl10xOEmcBXN38xAZ7OKHaiQKoRCWlgG36ZWeCO6kckduHDZ8FCA1pBWt0PfJOeGdQCxGdOlr5ai_2x9Md7EC0G8mjGCp4joMVqFExRDE7MSAYYsZ_MA_kNYplhOvkL_o30toxbPjO_P7hzPY-2H_yK-MKV5foliMQV2-tbhjooV1efdsKiqCAkxSZgV_jA8GFItvUnxp6mZPiBHPn9OQD4G5pw-Q1pz37BxvGsjlqa1A3l9NoT"/>
</div>
<!-- Brand Header -->
<div class="relative z-10 flex items-center gap-2">
<div class="w-8 h-8 bg-on-primary rounded flex items-center justify-center">
<span class="material-symbols-outlined text-primary text-[20px]" style="font-variation-settings: 'FILL' 1;">sensors</span>
</div>
<span class="text-white font-bold tracking-tight text-xl">Vimi Digital</span>
</div>
<!-- Product Messaging -->
<div class="relative z-10 max-w-xl">
<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-panel mb-8">
<span class="w-2 h-2 rounded-full bg-secondary"></span>
<span class="text-[10px] uppercase tracking-[0.2em] font-medium text-blue-200/80">Intelligence Platform v4.0</span>
</div>
<h1 class="text-white text-6xl font-extrabold tracking-tighter mb-4 leading-[1.1]">
                    Atlas
                </h1>
<h2 class="text-blue-100/90 text-3xl font-light tracking-tight mb-8 leading-snug">
                    Signal Intelligence to Power Your Marketing
                </h2>
<p class="text-on-primary-container text-lg leading-relaxed max-w-md font-light">
                    Turn fragmented data into actionable insights. Measure, diagnose, and optimize performance across every channel.
                </p>
<div class="mt-12 grid grid-cols-2 gap-8 border-t border-white/10 pt-12">
<div>
<div class="text-blue-200 font-bold text-2xl mb-1 tracking-tight">99.9%</div>
<div class="text-[10px] uppercase tracking-wider text-on-primary-container font-semibold">Signal Accuracy</div>
</div>
<div>
<div class="text-blue-200 font-bold text-2xl mb-1 tracking-tight">1.2M+</div>
<div class="text-[10px] uppercase tracking-wider text-on-primary-container font-semibold">Events Processed/Sec</div>
</div>
</div>
</div>
<!-- Footer Meta -->
<div class="relative z-10 flex items-center justify-between text-blue-200/40 text-[11px] uppercase tracking-[0.15em] font-medium">
<span>Enterprise Grade Security</span>
<span>© 2024 Vimi Digital</span>
</div>
</section>
<!-- RIGHT SIDE: Login Panel -->
<section class="w-full lg:w-5/12 flex flex-col justify-center items-center p-6 sm:p-12 bg-white relative">
<div class="w-full max-w-md">
<!-- Mobile Logo (Visible only on small screens) -->
<div class="lg:hidden flex items-center gap-2 mb-12">
<span class="material-symbols-outlined text-primary text-[28px]">sensors</span>
<span class="text-primary font-extrabold text-2xl tracking-tighter">Atlas</span>
</div>
<div class="mb-10">
<h3 class="text-on-surface text-3xl font-bold tracking-tight mb-2">Welcome back</h3>
<p class="text-on-surface-variant text-[14px]">Sign in to access your analytics workspace</p>
</div>
<form class="space-y-6">
<div class="space-y-1.5">
<label class="block text-[11px] uppercase tracking-wider font-bold text-on-surface-variant ml-1" for="email">Email address</label>
<div class="relative">
<input class="w-full h-12 bg-surface-container-low border-0 ring-1 ring-inset ring-outline-variant/30 rounded-xl px-4 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-secondary transition-all outline-none" id="email" placeholder="name@company.com" type="email"/>
<span class="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline-variant text-[20px]">mail</span>
</div>
</div>
<div class="space-y-1.5">
<div class="flex justify-between items-center px-1">
<label class="block text-[11px] uppercase tracking-wider font-bold text-on-surface-variant" for="password">Password</label>
<a class="text-[12px] font-medium text-secondary hover:underline transition-all" href="#">Forgot your password?</a>
</div>
<div class="relative">
<input class="w-full h-12 bg-surface-container-low border-0 ring-1 ring-inset ring-outline-variant/30 rounded-xl px-4 text-on-surface placeholder:text-outline focus:ring-2 focus:ring-secondary transition-all outline-none" id="password" placeholder="••••••••" type="password"/>
<span class="absolute right-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-outline-variant text-[20px]">lock</span>
</div>
</div>
<div class="flex items-center gap-3 px-1">
<input class="w-4 h-4 text-secondary border-outline-variant rounded focus:ring-secondary" id="remember" type="checkbox"/>
<label class="text-[13px] text-on-surface-variant font-medium" for="remember">Keep me signed in for 30 days</label>
</div>
<button class="w-full h-12 signal-gradient text-white font-semibold rounded-xl hover:opacity-90 active:scale-[0.98] transition-all shadow-lg shadow-primary/10 flex items-center justify-center gap-2" type="submit">
                        Access Atlas
                        <span class="material-symbols-outlined text-[18px]">arrow_forward</span>
</button>
</form>
<div class="mt-8 text-center">
<p class="text-on-surface-variant text-[14px]">
                        Don't have an account? 
                        <a class="text-secondary font-bold hover:underline" href="#">Sign up</a>
</p>
</div>
<div class="mt-12 pt-12 border-t border-outline-variant/10 flex flex-col items-center gap-4">
<span class="text-[10px] uppercase tracking-widest text-outline font-bold">Or continue with SSO</span>
<div class="flex gap-4 w-full">
<button class="flex-1 h-11 bg-surface-container-lowest border border-outline-variant/20 rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container transition-colors">
<img alt="Google" class="w-4 h-4 opacity-70" data-alt="Google logo icon" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAU2IHZ9ZyFsx1NYhB-WQ4e1NTY6yGshPRGeNNQI40wtVzUe7OqPVX09gd_llKn497Jei8g6h29Tq7rKEvuEtD_SyqKDxkXjFPytWFdssTARGUu1IfpjlRWhKJ-P9_7PuSAY9gI7zEez5v-roJsv2v8IWltUDlg3y53dmd5_zTLz3PTFFVL7LwiVsDwM2gM5vAEU-3N4cs8GEoxpVnps-T_o8lM8Ka2aCQDribuo9ybwGMp3Xdutwl50Z1jzSjAzMNhHIPWyO35YxFE"/>
<span class="text-[13px] font-medium text-on-surface">Google</span>
</button>
<button class="flex-1 h-11 bg-surface-container-lowest border border-outline-variant/20 rounded-xl flex items-center justify-center gap-2 hover:bg-surface-container transition-colors">
<span class="material-symbols-outlined text-[18px] text-on-surface" style="font-variation-settings: 'FILL' 1;">shield_with_heart</span>
<span class="text-[13px] font-medium text-on-surface">Okta</span>
</button>
</div>
</div>
</div>
<!-- Sticky Footer for Panel -->
<footer class="absolute bottom-8 left-0 right-0 px-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-[11px] font-medium text-outline-variant uppercase tracking-widest">
<div class="flex gap-6">
<a class="hover:text-secondary transition-colors" href="mailto:info@vimi.digital">info@vimi.digital</a>
<a class="hover:text-secondary transition-colors" href="https://www.vimi.digital">www.vimi.digital</a>
</div>
<div class="flex gap-6">
<a class="hover:text-on-surface transition-colors" href="#">Privacy</a>
<a class="hover:text-on-surface transition-colors" href="#">Terms</a>
</div>
</footer>
</section>
</main>
<!-- Severity Indicator Decoration (Visual Polish) -->
<div class="fixed top-0 left-0 w-1 h-full bg-secondary z-50"></div>
</body></html>