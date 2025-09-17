/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Base Colors
        'bg-primary': '#0D1117',
        'bg-secondary': '#161B22',
        'bg-tertiary': '#1E2632',
        
        // Accent Colors (Blue)
        'accent-primary': '#3B82F6',
        'accent-hover': '#2563EB',
        'accent-subtle': '#60A5FA',
        
        // Text Colors
        'text-primary': '#E6EDF3',
        'text-secondary': '#9CA3AF',
        'text-muted': '#6B7280',
        
        // Borders & Dividers
        'border-subtle': '#1F2937',
        'border-strong': '#374151',
        
        // Status Colors
        'success': '#10B981',
        'warning': '#F59E0B',
        'error': '#EF4444',
        'info': '#06B6D4',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      backgroundImage: {
        'gradient-blue': 'linear-gradient(135deg, #3B82F6, #2563EB)',
        'gradient-blue-subtle': 'linear-gradient(135deg, #60A5FA, #3B82F6)',
        'gradient-divider': 'linear-gradient(90deg, #3B82F6, transparent)',
        'glassmorphism': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05))',
      },
      boxShadow: {
        'glow': '0 0 0 3px rgba(59, 130, 246, 0.5)',
        'card-hover': '0 4px 20px rgba(59, 130, 246, 0.2)',
        'card-lift': '0 8px 25px rgba(0, 0, 0, 0.15), 0 4px 20px rgba(59, 130, 246, 0.2)',
        'glassmorphism': '0 8px 32px rgba(0, 0, 0, 0.37)',
      },
      backdropBlur: {
        'xs': '2px',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'glow-pulse': {
          '0%': { boxShadow: '0 0 5px rgba(59, 130, 246, 0.2)' },
          '100%': { boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)' },
        },
      },
    },
  },
  plugins: [],
}
