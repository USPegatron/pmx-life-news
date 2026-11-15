# Border & Flight — Web UI

A trilingual news hub for El Paso–Juárez border affairs and global aviation developments.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Data**: Supabase (PostgreSQL)

## Design Decisions

### Typography
- **Display**: Playfair Display — A refined serif with editorial character for headlines
- **Body**: IBM Plex Sans — Clean, readable sans-serif with technical precision
- This pairing evokes print journalism while maintaining modern readability

### Color Palette
- **Paper** (`#faf9f6`): Warm cream background, easier on the eyes than pure white
- **Ink** (`#1a1f2e`): Deep navy for primary text, softer than pure black
- **Accent** (`#c25d3b`): Terracotta — warm, distinctive, draws attention without shouting
- **Border** (`#e2d8c8`): Warm beige for subtle dividers

### Topic Colors
- **Border news**: Terracotta (`#c25d3b`) — earthy, grounded
- **Aviation news**: Slate blue (`#2d5a7a`) — sky, professionalism

### Layout
- **Mobile-first**: Single column on mobile, 2-column grid on desktop
- **Card-based**: Each article is a self-contained unit with clear hierarchy
- **Sticky header**: Filters and language toggle always accessible

### UX Details
- Language preference persisted to localStorage
- Auto-refresh every 10 minutes with manual refresh option
- Loading skeletons for perceived performance
- Graceful image fallbacks with topic-specific gradient placeholders
- Localized relative timestamps ("2h ago" / "hace 2 h" / "2 小时前")

## Local Development

### Prerequisites

- Node.js 18+ (portable Node included in this project)

### Setup

1. **Install dependencies**:
   ```bash
   cd border-aviation-news/webui
   & "C:\Users\Jacky2_Wang\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64\npm.cmd" install
   ```

2. **Configure environment**:
   ```bash
   # Copy the example env file
   cp .env.example .env.local
   
   # Edit .env.local with your Supabase credentials:
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
   ```

3. **Run development server**:
   ```bash
   & "C:\Users\Jacky2_Wang\.config\opencode\skills\portable-nodejs\bin\node-v24.14.1-win-x64\npm.cmd" run dev
   ```

4. **Open in browser**: http://localhost:3000

## Vercel Deployment

### Import Steps

1. **Push to GitHub** (if not already):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   # Add remote and push
   ```

2. **Import to Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Click "Import Git Repository"
   - Select your repository
   - **Important**: Set **Root Directory** to `app/webui` (not the repo root)

3. **Configure Environment Variables** in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Your Supabase anon/public key

4. **Deploy**:
   - Click "Deploy"
   - Vercel will automatically detect Next.js and build

### Vercel Settings Summary

| Setting | Value |
|---------|-------|
| Framework Preset | Next.js |
| Root Directory | `app/webui` |
| Build Command | `npm run build` |
| Output Directory | `.next` (default) |
| Node.js Version | 20.x (default) |

## Project Structure

```
webui/
├── src/
│   ├── app/
│   │   ├── globals.css      # Global styles, Tailwind theme, animations
│   │   ├── layout.tsx       # Root layout with Google Fonts
│   │   └── page.tsx         # Main news feed page
│   └── lib/
│       ├── supabase.ts      # Supabase client initialization
│       ├── types.ts         # TypeScript type definitions
│       └── utils.ts         # Translation, formatting, filtering utilities
├── .env.example             # Environment variable template
├── next.config.ts           # Next.js configuration
├── package.json             # Dependencies and scripts
├── README.md                # This file
└── tsconfig.json            # TypeScript configuration
```

## Features

### Language Support
- **中文 (zh)**: Simplified Chinese
- **English (en)**: Default fallback
- **Español (es)**: Spanish

Language auto-detects from `navigator.language` on first visit, then persists to localStorage.

### Filters
- **Search**: Case-insensitive substring match across titles and summaries in all three languages
- **Topic**: All / El Paso–Juárez (border) / Aviation
- **Time**: 24 hours / 7 days / All time

### Card Display
- Featured image with lazy loading
- Graceful fallback to gradient placeholder with topic glyph
- Topic badge overlay
- Source attribution
- Localized relative timestamp
- Title (2-line clamp) and summary (3-line clamp)
- "Read original" link to source article

### Performance
- Client-side data fetching with loading skeletons
- Auto-refresh every 10 minutes
- Manual refresh with spinner indicator
- Efficient client-side filtering

## License

Internal use — Border & Flight News Hub
